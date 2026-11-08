/**
 * Nó de pessoa do Piu Desktop: a camada de mensagens do celular (`Messenger`: Double Ratchet,
 * envelopes selados, fila store-and-forward, convites) ligada aos transportes do computador.
 * Puro TypeScript (sem Electron): testado em test/mesh.test.ts, inclusive contra um piu-node real.
 */
import { canPost, type GroupState } from '../../../mobile/src/messaging/groups';
import { decodeCard, encodeCard } from '../../../mobile/src/messaging/card';
import { type Contact, type IncomingText, Messenger, type MessengerEvents, type RouteInfo } from '../../../mobile/src/messaging/messenger';
import type { AlertNotice, AlertView } from '../../../mobile/src/messaging/communityAlerts';
import { toHex } from '../../../mobile/src/protocol/bytes';
import type { IdentityKind } from '../../../mobile/src/protocol/keys';
import { safetyNumber } from '../../../mobile/src/protocol/safety';
import { CarryGateway } from '../../../mobile/src/lib/carryGateway';
import { bundlePoster } from '../../../mobile/src/lib/carryConfig';
import { finalizedHead, LunesRpc } from '../../../mobile/src/lib/lunesRpc';
import type { ContactInfo, Route } from '../shared/types';
import type { Transport, TransportEvent } from '../transport/types';
import type { DerivedKeys } from './identity';
import { tm } from './i18n';
import { CallService, type CallServicePorts } from '../../../mobile/src/calls/callService';
import { LIVE_SIGNAL_TTL_SEC, REQUEST_TTL_SEC } from '../../../mobile/src/calls/callSignals';
import { routeOfMedium } from '../../../mobile/src/calls/callMedia';
import type { LiveRoute } from '../../../mobile/src/calls/callMachine';

/** Portas da chamada que dependem do aparelho (áudio, registro na conversa, avisos). */
export type MeshCallPorts = Pick<CallServicePorts, 'audio' | 'record' | 'requestUpdate' | 'toast' | 'draft'> & {
  newId(): string;
  /** Contato bloqueado neste aparelho: o sinal de chamada dele é ignorado (não toca). */
  blocked?(peer: string): boolean;
};

export interface MeshEvents {
  /** Texto de um contato (novo ou conhecido). `isNew`: apareceu como pedido de conversa. */
  message(contact: ContactInfo, m: IncomingText, isNew: boolean): void;
  status(msgId: string, status: 'encaminhada' | 'entregue' | 'expirada', route?: Route): void;
  /** Conversas coletivas mudam sem expor suas chaves ao renderer. */
  groupChanged(contact: ContactInfo, change: 'joined' | 'updated' | 'removed'): void;
  groupMessage(contact: ContactInfo, m: IncomingText, sender: string): void;
  /** Algo no estado do Messenger mudou (salvar). */
  changed(): void;
  /** Um contato público aceito compartilhou (`address`) ou retirou (`null`) o endereço Lunes dele. */
  peerWallet(contactId: string, address: string | null): void;
  /** Vizinhos/enlaces mudaram. */
  peers(): void;
  /** O contato está digitando (sinal efêmero `ty`; só de contato aceito). */
  typing(contactId: string): void;
  /**
   * Alerta da comunidade novo ou mudado (mensageiro do celular, `communityAlert`). `contactId`: a conversa da
   * comunidade (`group:<id>`), para conferir se está silenciada. `notice`: o que merece aviso (`noticeFor`).
   */
  communityAlert(a: { id: string; contactId: string; sev: AlertView['sev']; cat: AlertView['cat']; title: string; area: string; communityName: string }, notice: AlertNotice | null): void;
  /** O contato leu estas mensagens minhas (recibo `r`, só se o ajuste dele estiver ligado). */
  read(contactId: string, msgIds: string[]): void;
  /** O estado da chamada de voz mudou. */
  call(): void;
}

export interface MeshOptions {
  keys: DerivedKeys;
  transports: Transport[];
  /** `Messenger.export()` gravado da última vez. */
  state?: string | null;
  relay: boolean;
  displayName: string;
  events: Partial<MeshEvents>;
  now?: () => number;
  log?: (msg: string) => void;
  /** Privacidade → Metadados (lidos a cada envio, como no celular): atraso aleatório e preenchimento. */
  randomDelay?: () => boolean;
  pad?: () => boolean;
  /**
   * Chamada de voz (src/calls do celular): sem isto, o nó não atende nem liga.
   */
  call?: MeshCallPorts;
  /**
   * Computador como gateway da carga pela malha (docs/carteira/transacoes-pela-malha.md), opcional: com
   * rota até a Lunes, envia as transações assinadas que chegam e devolve o recibo. Ausente: desligado.
   * `inboxUrl`: caixa HTTPS do validador para os pacotes (padrão: nenhuma).
   */
  gateway?: { rpc?: () => LunesRpc; inboxUrl?: string | null; probeMs?: number; tickMs?: number } | null;
}

