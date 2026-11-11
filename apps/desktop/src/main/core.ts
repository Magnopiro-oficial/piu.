/**
 * Núcleo do Piu Desktop no processo principal: cofre (frase), estado cifrado, nó de pessoa
 * (Messenger + transportes), carteira e preferências. O IPC (ipc.ts) só chama métodos daqui e
 * repassa os eventos ao renderer.
 */
import { EventEmitter } from 'node:events';
import type { accountBalance } from '../../../mobile/src/lib/lunesRpc';
import { walletReceived } from '../shared/notifyPolicy';
import { conversationSizes, freeBytes, lowDisk, measureStorage } from './storageUsage';
import { envelopeId } from '../../../mobile/src/protocol/envelope';
import { attemptsAfterFailure, hashLockPassword, type LockAttempts, lockPasswordProblem, lockWait, NO_ATTEMPTS, triesLeft, verifyLockPassword } from './lockPassword';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentJournal, paymentActive } from './paymentJournal';
import type { DesktopPaymentState, PaymentRequestInput } from '../shared/paymentTypes';
import { DesktopLinkServer } from './desktopLink';
import { createIdentityBackup } from './backup';
import { createIdentity, type DerivedKeys, identityFromPhrase, suggestWords } from './identity';
import { MeshNode } from './mesh';
import { RemoteAudio } from './callHost';
import { randomBytes } from 'node:crypto';
import { type CallAct, type CallSnapshot, readCallAct, readCallFrame } from '../shared/callBridge';
import { shouldRing } from '../shared/callNotify';
import { migratePrefs } from './prefs';
import { type AppState, Store } from './store';
import type { SafeStorageLike } from './vault';
import { Vault, VaultLockedError } from './vault';
import { emptyWallet, pickWalletAddress, validateAddress, WalletReader } from './wallet';
import {
  applyStatus, appendCallRecord, appendOutgoing, type ConversationsState, upsertCallRequest, dropExpired, emptyState, expireSecOf, markRead, messagesOf, receiveIncoming, removeConversation, summaries, TEMP_MODES,
} from '../shared/conversations';
import {
  type BlockedContact, type ContactInfo, type ConversationSummary, DEFAULT_PREFS, type StorageDetail, type StorageUsage, type TempMode, type IdentityKind, type LinkState, type MeInfo, type Message, type NetworkStatus, type PiuEventName, type PiuEvents, type Prefs, type SessionInfo, type WalletState,
} from '../shared/types';
import { BleTransportStub } from '../transport/bleStub';
import { LnnpLanTransport, parsePeerAddress } from '../transport/lnnpLan';
import { tm } from './i18n';

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
  /** Leitura de saldo na Mainnet (testes: substituto sem rede). */
  walletBalance?: typeof accountBalance;
  /**
   * Antes de abrir o microfone (caixa "pre", que já mede o microfone, e a chamada conectada): pede a
   * permissão do sistema (macOS). Recusada, rejeita.
   */
  micAccess?: () => Promise<void>;
}

/** Vencimento local de uma temporária recebida: a partir do envio (nunca do futuro), como `expiryOf` no celular. */
const expiryOf = (m: { sentAt: number; expireSec?: number }) => (m.expireSec ? Math.min(m.sentAt, Math.floor(Date.now() / 1000)) + m.expireSec : undefined);

export class PiuCore {
  private vault: Vault;
  private store: Store | null = null;
  private state: AppState = { v: 1, messenger: null, conversations: emptyState(), prefs: { ...DEFAULT_PREFS } };
  private keys: DerivedKeys | null = null;
  private mesh: MeshNode | null = null;
  private lan: LnnpLanTransport | null = null;
  /** Microfone e alto-falante da chamada, no renderer (`callAudio` ↔ `callFrame`). */
  private readonly callAudio = new RemoteAudio(cmd => this.emit('callAudio', cmd), () => this.o.micAccess?.() ?? Promise.resolve());
  private ble = new BleTransportStub();
  private paymentJournal: PaymentJournal | null = null;
  private linkWasReady = false;
  /** Último endereço Lunes conhecido de cada contato (para reagir só a "sem → com endereço"). */
  private knownWallets = new Map<string, string | null>();
  private walletState: WalletState = emptyWallet(null, false);
  private walletReader: WalletReader;
  private walletReadVersion = 0;
  private walletTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  /** Última leitura bem-sucedida do saldo (para avisar "LUNES recebidos" só quando sobe). */
  private lastOkWallet: WalletState | null = null;
  /** Cofre bloqueado/ilegível na abertura (A-01): o motivo para a interface; nada é gravado enquanto isso. */
  private locked: string | null = null;
  readonly events = new EventEmitter();
  /** Vínculo com o celular (modelo WhatsApp Web): espelha as conversas do celular quando não há identidade local. */
  readonly link: DesktopLinkServer;

  constructor(private o: CoreOptions) {
    this.walletReader = new WalletReader(o.walletBalance);
    this.vault = new Vault(join(o.userData, 'vault'), o.safeStorage, o.platform);
    this.link = new DesktopLinkServer({ host: o.link?.host, listen: o.link?.listen, name: o.hostname, tlsDir: join(o.userData, 'link-tls'), log: m => this.log(m) });
    this.link.on('state', (s: LinkState) => {
      const ready = s.state === 'linked' && s.synced;
      if (this.linkWasReady && !ready && this.paymentJournal) { try { this.paymentJournal.disconnected(); } catch { /* fail closed */ } this.emit('walletPayment', this.walletPayment()); }
      this.linkWasReady = ready;
      this.emit('link', s); this.emit('session', this.session()); if (s.state === 'linked' && s.synced) this.emit('conversations', undefined);
      this.syncWalletSource(); });
    this.link.on('wallet', () => this.syncWalletSource());
    this.link.on('paymentStatus', (message: unknown) => { try { this.paymentJournal?.update(message); } catch { /* fail closed */ } this.emit('walletPayment', this.walletPayment()); });
    this.link.on('conversations', () => this.emit('conversations', undefined));
    this.link.on('message', (p: { contactId: string; message: Message }) => { this.emit('message', p); if (p.message.dir === 'in') this.events.emit('incoming', { contact: this.link.listConversations().find(c => c.contact.id === p.contactId)?.contact ?? { id: p.contactId, name: '', via: 'public', request: false }, text: p.message.text, isNew: false }); });
  }

