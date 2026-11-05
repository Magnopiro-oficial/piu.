/**
 * Núcleo do Piu Desktop no processo principal: cofre (frase), estado cifrado, nó de pessoa
 * (Messenger + transportes), carteira e preferências. O IPC (ipc.ts) só chama métodos daqui e
 * repassa os eventos ao renderer.
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { DesktopLinkServer } from './desktopLink';
import { createIdentity, type DerivedKeys, identityFromPhrase, suggestWords } from './identity';
import { MeshNode } from './mesh';
import { type AppState, Store } from './store';
import type { SafeStorageLike } from './vault';
import { Vault } from './vault';
import { emptyWallet, validateAddress, WalletReader } from './wallet';
import {
  applyStatus, appendOutgoing, type ConversationsState, emptyState, markRead, messagesOf, receiveIncoming, removeConversation, summaries,
} from '../shared/conversations';
import {
  type ConversationSummary, DEFAULT_PREFS, type IdentityKind, type LinkState, type MeInfo, type Message, type NetworkStatus, type PiuEventName, type PiuEvents, type Prefs, type SessionInfo, type WalletState,
} from '../shared/types';
import { BleTransportStub } from '../transport/bleStub';
import { LnnpLanTransport, parsePeerAddress } from '../transport/lnnpLan';

export interface CoreOptions {
  userData: string;
  safeStorage: SafeStorageLike;
  platform: string;
  version: string;
  hostname: string;
  log?: (m: string) => void;
  /** Transporte LAN: porta 0 e sem descoberta nos testes. */
  lan?: { port?: number; discoveryPort?: number | null; listen?: string; broadcast?: string[] };
  /** Vínculo com o celular: endereço mostrado no QR e escuta (testes: 127.0.0.1). */
  link?: { host?: string; listen?: string };
}

export class PiuCore {
  private vault: Vault;
  private store: Store | null = null;
  private state: AppState = { v: 1, messenger: null, conversations: emptyState(), prefs: { ...DEFAULT_PREFS } };
  private keys: DerivedKeys | null = null;
  private mesh: MeshNode | null = null;
  private lan: LnnpLanTransport | null = null;
  private ble = new BleTransportStub();
  private walletState: WalletState = emptyWallet(null, false);
  private walletReader = new WalletReader();
  private walletTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  readonly events = new EventEmitter();
  /** Vínculo com o celular (modelo WhatsApp Web): espelha as conversas do celular quando não há identidade local. */
  readonly link: DesktopLinkServer;

  constructor(private o: CoreOptions) {
    this.vault = new Vault(join(o.userData, 'vault'), o.safeStorage);
    this.link = new DesktopLinkServer({ host: o.link?.host, listen: o.link?.listen, name: o.hostname, tlsDir: join(o.userData, 'link-tls'), log: m => this.log(m) });
    this.link.on('state', (s: LinkState) => { this.emit('link', s); this.emit('session', this.session()); if (s.state === 'linked' && s.synced) this.emit('conversations', undefined); });
    this.link.on('conversations', () => this.emit('conversations', undefined));
    this.link.on('message', (p: { contactId: string; message: Message }) => { this.emit('message', p); if (p.message.dir === 'in') this.events.emit('incoming', { contact: this.link.listConversations().find(c => c.contact.id === p.contactId)?.contact ?? { id: p.contactId, name: '', via: 'public', request: false }, text: p.message.text, isNew: false }); });
  }

  /** Sem identidade local e com o celular vinculado, tudo vem do celular. */
  private get viaPhone() { return !this.mesh && this.link.linked; }

  // ── vínculo com o celular ────────────────────────────────
  linkStatus(): LinkState { return this.link.state; }
  async linkStart(): Promise<LinkState> {
    if (this.mesh) throw new Error('Este computador já tem uma identidade própria; apague-a em Ajustes → Backup para vincular um celular.');
    return this.link.start();
  }
  linkConfirm(): LinkState { return this.link.confirm(); }
  async linkCancel(): Promise<LinkState> {
    if (this.link.linked) { await this.link.stop(); this.emit('session', this.session()); return this.link.state; }
    return this.link.cancel();
  }

  private log(m: string) { this.o.log?.(m); }
  emit<K extends PiuEventName>(k: K, payload: PiuEvents[K]) { this.events.emit(k, payload); }