const toRoute = (r?: RouteInfo): Route | undefined => (r ? { peer: r.peer, via: r.via, bytes: r.bytes, hops: r.hops, priority: r.priority } : undefined);

/** `lunes` (endereço que o contato compartilhou por `wa`, já conferido pelo Messenger) vira `lunesAddress`. */
export const toContactInfo = (c: Contact): ContactInfo => ({ id: c.id, name: c.name, via: c.via, request: !!c.request, ...(c.lunes ? { lunesAddress: c.lunes } : {}) });

export class MeshNode {
  readonly messenger: Messenger;
  private unsubs: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  /** Vizinhos com enlace aberto e o meio de cada um (para a voz ir direto). */
  private links = new Map<string, 'lan' | 'ble'>();
  readonly call: CallService | null = null;

  constructor(private o: MeshOptions) {
    const now = o.now ?? (() => Math.floor(Date.now() / 1000));
    const events: Partial<MessengerEvents> = {
      message: (contactId, m) => { const c = this.messenger.getContact(contactId); if (c) o.events.message?.(toContactInfo(c), m, false); },
      newContact: (c, m) => o.events.message?.(toContactInfo(c), m, true),
      status: (msgId, status, route) => o.events.status?.(msgId, status, toRoute(route)),
      groupUpdated: (g, change) => o.events.groupChanged?.(this.groupInfo(g), change),
      groupMessage: (id, _from, sender, m) => { const g = this.messenger.getGroup(id); if (g) o.events.groupMessage?.(this.groupInfo(g), m, sender); },
      changed: () => o.events.changed?.(),
      peerWallet: (contactId, address) => o.events.peerWallet?.(contactId, address),
      typing: contactId => o.events.typing?.(contactId),
      read: (contactId, msgIds) => o.events.read?.(contactId, msgIds),
      callSignal: (contactId, payload) => { if (!o.call?.blocked?.(contactId)) this.call?.onSignal(contactId, payload); },
      communityAlert: (v, notice) => o.events.communityAlert?.({ id: v.id, contactId: `group:${v.community}`, sev: v.sev, cat: v.cat, title: v.title, area: v.area ?? '', communityName: v.communityName }, notice),
      gatewayCarry: c => { void this.carryGateway?.handle(c).then(r => o.log?.(`gateway: carga ${c.id.slice(0, 8)}… → ${r}`)); },
    };
    this.messenger = new Messenger({
      identities: o.keys.identities,
      node: o.keys.node,
      relay: o.relay,
      now,
      transmit: (peerId, bytes) => this.transmit(peerId, bytes),
      events,
      state: o.state ?? undefined,
      randomDelay: o.randomDelay,
      pad: o.pad,
    });
    this.messenger.displayName = o.displayName;
    if (o.call) this.call = this.makeCall(o.call);
    if (o.gateway) {
      const g = o.gateway, rpc = g.rpc ?? (() => new LunesRpc());
      const post = bundlePoster(g.inboxUrl ?? null);
      this.carryGateway = new CarryGateway({ rpc, now, postBundle: post, log: o.log, reply: (to, rc) => this.messenger.sendCarryReceipt(to, rc) });
      this.gatewayProbe = async () => {
        const c = rpc();
        try { await finalizedHead(c); this.messenger.setGateway({ tx: true, inbox: !!post }); return true; }
        catch { this.messenger.setGateway({}); return false; }
        finally { c.close(); }
      };
    }
  }

  private carryGateway: CarryGateway | null = null;
  private gatewayProbe: (() => Promise<boolean>) | null = null;
  private gatewayTimers: NodeJS.Timeout[] = [];
  /** Gateway agora (com rota até a Lunes)? Também sonda de novo. `false` sem a opção. */
  async probeGateway() { return this.gatewayProbe ? this.gatewayProbe() : false; }
  get gatewayStats() { return this.carryGateway ? { ...this.carryGateway.counters, roles: this.messenger.gateway } : null; }