  /** Sem identidade local e com o celular vinculado, tudo vem do celular. */
  private get viaPhone() { return !this.mesh && this.link.linked; }

  // ── vínculo com o celular ────────────────────────────────
  linkStatus(): LinkState { return this.link.state; }
  async linkStart(): Promise<LinkState> {
    this.requireUnlocked();
    if (this.mesh) throw new Error(tm('main.core.ownIdentity'));
    return this.link.start();
  }
  /** `word`: a última palavra que a pessoa escolheu entre as opções (M-04). */
  linkConfirm(word: string): LinkState { return this.link.confirm(word); }
  async linkCancel(): Promise<LinkState> {
    if (this.link.linked) { await this.link.stop(); this.emit('session', this.session()); return this.link.state; }
    return this.link.cancel();
  }

  /**
   * Criar ou restaurar com o QR de "entrar com o celular" ainda na tela (a pessoa voltou sem ler): o QR
   * para. Com o celular já conectando ou vinculado, recusa: a identidade dele não pode ser trocada assim.
   */
  private async releaseIdleLink() {
    if (this.link.state.state === 'waiting') await this.link.stop();
    if (!['off', 'dropped'].includes(this.link.state.state)) throw new Error(tm('main.core.disconnectPhone'));
  }

  private log(m: string) { this.o.log?.(m); }
  emit<K extends PiuEventName>(k: K, payload: PiuEvents[K]) { this.events.emit(k, payload); }

  // ── ciclo de vida ────────────────────────────────────────
  /**
   * Abre o estado e, se há frase no cofre, sobe o nó. Falha fechada (A-01): cofre que existe e não abre
   * (Keychain negado/bloqueado) ou frase guardada que não sobe deixa o núcleo em `locked` — sem chave de
   * dados nova, sem estado gravado por cima, sem oferecer "criar identidade" sobre a frase antiga.
   */
  async open() {
    if (this.mesh) return;
    this.locked = null;
    let key: Buffer | null = null;
    try { key = await this.vault.dataKey(); }
    catch (e) {
      if (e instanceof VaultLockedError) { this.lock(e.message); return; }
      key = null; // sem cofre no sistema (Linux sem chaveiro): abre sem estado guardado, como antes
    }
    if (key) {
      try { this.paymentJournal = new PaymentJournal(join(this.o.userData, 'payments.bin'), key); } catch { this.paymentJournal = null; }
      this.store = new Store(join(this.o.userData, 'state.bin'), key);
      let saved: AppState | null = null;
      // Ilegível com a chave certa (arquivo adulterado/estragado): guarda a cópia em quarentena e começa limpo.
      try { saved = this.store.load(); }
      catch { const to = this.store.quarantine(); this.log(`núcleo: estado ilegível guardado em ${to}; começando limpo`); }
      if (saved) this.state = { ...this.state, ...saved, prefs: { ...DEFAULT_PREFS, ...migratePrefs(saved.prefs as unknown as Record<string, unknown>) } as Prefs };
    }
    this.walletState = emptyWallet(this.state.prefs.walletAddress, this.state.prefs.hideBalance);
    let phrase: string[] | null;
    try { phrase = await this.vault.getPhrase(); }
    catch (e) { this.lock(e instanceof VaultLockedError ? e.message : tm('main.core.phraseRead')); return; }
    if (phrase) {
      try { await this.boot(identityFromPhrase(phrase)); }
      catch (e) {
        this.log(`núcleo: não subiu com a frase guardada (${(e as Error).message})`);
        await (this.mesh as MeshNode | null)?.stop().catch(() => {});
        this.mesh = null; this.lan = null; this.keys = null;
        this.lock(tm('main.core.phraseNoOpen'));
      }
    } else if (this.vault.hasPhrase()) this.lock(tm('main.core.phraseEmpty'));
  }

  /** Cofre bloqueado: larga estado e diário (nada é gravado) e avisa a interface. */
  private lock(reason: string) {
    this.locked = reason;
    this.store = null;
    this.paymentJournal = null;
    this.state = { v: 1, messenger: null, conversations: emptyState(), prefs: { ...DEFAULT_PREFS } };
    this.log(`núcleo: cofre bloqueado (${reason})`);
  }

  /** "Tentar de novo" na tela de cofre bloqueado: reabre do zero, lendo os mesmos arquivos. */
  async retryOpen(): Promise<SessionInfo> {
    if (this.locked) {
      await this.open();
      this.emit('prefs', this.state.prefs);
      this.walletState = this.freshWallet();
      this.emit('wallet', this.walletState);
      this.emit('walletPayment', this.walletPayment());
    }
    const s = this.session();
    this.emit('session', s);
    return s;
  }

  /** Chave de dados do cofre do sistema (guardião: cifra a chave do ponto), ou `null` sem cofre/bloqueado. */
  async dataKey(): Promise<Buffer | null> {
    if (this.locked) return null;
    try { return await this.vault.dataKey(); } catch { return null; }
  }