  // ── ciclo de vida ────────────────────────────────────────
  /** Abre o estado e, se há frase no cofre, sobe o nó. */
  async open() {
    const key = await this.vault.dataKey().catch(() => null);
    if (key) {
      this.store = new Store(join(this.o.userData, 'state.bin'), key);
      const saved = this.store.load();
      if (saved) this.state = { ...this.state, ...saved, prefs: { ...DEFAULT_PREFS, ...saved.prefs } };
    }
    this.walletState = emptyWallet(this.state.prefs.walletAddress, this.state.prefs.hideBalance);
    const phrase = await this.vault.getPhrase();
    if (phrase) {
      try { await this.boot(identityFromPhrase(phrase)); }
      catch (e) { this.log(`núcleo: não subiu com a frase guardada (${(e as Error).message})`); }
    }
  }

  private async boot(keys: DerivedKeys) {
    this.keys = keys;
    this.lan = new LnnpLanTransport({
      node: keys.node, relay: this.state.prefs.relay, peers: this.state.prefs.peers, log: m => this.log(m),
      listen: this.o.lan?.listen, port: this.o.lan?.port, discoveryPort: this.o.lan?.discoveryPort, broadcast: this.o.lan?.broadcast,
    });
    this.mesh = new MeshNode({
      keys, transports: [this.lan, this.ble], state: this.state.messenger, relay: this.state.prefs.relay, displayName: this.state.prefs.displayName,
      log: m => this.log(m),
      events: {
        message: (contact, m, isNew) => {
          const route = m.route ? { peer: m.route.peer, via: m.route.via, bytes: m.route.bytes, hops: m.route.hops, priority: m.route.priority } : undefined;
          this.setConversations(receiveIncoming(this.state.conversations, { id: m.msgId, contactId: contact.id, text: m.text, at: m.sentAt, route }));
          const msg = messagesOf(this.state.conversations, contact.id).find(x => x.id === m.msgId);
          if (msg) this.emit('message', { contactId: contact.id, message: msg });
          this.emit('conversations', undefined);
          this.events.emit('incoming', { contact, text: m.text, isNew });
        },
        status: (msgId, status, route) => {
          const before = this.state.conversations;
          this.setConversations(applyStatus(before, msgId, status, route, Math.floor(Date.now() / 1000)));
          if (before !== this.state.conversations) {
            for (const list of Object.values(this.state.conversations.byContact)) {
              const m = list.find(x => x.id === msgId);
              if (m) { this.emit('message', { contactId: m.contactId, message: m }); break; }
            }
            this.emit('conversations', undefined);
          }
        },
        changed: () => this.scheduleSave(),
        peers: () => this.emit('network', this.networkStatus()),
      },
    });
    await this.mesh.start();
    if (!this.state.prefs.lan) await this.lan.stop();
    this.emit('session', this.session());
    this.emit('network', this.networkStatus());
    this.startWalletTimer();
  }

  async close() {
    if (this.walletTimer) clearInterval(this.walletTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveNow();
    await this.mesh?.stop();
    this.mesh = null;
    this.lan = null;
    await this.link.stop().catch(() => {});
  }

  private setConversations(c: ConversationsState) {
    if (c === this.state.conversations) return;
    this.state = { ...this.state, conversations: c };
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 500);
    this.saveTimer.unref();
  }

  saveNow() {
    if (!this.store) return;
    try {
      this.state = { ...this.state, messenger: this.mesh ? this.mesh.export() : this.state.messenger };
      this.store.save(this.state);
    } catch (e) { this.log(`núcleo: estado não gravado (${(e as Error).message})`); }
  }

  // ── sessão / identidade ──────────────────────────────────
  session(): SessionInfo {
    const base = { platform: this.o.platform, version: this.o.version, vaultSecure: this.vault.secure, hostname: this.o.hostname };
    if (this.viaPhone) return { ...base, state: 'linked', me: this.link.meInfo() };
    const me: MeInfo | null = this.keys && this.mesh ? { ...this.mesh.ids, name: this.state.prefs.displayName, nodePk: this.mesh.nodePk } : null;
    return { ...base, state: me ? 'ready' : 'none', me };
  }