  get nodePk() { return toHex(this.o.keys.node.pk); }
  get ids() { return { publicId: this.o.keys.identities.public.id, anonId: this.o.keys.identities.anon.id }; }

  /** Liga os transportes e a rodada periódica do Messenger (atrasos, vencimentos, reenvio). */
  async start(tickMs = 1000) {
    for (const t of this.o.transports) {
      this.unsubs.push(t.subscribe(e => this.onTransport(t, e)));
      await t.start();
    }
    this.timer = setInterval(() => { try { this.messenger.tick(); } catch (e) { this.o.log?.(`mesh: tick falhou (${(e as Error).message})`); } }, tickMs);
    this.timer.unref();
    if (this.carryGateway && this.gatewayProbe) {
      const gw = this.carryGateway, probe = this.gatewayProbe;
      void probe();
      this.gatewayTimers = [setInterval(() => { void probe(); }, this.o.gateway?.probeMs ?? 60_000), setInterval(() => { void gw.tick(); }, this.o.gateway?.tickMs ?? 15_000)];
      for (const t of this.gatewayTimers) t.unref();
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.gatewayTimers.splice(0)) clearInterval(t);
    this.messenger.setGateway({});
    for (const u of this.unsubs.splice(0)) u();
    this.call?.dispose();
    this.links.clear();
    await Promise.all(this.o.transports.map(t => t.stop()));
    this.messenger.clearPeers();
  }

  private makeCall(c: MeshCallPorts): CallService {
    const svc = new CallService({
      ...c,
      now: () => Date.now(),
      sendSignal: (peer, wire, live) => this.messenger.sendCallSignal(peer, wire, live
        ? { live: true, ttlSec: LIVE_SIGNAL_TTL_SEC }
        : { live: false, ttlSec: REQUEST_TTL_SEC, msgId: wire.s.t === 'request' ? wire.s.requestId : undefined }),
      liveRouteTo: peer => this.liveRouteTo(peer),
      links: () => [...this.links].map(([peerId, medium]) => ({ peerId, medium })),
      sendFrame: (peerId, frame) => { void this.transmit(peerId, frame).catch(() => {}); },
    });
    svc.subscribe(() => this.o.events.call?.());
    return svc;
  }

  /** Caminho ao vivo até o contato agora: vizinho direto visto nos últimos 2 min, ainda conectado. */
  liveRouteTo(peer: string): LiveRoute | null {
    const link = this.messenger.directLink(peer, 120);
    const medium = link ? this.links.get(link) : undefined;
    return medium ? routeOfMedium(medium, false) : null;
  }

  private onTransport(t: Transport, e: TransportEvent) {
    switch (e.type) {
      case 'connected': this.links.set(e.id, t.kind); this.messenger.peerConnected(e.id, 'eth'); this.o.events.peers?.(); this.call?.tryWaiting(); break;
      case 'disconnected': this.links.delete(e.id); this.messenger.peerDisconnected(e.id); this.o.events.peers?.(); break;
      case 'envelope': {
        // Voz da chamada: quadros 'V' vão direto para a chamada, nunca para o roteador.
        if (this.call?.onFrame(e.from, t.kind, e.data)) break;
        try { this.messenger.receive(e.from, e.data); }
        catch (err) { this.o.log?.(`mesh: envelope de ${e.from} recusado (${(err as Error).message})`); }
        break;
      }
      case 'peers': case 'state': this.o.events.peers?.(); break;
    }
    void t;
  }

  private async transmit(peerId: string, bytes: Uint8Array) {
    let lastErr: Error | null = null;
    for (const t of this.o.transports) {
      if (t.state !== 'running') continue;
      try { await t.send(peerId, bytes); return; } catch (e) { lastErr = e as Error; }
    }
    throw lastErr ?? new Error(tm('main.mesh.noTransport'));
  }

  set relay(v: boolean) { this.messenger.relay = v; }
  set displayName(n: string) { this.messenger.displayName = n; }

  // ── contatos ──────────────────────────────────────────────
  /** Meu cartão (conteúdo do QR / código para colar) da identidade `kind`. */
  myCard(kind: IdentityKind, fresh = false): { card: string; expiresAt: number; id: string } {
    const inv = this.messenger.issueInvite(kind, fresh);
    const me = this.o.keys.identities[kind];
    return { card: encodeCard(me, this.o.displayName, inv), expiresAt: inv.expiresAt, id: me.id };
  }