  private requireUnlocked() {
    if (this.locked) throw new Error(tm('main.core.vaultLocked', { reason: this.locked }));
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
      // Privacidade → Metadados, lidos a cada envio (como o celular faz com `privRef`).
      randomDelay: () => this.state.prefs.randomDelay,
      pad: () => this.state.prefs.pad,
      // Gateway da carga pela malha (docs/carteira/transacoes-pela-malha.md): opcional, sem tela ainda;
      // liga com PIU_GATEWAY=1 (caixa do validador em PIU_VALIDATOR_INBOX, https://).
      ...(process.env.PIU_GATEWAY === '1' ? { gateway: { inboxUrl: process.env.PIU_VALIDATOR_INBOX?.trim() || null } } : {}),
      // Chamada de voz (apps/mobile/src/calls): registros e pedidos viram cartões na conversa.
      call: {
        audio: this.callAudio,
        newId: () => randomBytes(16).toString('base64url'),
        blocked: peer => this.isBlocked(peer),
        record: rec => {
          this.setConversations(appendCallRecord(this.state.conversations, rec)); this.emitLast(rec.peer);
          // Perdida com o Piu bloqueado: o main.ts guarda quem ligou para o aviso ao desbloquear.
          this.events.emit('callRecord', rec);
        },
        requestUpdate: (peer, requestId, step, dir) => {
          this.setConversations(upsertCallRequest(this.state.conversations, { peer, requestId, step, dir, at: Math.floor(Date.now() / 1000) }));
          this.emitLast(peer, `callreq-${requestId}`);
        },
        toast: (text, peer) => this.emit('callToast', { text, ...(peer ? { peer } : {}) }),
        draft: peer => this.emit('callDraft', { peer }),
      },
      events: {
        message: (contact, m, isNew) => {
          const route = m.route ? { peer: m.route.peer, via: m.route.via, bytes: m.route.bytes, hops: m.route.hops, priority: m.route.priority } : undefined;
          // Conversa nova (pedido) começa com "Temporárias por padrão", como `chatFor` no celular.
          if (isNew) this.applyTempDefault(contact.id);
          this.setConversations(receiveIncoming(this.state.conversations, { id: m.msgId, contactId: contact.id, text: m.text, at: m.sentAt, route, expiresAt: expiryOf(m) }));
          const msg = messagesOf(this.state.conversations, contact.id).find(x => x.id === m.msgId);
          if (msg) this.emit('message', { contactId: contact.id, message: msg });
          this.emit('conversations', undefined);
          this.events.emit('incoming', { contact, text: m.text, isNew });
        },
        groupChanged: () => { this.scheduleSave(); this.emit('conversations', undefined); },
        groupMessage: (contact, m, sender) => {
          const before = this.state.conversations;
          const route = m.route ? { peer: m.route.peer, via: m.route.via, bytes: m.route.bytes, hops: m.route.hops, priority: m.route.priority } : undefined;
          this.setConversations(receiveIncoming(before, { id: m.msgId, contactId: contact.id, text: m.text, at: m.sentAt, sender, route, expiresAt: expiryOf(m) }));
          if (before === this.state.conversations) return;
          const msg = messagesOf(this.state.conversations, contact.id).find(x => x.id === m.msgId);
          if (msg) this.emit('message', { contactId: contact.id, message: msg });
          this.emit('conversations', undefined);
          this.events.emit('incoming', { contact, text: m.text, isNew: false });
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
        peerWallet: (contactId, address) => {
          this.scheduleSave(); this.emit('conversations', undefined);
          // O contato acabou de aparecer com endereço: ele pode ter descartado o meu (mandado quando ainda me tratava
          // como pedido de conversa). Respondo com o meu uma vez; como só reajo a "sem → com endereço", não há pingue-pongue.
          const prev = this.knownWallets.get(contactId) ?? null;
          this.knownWallets.set(contactId, address);
          if (address && !prev) this.shareWallet(contactId);
        },
        peers: () => { this.emit('network', this.networkStatus()); this.emit('call', this.callSnapshot()); },
        call: () => this.emit('call', this.callSnapshot()),
        typing: contactId => { if (!this.isBlocked(contactId)) this.emit('typing', { contactId }); },
        // Alerta da comunidade: a lista da conversa muda; o aviso nativo é decisão do processo principal.
        communityAlert: (a, notice) => {
          this.emit('conversations', undefined);
          if (notice) this.events.emit('communityAlert', { alert: a, notice, muted: this.isMuted(a.contactId) });
        },
      },
    });
    this.applyMessengerPrefs();
    await this.mesh.start();
    this.startSweep();
    for (const c of this.mesh.listContacts()) this.knownWallets.set(c.id, c.lunesAddress ?? null);
    if (!this.state.prefs.lan) await this.lan.stop();
    this.emit('session', this.session());
    this.emit('call', this.callSnapshot());
    this.emit('network', this.networkStatus());
    // Sem endereço informado, a carteira usa o derivado da frase (o mesmo que o celular mostra).
    if (!this.state.prefs.walletAddress) { this.walletState = this.freshWallet(); this.emit('wallet', this.walletState); }
    this.startWalletTimer();
    // Endereço novo (identidade criada/restaurada) ou ainda não compartilhado: avisa os contatos uma vez.
    if (this.state.prefs.shareWalletAddress && this.state.walletShared !== keys.walletAddress) { this.shareWallet(); this.state = { ...this.state, walletShared: keys.walletAddress }; this.scheduleSave(); }
  }

  /**
   * Estado vazio da carteira com o endereço em uso, nesta ordem: o informado por você; vinculado ao celular,
   * a carteira que ele espelha; com identidade própria, o derivado da frase (o mesmo do celular).
   */
  private freshWallet(): WalletState {
    const pick = pickWalletAddress({ manual: this.state.prefs.walletAddress, phone: this.viaPhone ? this.link.walletAddress : null, phrase: this.keys?.walletAddress ?? null });
    return emptyWallet(pick.address, this.state.prefs.hideBalance, pick.source);
  }

  /**
   * Compartilha meu endereço Lunes (derivado da frase) com os contatos públicos aceitos (`wa`), como o
   * celular faz, para eu aparecer como destinatário na Carteira deles. `to`: só um contato (novo/aceito).
   * Respeita Ajustes → Privacidade → "Compartilhar meu endereço Lunes".
   */
  private shareWallet(to?: string) {
    if (!this.mesh || !this.keys || !this.state.prefs.shareWalletAddress) return;
    try { this.mesh.messenger.sendWalletAddress(this.keys.walletAddress, to); } catch (e) { this.log(`carteira: endereço não compartilhado (${(e as Error).message})`); }
  }

  /** O endereço em uso mudou de origem (vínculo subiu/caiu, carteira do celular): recomeça a leitura se for outro. */
  private syncWalletSource() {
    const next = this.freshWallet();
    if (next.address === this.walletState.address && next.source === this.walletState.source) return;
    this.walletReadVersion++;
    this.walletState = next;
    this.emit('wallet', this.walletState);
    if (next.address) void this.refreshWallet();
  }

  async close() {
    if (this.walletTimer) clearInterval(this.walletTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
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
    if (this.locked) return { ...base, state: 'locked', me: null, lockedReason: this.locked };
    if (this.viaPhone) return { ...base, state: 'linked', me: this.link.meInfo() };
    const me: MeInfo | null = this.keys && this.mesh ? { ...this.mesh.ids, name: this.state.prefs.displayName, nodePk: this.mesh.nodePk } : null;
    return { ...base, state: me ? 'ready' : 'none', me };
  }

  private requireMesh(): MeshNode {
    if (!this.mesh) throw new Error(tm('main.core.needIdentity'));
    return this.mesh;
  }

  /** Cria a identidade; a frase NÃO volta ao renderer (M-01): mostrar só em Backup, com reautenticação. */
  async createIdentity(o: { kind: IdentityKind; name: string }): Promise<void> {
    if (this.vault.hasPhrase()) throw new Error(tm('main.core.phraseExistsCreate'));
    this.requireUnlocked();
    if (this.mesh) throw new Error(tm('main.core.identityExists'));
    await this.releaseIdleLink();
    if (!this.vault.secure) throw new Error(tm('main.core.noVault'));
    const { phrase, keys } = createIdentity();
    await this.vault.setPhrase(phrase);
    await this.ensureStore();
    // A identidade escolhida na criação é a que a interface mostra (as conversas são listas separadas).
    this.state = { ...this.state, prefs: { ...this.state.prefs, displayName: o.kind === 'public' ? o.name.trim().slice(0, 40) : '', identity: o.kind } };
    await this.boot(keys);
    this.saveNow();
    this.emit('prefs', this.state.prefs);
  }

  async restoreIdentity(o: { phrase: string[]; name: string }): Promise<void> {
    if (this.vault.hasPhrase()) throw new Error(tm('main.core.phraseExistsRestore'));
    this.requireUnlocked();
    if (this.mesh) throw new Error(tm('main.core.identityExists'));
    await this.releaseIdleLink();
    if (!this.vault.secure) throw new Error(tm('main.core.noVault'));
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

  /** Só chamar depois da reautenticação (main.ts → security.ts `reauthForPhrase`). */
  revealPhrase() { return this.vault.getPhrase(); }
  /** Idem: só depois da reautenticação (main.ts → security.ts `exportBackupAfterReauth`). */
  exportIdentityBackup(password: string) { return createIdentityBackup(this.vault, password); }
  suggestWords(prefix: string) { return suggestWords(prefix, 6); }

  /** Apaga tudo deste computador: frase, chave de dados e estado. */
  async eraseAll() {
    const payment = this.walletPayment();
    if (payment.state === 'blocked' || (payment.state === 'payment' && paymentActive(payment.payment))) throw new Error(tm('main.core.paymentPending'));
    try { require('node:fs').rmSync(join(this.o.userData, 'payments.bin'), { force: true }); } catch { throw new Error(tm('main.core.paymentsRemove')); }
    this.paymentJournal = null;
    this.walletReadVersion++;
    this.walletState = emptyWallet(null, DEFAULT_PREFS.hideBalance);
    await this.mesh?.stop();
    this.mesh = null; this.lan = null; this.keys = null; this.knownWallets.clear();
    this.emit('call', null);
    if (this.walletTimer) clearInterval(this.walletTimer);
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    this.lastOkWallet = null;
    await this.vault.clear();
    try { require('node:fs').rmSync(join(this.o.userData, 'state.bin'), { force: true }); } catch { /* nada */ }
    this.store = null;
    this.state = { v: 1, messenger: null, conversations: emptyState(), prefs: { ...DEFAULT_PREFS } };
    this.emit('session', this.session());
  }

  // ── contatos e conversas ─────────────────────────────────
  myCard(kind: IdentityKind, fresh = false) { const r = this.requireMesh().myCard(kind, fresh); this.scheduleSave(); return r; }
  addContactByCard(text: string) { const c = this.requireMesh().addContactByCard(text); this.applyTempDefault(c.id); this.scheduleSave(); this.emit('conversations', undefined); if (c.via === 'public') this.shareWallet(c.id); return c; }
  listConversations(): ConversationSummary[] {
    const muted = new Set(this.state.muted ?? []);
    // Vinculado: silenciar vale só para os avisos deste computador (o celular silencia por conta própria).
    if (this.viaPhone) return this.link.listConversations().map(r => (muted.has(r.contact.id) ? { ...r, muted: true } : r));
    if (!this.mesh) return [];
    const blocked = new Set((this.state.blocked ?? []).map(b => b.id));
    return summaries(this.state.conversations, [...this.mesh.listContacts(), ...this.mesh.listGroups()], { muted, temp: this.state.temp ?? {} }).map(r => (blocked.has(r.contact.id) ? { ...r, blocked: true } : r));
  }
  listGroupCandidates(): ContactInfo[] {
    if (this.viaPhone) return [];
    return this.requireMesh().listContacts().filter(c => !c.request);
  }
  createGroup(o: { kind: 'group' | 'channel'; name: string; via: IdentityKind; memberIds: string[] }): ContactInfo {
    if (!o || (o.kind !== 'group' && o.kind !== 'channel') || (o.via !== 'public' && o.via !== 'anon') || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80 || !Array.isArray(o.memberIds) || !o.memberIds.length || o.memberIds.length > 100 || o.memberIds.some(id => typeof id !== 'string')) throw new Error(tm('main.core.groupInvalid'));
    const mesh = this.requireMesh();
    const allowed = new Set(mesh.listContacts().filter(c => !c.request && c.via === o.via).map(c => c.id));
    if (new Set(o.memberIds).size !== o.memberIds.length || o.memberIds.some(id => !allowed.has(id))) throw new Error(tm('main.core.groupMembers'));
    const group = mesh.createGroup({ kind: o.kind, name: o.name.trim(), via: o.via, memberIds: o.memberIds });
    this.scheduleSave(); this.emit('conversations', undefined); return group;
  }
  /** Convidar (Detalhes → Convidar): contatos aceitos da mesma identidade que ainda não estão no grupo. */
  groupInviteCandidates(groupId: string): ContactInfo[] {
    if (this.viaPhone) return [];
    const mesh = this.requireMesh();
    const g = mesh.listGroups().find(x => x.id === groupId);
    if (!g) throw new Error(tm('main.mesh.unknownGroup'));
    const inside = new Set(mesh.groupMemberIds(groupId));
    return mesh.listContacts().filter(c => !c.request && c.via === g.via && !inside.has(c.id) && !this.isBlocked(c.id));
  }
  addGroupMembers(groupId: string, memberIds: string[]): void {
    if (this.viaPhone) throw new Error(tm('main.core.groupOnPhone'));
    if (typeof groupId !== 'string' || !Array.isArray(memberIds) || !memberIds.length || memberIds.length > 100 || memberIds.some(id => typeof id !== 'string')) throw new Error(tm('main.core.groupInvalid'));
    const allowed = new Set(this.groupInviteCandidates(groupId).map(c => c.id));
    if (new Set(memberIds).size !== memberIds.length || memberIds.some(id => !allowed.has(id))) throw new Error(tm('main.core.groupMembers'));
    this.requireMesh().addGroupMembers(groupId, memberIds);
    this.scheduleSave(); this.emit('conversations', undefined);
  }
  /** Sair do grupo/canal/comunidade: avisa os admins, esquece a chave e apaga a conversa deste computador. */
  leaveGroup(groupId: string): void {
    if (this.viaPhone) throw new Error(tm('main.core.groupOnPhone'));
    const mesh = this.requireMesh();
    if (typeof groupId !== 'string' || !mesh.listGroups().some(g => g.id === groupId)) throw new Error(tm('main.mesh.unknownGroup'));
    mesh.leaveGroup(groupId);
    if (Object.hasOwn(this.state.conversations.byContact, groupId)) this.setConversations(removeConversation(this.state.conversations, groupId));
    this.scheduleSave(); this.emit('conversations', undefined);
  }
  getMessages(contactId: string): Message[] { return this.viaPhone ? this.link.getMessages(contactId) : messagesOf(this.state.conversations, contactId); }

  sendText(contactId: string, text: string): Message {
    const t = text.trim();
    if (!t) throw new Error(tm('main.core.writeSomething'));
    if (this.viaPhone) { const m = this.link.sendText(contactId, t); this.emit('conversations', undefined); return m; }
    const mesh = this.requireMesh();
    if (this.isBlocked(contactId)) throw new Error(tm('main.core.contactBlocked'));
    // Responder a um pedido de conversa aceita o contato: aí ele passa a receber meu endereço Lunes.
    const wasRequest = mesh.listContacts().find(c => c.id === contactId)?.request === true;
    // A mensagem entra na conversa ANTES de ir para a fila: o "encaminhada" pode chegar ainda dentro de
    // `sendText` (há vizinho conectado) e precisa encontrar a mensagem para guardar a rota.
    const id = mesh.newMessageId();
    const before = this.state.conversations;
    const at = Math.floor(Date.now() / 1000);
    // Temporárias valem só em conversa direta (o grupo não leva o prazo `e`).
    const expireSec = contactId.startsWith('group:') ? undefined : expireSecOf(this.tempOf(contactId));
    this.setConversations(appendOutgoing(before, { id, contactId, text: t, at, ...(expireSec ? { expiresAt: at + expireSec } : {}) }));
    try { mesh.sendText(contactId, t, id, expireSec); } catch (e) { this.setConversations(before); throw e; }
    const m = messagesOf(this.state.conversations, contactId).find(x => x.id === id)!;
    this.emit('conversations', undefined);
    if (wasRequest && mesh.listContacts().find(c => c.id === contactId)?.via === 'public') this.shareWallet(contactId);
    return m;
  }

  markRead(contactId: string) {
    if (this.viaPhone) { try { this.link.markRead(contactId); } catch { /* sem celular agora */ } this.emit('conversations', undefined); return; }
    // Confirmação de leitura (Privacidade): só conversa direta com contato aceito; o Messenger confirma cada uma uma vez.
    const list = messagesOf(this.state.conversations, contactId);
    const unseen = list.slice(this.state.conversations.readCount[contactId] ?? 0).filter(m => m.dir === 'in').map(m => m.id);
    if (unseen.length && this.mesh && this.state.prefs.readReceipts && !contactId.startsWith('group:') && !this.isBlocked(contactId)) {
      try { this.mesh.messenger.sendRead(contactId, unseen); } catch (e) { this.log(`leitura: recibo não enviado (${(e as Error).message})`); }
    }
    this.setConversations(markRead(this.state.conversations, contactId)); this.emit('conversations', undefined);
  }

  // ── chamada de voz (shared/callBridge.ts) ──
  /** `null`: este computador não faz chamadas agora (sem identidade própria ou espelhando o celular). */
  callSnapshot(): CallSnapshot | null {
    const call = this.mesh?.call;
    if (!call || this.viaPhone) return null;
    const routes: CallSnapshot['routes'] = {};
    for (const c of this.mesh!.listContacts()) {
      if (c.request || c.kind && c.kind !== 'direct' || this.isBlocked(c.id)) continue;
      const r = this.mesh!.liveRouteTo(c.id);
      if (r) routes[c.id] = r;
    }
    const st = call.state;
    const ring = shouldRing(this.state.prefs, st, !!st.peer && this.isMuted(st.peer));
    return { state: st, words: call.words, ...(call.latencyMs !== undefined ? { latencyMs: call.latencyMs } : {}), routes, ring };
  }
  /** Silenciou a conversa ou ligou Não perturbe com a chamada tocando: a janela para (ou volta) o toque na hora. */
  private emitRinging() { if (this.mesh?.call?.state.phase === 'ringing') this.emit('call', this.callSnapshot()); }

  callAct(x: unknown) {
    const call = this.mesh?.call, act = readCallAct(x);
    if (!call || this.viaPhone || !act) throw new Error(tm('main.core.callUnavailable'));
    const ctl = call.controller;
    switch (act.a) {
      case 'open': {
        const c = this.mesh!.listContacts().find(x => x.id === act.peer);
        if (!c || c.request || this.isBlocked(c.id)) throw new Error(tm('main.core.callUnavailable'));
        // macOS: o sistema pergunta pelo microfone antes de a caixa "pre" abrir o medidor (recusado, abre igual:
        // a chamada segue sem a minha voz e o main.ts avisa). Nos outros sistemas `micAccess` volta na hora.
        const mic = this.o.micAccess;
        if (mic) return mic().catch(() => {}).then(() => { if (this.mesh?.call === call) call.open(act.peer); });
        call.open(act.peer);
        break;
      }
      case 'dial': ctl.dial(); break;
      case 'sendRequest': ctl.sendRequest(); break;
      case 'answer': ctl.answer(); break;
      case 'hangup': ctl.hangup(); break;
      case 'wordsDiffer': ctl.wordsDiffer(); break;
      case 'requestNow': ctl.requestNow(); break;
      case 'decline': ctl.decline(act.how); break;
      case 'event': ctl.dispatch(act.event); break;
    }
  }

  callFrame(codec: unknown, payload: unknown) {
    const f = readCallFrame(codec, payload);
    if (f) this.callAudio.frame(f.codec, f.payload);
  }

  /** Avisa a janela da mensagem que entrou (ou mudou) na conversa. */
  private emitLast(contactId: string, id?: string) {
    const list = messagesOf(this.state.conversations, contactId);
    const msg = id ? list.find(m => m.id === id) : list[list.length - 1];
    if (msg) this.emit('message', { contactId, message: msg });
    this.emit('conversations', undefined);
  }

  /** "digitando…" para o contato (Privacidade → Mostrar quando estou digitando). Sem vizinho, não sai nada. */
  typing(contactId: string) {
    if (this.viaPhone || !this.mesh || !this.state.prefs.typing || contactId.startsWith('group:') || this.isBlocked(contactId)) return;
    try { this.mesh.messenger.sendTyping(contactId); } catch { /* contato sem sessão ainda */ }
  }

  // ── silenciar, bloquear, temporárias (locais deste computador) ──
  isMuted(contactId: string) { return (this.state.muted ?? []).includes(contactId); }
  setMuted(contactId: string, muted: boolean) {
    if (typeof contactId !== 'string' || !contactId || contactId.length > 200) throw new Error(tm('main.core.unknownChat'));
    const cur = new Set(this.state.muted ?? []);
    if (muted) cur.add(contactId); else cur.delete(contactId);
    this.state = { ...this.state, muted: [...cur] };
    this.scheduleSave(); this.emit('conversations', undefined);
    this.emitRinging();
  }

  isBlocked(contactId: string) { return (this.state.blocked ?? []).some(b => b.id === contactId); }
  listBlocked(): BlockedContact[] { return this.viaPhone ? [] : [...(this.state.blocked ?? [])]; }
  /**
   * Bloquear (como no celular): a conversa fica, mas o mensageiro descarta tudo o que o contato manda
   * (mensagens, pedidos, "digitando…") e não sai recibo de leitura nem endereço Lunes para ele.
   * Vinculado ao celular, quem bloqueia é o celular (dono dos contatos).
   */
  blockContact(contactId: string): BlockedContact[] {
    if (this.viaPhone) throw new Error(tm('main.core.blockOnPhone'));
    const mesh = this.requireMesh();
    const c = mesh.listContacts().find(x => x.id === contactId);
    if (!c) throw new Error(tm('main.core.blockDirectOnly'));
    if (!this.isBlocked(contactId)) this.state = { ...this.state, blocked: [{ id: c.id, name: c.name, via: c.via, at: Date.now() }, ...(this.state.blocked ?? [])] };
    this.applyMessengerPrefs(); this.scheduleSave(); this.emit('conversations', undefined);
    return this.listBlocked();
  }
  unblockContact(contactId: string): BlockedContact[] {
    if (this.viaPhone) throw new Error(tm('main.core.unblockOnPhone'));
    this.state = { ...this.state, blocked: (this.state.blocked ?? []).filter(b => b.id !== contactId) };
    this.applyMessengerPrefs(); this.scheduleSave(); this.emit('conversations', undefined);
    return this.listBlocked();
  }

  private tempOf(contactId: string): TempMode { const t = this.state.temp ?? {}; return Object.hasOwn(t, contactId) ? t[contactId]! : 'off'; }
  /** Mensagens temporárias desta conversa (vale para as próximas mensagens, nos dois lados). */
  setTemp(contactId: string, mode: TempMode) {
    if (this.viaPhone) throw new Error(tm('main.core.tempOnPhone'));
    if (!TEMP_MODES.includes(mode)) throw new Error(tm('main.core.badTemp'));
    if (contactId.startsWith('group:') || !this.requireMesh().listContacts().some(c => c.id === contactId)) throw new Error(tm('main.core.tempDirectOnly'));
    const temp = { ...(this.state.temp ?? {}) };
    if (mode === 'off') delete temp[contactId]; else temp[contactId] = mode;
    this.state = { ...this.state, temp };
    this.scheduleSave(); this.emit('conversations', undefined);
  }
  private applyTempDefault(contactId: string) {
    const d = this.state.prefs.tempDefault;
    if (d === 'off' || Object.hasOwn(this.state.temp ?? {}, contactId)) return;
    this.state = { ...this.state, temp: { ...(this.state.temp ?? {}), [contactId]: d } };
  }

  /** Varredura das temporárias vencidas (a cada 15 s). */
  private startSweep() {
    if (this.sweepTimer) return;
    const sweep = () => {
      const before = this.state.conversations;
      this.setConversations(dropExpired(before, Math.floor(Date.now() / 1000)));
      if (before !== this.state.conversations) this.emit('conversations', undefined);
    };
    sweep();
    this.sweepTimer = setInterval(sweep, 15_000);
    this.sweepTimer.unref();
  }

  /**
   * Ajustes que o Messenger aplica (os mesmos efeitos que no celular, state/messaging.tsx): bloqueados,
   * "Quem me encontra" e os limites do nó (banda e prazo de guarda só para mensagens de terceiros).
   */
  private applyMessengerPrefs() {
    const m = this.mesh?.messenger;
    if (!m) return;
    const p = this.state.prefs;
    m.setBlocked((this.state.blocked ?? []).map(b => b.id));
    m.setDiscovery(p.find);
    m.setPolicy({ maxBytes: Number(p.relayStorage) * 1024 * 1024, retentionSec: Number(p.relayRetention) * 3600, dailyBytes: Infinity, bytesPerSec: (Number(p.relayBandwidth) * 1_000_000) / 8, hours: 'always' });
  }

  /** Espaço usado na pasta de dados (Ajustes → Conversas e mídia). */
  storageUsage(): StorageUsage {
    const router = (this.mesh?.messenger as unknown as { router?: { stats?: () => { bytes: number } } } | undefined)?.router;
    let relay: number | null = null;
    try { relay = router?.stats ? router.stats().bytes : null; } catch { relay = null; }
    return measureStorage(this.o.userData, relay);
  }

  private get router() { return this.mesh?.messenger.router ?? null; }
  private stateBytes() { try { return statSync(join(this.o.userData, 'state.bin')).size; } catch { return 0; } }

  storageDetail(): StorageDetail {
    const usage = this.storageUsage();
    const free = freeBytes(this.o.userData);
    let relayOthers: number | null = null;
    try { relayOthers = this.router ? this.router.thirdPartyBytes() : null; } catch { relayOthers = null; }
    const names = new Map(this.viaPhone ? [] : this.listConversations().map(c => [c.contact.id, c.contact] as const));
    const conversations = this.viaPhone ? [] : conversationSizes(this.state.conversations).map(x => {
      const c = names.get(x.id);
      return { ...x, name: c?.name ?? '', kind: c?.kind, via: c?.via ?? 'public' };
    });
    return { ...usage, free, low: lowDisk(free), relayOthers, conversations, linked: this.viaPhone };
  }

  /** Apaga o histórico da conversa neste computador; contato, sessão e fila ficam. Grava na hora para medir o que saiu. */
  clearConversation(contactId: string): { freed: number } {
    if (this.viaPhone) throw new Error(tm('main.core.noLocalChats'));
    if (!Object.hasOwn(this.state.conversations.byContact, contactId)) return { freed: 0 };
    const before = this.stateBytes();
    this.setConversations(removeConversation(this.state.conversations, contactId));
    this.saveNow();
    this.emit('conversations', undefined);
    return { freed: Math.max(0, before - this.stateBytes()) };
  }

  /** Apaga da fila os envelopes de outras pessoas (as minhas mensagens que aguardam rota ficam). */
  clearRelayQueue(): { freed: number } {
    const r = this.router;
    if (!r) return { freed: 0 };
    const before = this.stateBytes();
    for (const e of r.exportStored()) if (!e.own) r.forget(envelopeId(e.bytes));
    this.saveNow();
    return { freed: Math.max(0, before - this.stateBytes()) };
  }
  removeContact(contactId: string) {
    if (this.viaPhone) throw new Error(tm('main.core.removeOnPhone'));
    this.requireMesh().removeContact(contactId);
    this.setConversations(removeConversation(this.state.conversations, contactId));
    this.emit('conversations', undefined);
  }
  safetyCode(contactId: string) {
    if (this.viaPhone) throw new Error(tm('main.core.safetyOnPhone'));
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
    if (!address) throw new Error(tm('main.core.peerFormat'));
    const lan = this.lan;
    if (!lan) throw new Error(tm('main.core.lanOff'));
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
  walletPayment(): DesktopPaymentState { return this.paymentJournal?.state ?? { state: 'blocked', reason: tm('main.core.paymentNoVault') }; }
  requestWalletPayment(input: PaymentRequestInput): DesktopPaymentState {
    if (!this.paymentJournal) throw new Error(tm('main.core.paymentNoVault'));
    if (!this.viaPhone || this.link.state.state !== 'linked' || !this.link.state.synced) throw new Error(tm('main.core.linkFirst'));
    const p = this.paymentJournal.create(this.walletState.address, input);
    this.emit('walletPayment', this.walletPayment());
    try { this.link.requestPayment(p); } catch { try { this.paymentJournal.disconnected(); } catch { /* fail closed */ } }
    const state = this.walletPayment(); this.emit('walletPayment', state); return state;
  }

  async setWalletAddress(address: string | null) {
    const a = address?.trim() || null;
    if (a) { const err = validateAddress(a); if (err) throw new Error(err); }
    this.walletReadVersion++;
    this.setPrefs({ walletAddress: a });
    this.walletState = this.freshWallet();
    this.emit('wallet', this.walletState);
    return this.walletState.address ? this.refreshWallet() : this.walletState;
  }

  async refreshWallet() {
    if (!this.walletState.address) return this.walletState;
    const version = ++this.walletReadVersion;
    this.walletState = { ...this.walletState, status: 'loading' };
    const requested = this.walletState;
    this.emit('wallet', requested);
    const result = await this.walletReader.read(requested);
    if (version !== this.walletReadVersion || this.walletState.address !== requested.address) return this.walletState;
    this.walletState = { ...result, hidden: this.walletState.hidden };
    if (this.walletState.status === 'ok') {
      const got = this.lastOkWallet ? walletReceived(this.lastOkWallet, this.walletState) : null;
      this.lastOkWallet = this.walletState;
      if (got) this.events.emit('walletReceived', { planck: got.toString() });
    }
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
    // Bloqueios automáticos só com a senha do Piu criada: sem ela, não haveria como desbloquear.
    if ((patch.lockOnSuspend === true || (patch.lockAfter !== undefined && patch.lockAfter !== 'never')) && !this.state.lock?.secret) throw new Error(tm('main.core.lockNeedsPassword'));
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
    if (patch.find !== undefined || patch.relayBandwidth !== undefined || patch.relayRetention !== undefined || patch.relayStorage !== undefined) this.applyMessengerPrefs();
    if (patch.hideBalance !== undefined) { this.walletState = { ...this.walletState, hidden: next.hideBalance }; this.emit('wallet', this.walletState); }
    // Compartilhar meu endereço Lunes: ligar manda o endereço aos contatos públicos; desligar manda "parei" (`wa` vazio).
    if (patch.shareWalletAddress !== undefined && this.mesh && this.keys) {
      if (next.shareWalletAddress) { this.shareWallet(); this.state = { ...this.state, walletShared: this.keys.walletAddress }; }
      else { try { this.mesh.messenger.sendWalletAddress(null); } catch { /* sem contatos */ } this.state = { ...this.state, walletShared: null }; }
    }
    this.scheduleSave();
    this.emit('prefs', next);
    this.emit('session', this.session());
    if (patch.relay !== undefined) this.emit('network', this.networkStatus());
    if (patch.dnd !== undefined) this.emitRinging();
    return next;
  }

  // ── senha do Piu (bloqueio do app) ──────────────────────
  /** `storable`: há onde guardar a senha (cofre do sistema disponível). */
  lockConfig() { return { hasPassword: !!this.state.lock?.secret, storable: !!this.store }; }

  private get attempts(): LockAttempts { return this.state.lock?.attempts ?? NO_ATTEMPTS; }

  /** Grava na hora (sem esperar o `scheduleSave`): fechar o Piu logo depois não pode zerar a espera. */
  private setLock(lock: AppState['lock']) { this.state = { ...this.state, lock }; this.saveNow(); }

  lockAttempts(now = Date.now()) { return { triesLeft: triesLeft(this.attempts), wait: lockWait(this.attempts, now) }; }

  /** Fila da conferência da senha: uma por vez (baixo 28), senão uma rajada passaria inteira pela espera. */
  private lockQueue: Promise<unknown> = Promise.resolve();

  /** Confere a senha do Piu. Durante a espera, recusa sem conferir (e sem contar erro novo). */
  checkLockPassword(pw: string, now = Date.now()): Promise<{ ok: boolean; triesLeft: number; wait: ReturnType<typeof lockWait> }> {
    // A espera é reavaliada só quando chega a vez desta conferência (depois de gravado o erro anterior).
    const run = this.lockQueue.then(() => this.checkLockPasswordNow(pw, now));
    this.lockQueue = run.catch(() => {});
    return run;
  }

  private async checkLockPasswordNow(pw: string, now: number) {
    const lock = this.state.lock;
    if (!lock?.secret) return { ok: false, ...this.lockAttempts(now) };
    if (lockWait(lock.attempts, now)) return { ok: false, ...this.lockAttempts(now) };
    const ok = await verifyLockPassword(String(pw), lock.secret);
    const cur = this.state.lock ?? lock;
    this.setLock({ secret: cur.secret, attempts: ok ? NO_ATTEMPTS : attemptsAfterFailure(cur.attempts, now) });
    return { ok, ...this.lockAttempts(now) };
  }

  /** Criar (sem senha atual) ou trocar (exige a atual, que conta como tentativa). */
  async setLockPassword(current: string | null, next: string) {
    if (!this.store) throw new Error(tm('main.core.noPasswordStore'));
    const problem = lockPasswordProblem(next);
    if (problem) throw new Error(problem);
    if (this.state.lock?.secret) {
      const r = await this.checkLockPassword(current ?? '');
      if (!r.ok) throw new Error(r.wait ? tm('main.core.tooManyTries', { sec: r.wait.remainingSec }) : tm('main.core.wrongPassword'));
    }
    this.setLock({ secret: await hashLockPassword(next), attempts: NO_ATTEMPTS });
    this.emit('prefs', this.state.prefs);
  }

  /** Remover a senha desliga os bloqueios automáticos (não haveria como desbloquear). */
  async removeLockPassword(current: string) {
    if (!this.state.lock?.secret) return;
    const r = await this.checkLockPassword(current);
    if (!r.ok) throw new Error(r.wait ? tm('main.core.tooManyTries', { sec: r.wait.remainingSec }) : tm('main.core.wrongPassword'));
    this.setLock({ secret: null, attempts: NO_ATTEMPTS });
    this.setPrefs({ lockOnSuspend: false, lockAfter: 'never' });
  }
}