  private requireMesh(): MeshNode {
    if (!this.mesh) throw new Error('Crie ou restaure uma identidade primeiro.');
    return this.mesh;
  }

  async createIdentity(o: { kind: IdentityKind; name: string }): Promise<{ phrase: string[] }> {
    if (this.mesh) throw new Error('Já existe uma identidade neste computador.');
    if (!this.vault.secure) throw new Error('O cofre do sistema não está disponível; a frase não pode ser guardada com segurança neste computador.');
    const { phrase, keys } = createIdentity();
    await this.vault.setPhrase(phrase);
    await this.ensureStore();
    // A identidade escolhida na criação é a que a interface mostra (as conversas são listas separadas).
    this.state = { ...this.state, prefs: { ...this.state.prefs, displayName: o.kind === 'public' ? o.name.trim().slice(0, 40) : '', identity: o.kind } };
    await this.boot(keys);
    this.saveNow();
    this.emit('prefs', this.state.prefs);
    return { phrase };
  }

  async restoreIdentity(o: { phrase: string[]; name: string }): Promise<void> {
    if (this.mesh) throw new Error('Já existe uma identidade neste computador.');
    if (!this.vault.secure) throw new Error('O cofre do sistema não está disponível; a frase não pode ser guardada com segurança neste computador.');
    const keys = identityFromPhrase(o.phrase);
    await this.vault.setPhrase(o.phrase.map(w => w.trim().toLowerCase()));
    await this.ensureStore();
    this.state = { ...this.state, prefs: { ...this.state.prefs, displayName: o.name.trim().slice(0, 40) } };
    await this.boot(keys);
    this.saveNow();
    this.emit('prefs', this.state.prefs);
  }

  private async ensureStore() {
    if (this.store) return;
    const key = await this.vault.dataKey();
    this.store = new Store(join(this.o.userData, 'state.bin'), key);
  }

  revealPhrase() { return this.vault.getPhrase(); }
  suggestWords(prefix: string) { return suggestWords(prefix, 6); }

  /** Apaga tudo deste computador: frase, chave de dados e estado. */
  async eraseAll() {
    await this.mesh?.stop();
    this.mesh = null; this.lan = null; this.keys = null;
    if (this.walletTimer) clearInterval(this.walletTimer);
    await this.vault.clear();
    try { require('node:fs').rmSync(join(this.o.userData, 'state.bin'), { force: true }); } catch { /* nada */ }
    this.store = null;
    this.state = { v: 1, messenger: null, conversations: emptyState(), prefs: { ...DEFAULT_PREFS } };
    this.emit('session', this.session());
  }

  // ── contatos e conversas ─────────────────────────────────
  myCard(kind: IdentityKind, fresh = false) { const r = this.requireMesh().myCard(kind, fresh); this.scheduleSave(); return r; }
  addContactByCard(text: string) { const c = this.requireMesh().addContactByCard(text); this.scheduleSave(); this.emit('conversations', undefined); return c; }
  listConversations(): ConversationSummary[] {
    if (this.viaPhone) return this.link.listConversations();
    return this.mesh ? summaries(this.state.conversations, this.mesh.listContacts()) : [];
  }
  getMessages(contactId: string): Message[] { return this.viaPhone ? this.link.getMessages(contactId) : messagesOf(this.state.conversations, contactId); }

  sendText(contactId: string, text: string): Message {
    const t = text.trim();
    if (!t) throw new Error('Escreva algo antes de enviar.');
    if (this.viaPhone) { const m = this.link.sendText(contactId, t); this.emit('conversations', undefined); return m; }
    const mesh = this.requireMesh();
    // A mensagem entra na conversa ANTES de ir para a fila: o "encaminhada" pode chegar ainda dentro de
    // `sendText` (há vizinho conectado) e precisa encontrar a mensagem para guardar a rota.
    const id = mesh.newMessageId();
    const before = this.state.conversations;
    this.setConversations(appendOutgoing(before, { id, contactId, text: t, at: Math.floor(Date.now() / 1000) }));
    try { mesh.sendText(contactId, t, id); } catch (e) { this.setConversations(before); throw e; }
    const m = messagesOf(this.state.conversations, contactId).find(x => x.id === id)!;
    this.emit('conversations', undefined);
    return m;
  }