  /** Cartão de outra pessoa (colado/escaneado): vira contato pela MINHA identidade do mesmo tipo. */
  addContactByCard(text: string): ContactInfo {
    const card = decodeCard(text, this.o.now ? this.o.now() : Math.floor(Date.now() / 1000));
    const c: Contact = { id: card.id, via: card.kind, pub: card.pub, name: card.name, invite: card.invite };
    this.messenger.addContact(c);
    return toContactInfo(this.messenger.getContact(card.id)!);
  }

  private groupInfo(g: GroupState): ContactInfo {
    return { id: `group:${g.id}`, name: g.name, via: g.via, kind: g.kind, request: false,
      canPost: canPost(g, this.o.keys.identities[g.via].id), subtitle: g.desc || undefined };
  }

  listGroups(): ContactInfo[] { return this.messenger.listGroups().map(g => this.groupInfo(g)); }

  createGroup(options: Parameters<Messenger['createGroup']>[0]): ContactInfo {
    if (!options.name.trim()) throw new Error(tm('main.mesh.emptyName'));
    const group = this.messenger.createGroup(options);
    const contact = this.groupInfo(group);
    this.o.events.groupChanged?.(contact, 'joined');
    this.messenger.tick();
    return contact;
  }

  updateGroup(id: string, patch: Parameters<Messenger['updateGroup']>[1]) {
    const group = this.messenger.updateGroup(this.groupId(id), patch);
    this.o.events.groupChanged?.(this.groupInfo(group), 'updated');
    this.messenger.tick();
  }
  addGroupMembers(id: string, ids: string[]) { const g = this.messenger.addMembers(this.groupId(id), ids); this.o.events.groupChanged?.(this.groupInfo(g), 'updated'); this.messenger.tick(); }
  removeGroupMember(id: string, memberId: string) { const g = this.messenger.removeMember(this.groupId(id), memberId); this.o.events.groupChanged?.(this.groupInfo(g), 'updated'); this.messenger.tick(); }
  setGroupRole(id: string, memberId: string, role: 'admin' | 'mod' | 'member') { const g = this.messenger.setRole(this.groupId(id), memberId, role); this.o.events.groupChanged?.(this.groupInfo(g), 'updated'); this.messenger.tick(); }
  leaveGroup(id: string) { const gid = this.groupId(id); const g = this.messenger.getGroup(gid); this.messenger.leaveGroup(gid); if (g) this.o.events.groupChanged?.(this.groupInfo(g), 'removed'); this.messenger.tick(); }
  /** Ids dos membros de um grupo meu (para não convidar quem já está). Grupo desconhecido: erro. */
  groupMemberIds(id: string): string[] {
    const g = this.messenger.getGroup(this.groupId(id));
    if (!g) throw new Error(tm('main.mesh.unknownGroup'));
    return g.members.map(m => m.id);
  }

  private groupId(id: string): string {
    if (!/^group:[0-9a-f]{32}$/.test(id)) throw new Error(tm('main.mesh.unknownGroup'));
    return id.slice(6);
  }

  listContacts(): ContactInfo[] { return this.messenger.listContacts().map(toContactInfo); }
  removeContact(id: string) { this.messenger.removeContact(id); }

  /** Código de segurança 12 × 5 entre mim (identidade usada com ele) e o contato. */
  safetyCode(contactId: string): string[] {
    const c = this.messenger.getContact(contactId);
    if (!c) throw new Error(tm('main.mesh.unknownContact'));
    return safetyNumber(this.o.keys.identities[c.via], c.pub);
  }

  /** Id novo de mensagem (quem chama pode registrar a mensagem ANTES de enfileirar, para não perder o primeiro estado). */
  newMessageId(): string { return `${Date.now().toString(36)}-${(++this.seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

  /**
   * Cifra e enfileira; devolve o id da mensagem (estados chegam por `events.status`, já durante esta chamada).
   * `expireSec`: mensagem temporária (só conversa direta; campo `e` do celular, some nos dois lados).
   */
  sendText(contactId: string, text: string, msgId = this.newMessageId(), expireSec?: number): string {
    if (contactId.startsWith('group:')) {
      this.messenger.sendGroupText(this.groupId(contactId), msgId, text);
      this.messenger.tick();
      return msgId;
    }
    this.messenger.sendText(contactId, msgId, text, expireSec);
    // Responder a um pedido de conversa o transforma em conversa normal.
    const c = this.messenger.getContact(contactId);
    if (c?.request) this.messenger.addContact({ ...c, request: false });
    this.messenger.tick();
    return msgId;
  }

  export() { return this.messenger.export(); }
}