  markRead(contactId: string) {
    if (this.viaPhone) { try { this.link.markRead(contactId); } catch { /* sem celular agora */ } this.emit('conversations', undefined); return; }
    this.setConversations(markRead(this.state.conversations, contactId)); this.emit('conversations', undefined);
  }
  removeContact(contactId: string) {
    if (this.viaPhone) throw new Error('Remova o contato no celular; o computador só espelha as conversas dele.');
    this.requireMesh().removeContact(contactId);
    this.setConversations(removeConversation(this.state.conversations, contactId));
    this.emit('conversations', undefined);
  }
  safetyCode(contactId: string) {
    if (this.viaPhone) throw new Error('O código de segurança fica no celular (dono das chaves).');
    return this.requireMesh().safetyCode(contactId);
  }

  // ── rede ─────────────────────────────────────────────────
  networkStatus(): NetworkStatus {
    const lan = this.lan;
    return {
      lan: lan
        ? { state: lan.state, reason: lan.reason, port: lan.port || null, discoveryPort: lan.discoveryPort, peers: lan.peerStatus(), links: lan.linkCount }
        : { state: 'off', port: null, discoveryPort: null, peers: [], links: 0 },
      ble: { state: this.ble.state, reason: this.ble.reason },
      relay: this.state.prefs.relay,
    };
  }

  addPeer(raw: string) {
    const address = parsePeerAddress(raw);
    if (!address) throw new Error('Use o formato host:porta (ex.: 192.168.0.10:8422).');
    const lan = this.lan;
    if (!lan) throw new Error('A rede local ainda não está ligada.');
    lan.addPeer(address);
    if (!this.state.prefs.peers.includes(address)) this.setPrefs({ peers: [...this.state.prefs.peers, address] });
    return lan.peerStatus();
  }

  removePeer(address: string) {
    this.lan?.removePeer(address);
    this.setPrefs({ peers: this.state.prefs.peers.filter(p => p !== address) });
    return this.lan?.peerStatus() ?? [];
  }

  // ── carteira ─────────────────────────────────────────────
  wallet() { return this.walletState; }

  async setWalletAddress(address: string | null) {
    const a = address?.trim() || null;
    if (a) { const err = validateAddress(a); if (err) throw new Error(err); }
    this.setPrefs({ walletAddress: a });
    this.walletState = emptyWallet(a, this.state.prefs.hideBalance);
    this.emit('wallet', this.walletState);
    return a ? this.refreshWallet() : this.walletState;
  }

  async refreshWallet() {
    if (!this.walletState.address) return this.walletState;
    this.walletState = { ...this.walletState, status: 'loading' };
    this.emit('wallet', this.walletState);
    this.walletState = await this.walletReader.read(this.walletState);
    this.emit('wallet', this.walletState);
    return this.walletState;
  }

  private startWalletTimer() {
    if (this.walletTimer) return;
    if (this.walletState.address) void this.refreshWallet();
    this.walletTimer = setInterval(() => { if (this.walletState.address) void this.refreshWallet(); }, 60_000);
    this.walletTimer.unref();
  }

  // ── preferências ─────────────────────────────────────────
  prefs() { return this.state.prefs; }

  setPrefs(patch: Partial<Prefs>): Prefs {
    const next: Prefs = { ...this.state.prefs, ...patch };
    if (patch.displayName !== undefined) next.displayName = patch.displayName.trim().slice(0, 40);
    this.state = { ...this.state, prefs: next };
    if (this.mesh) {
      if (patch.relay !== undefined) { this.mesh.relay = next.relay; this.lan?.setRelay(next.relay); }
      if (patch.displayName !== undefined) this.mesh.displayName = next.displayName;
      // Rede local: liga/desliga o transporte sem derrubar o nó (a fila do roteador segura as mensagens).
      if (patch.lan !== undefined && this.lan) {
        const lan = this.lan;
        void (next.lan ? lan.start() : lan.stop()).then(() => this.emit('network', this.networkStatus()));
      }
    }
    if (patch.hideBalance !== undefined) { this.walletState = { ...this.walletState, hidden: next.hideBalance }; this.emit('wallet', this.walletState); }
    this.scheduleSave();
    this.emit('prefs', next);
    this.emit('session', this.session());
    if (patch.relay !== undefined) this.emit('network', this.networkStatus());
    return next;
  }
}
