/**
 * Nó de pessoa do Piu Desktop: a camada de mensagens do celular (`Messenger`: Double Ratchet,
 * envelopes selados, fila store-and-forward, convites) ligada aos transportes do computador.
 * Puro TypeScript (sem Electron): testado em test/mesh.test.ts, inclusive contra um piu-node real.
 */
import { canPost, type GroupState } from '../../../mobile/src/messaging/groups';
import { decodeCard, encodeCard } from '../../../mobile/src/messaging/card';
import { type Contact, type IncomingText, Messenger, type MessengerEvents, type RouteInfo } from '../../../mobile/src/messaging/messenger';
import { toHex } from '../../../mobile/src/protocol/bytes';
import type { IdentityKind } from '../../../mobile/src/protocol/keys';
import { safetyNumber } from '../../../mobile/src/protocol/safety';
import type { ContactInfo, Route } from '../shared/types';
import type { Transport, TransportEvent } from '../transport/types';
import type { DerivedKeys } from './identity';

export interface MeshEvents {
  /** Texto de um contato (novo ou conhecido). `isNew`: apareceu como pedido de conversa. */
  message(contact: ContactInfo, m: IncomingText, isNew: boolean): void;
  status(msgId: string, status: 'encaminhada' | 'entregue' | 'expirada', route?: Route): void;
  /** Conversas coletivas mudam sem expor suas chaves ao renderer. */
  groupChanged(contact: ContactInfo, change: 'joined' | 'updated' | 'removed'): void;
  groupMessage(contact: ContactInfo, m: IncomingText, sender: string): void;
  /** Algo no estado do Messenger mudou (salvar). */
  changed(): void;
  /** Vizinhos/enlaces mudaram. */
  peers(): void;
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
}

const toRoute = (r?: RouteInfo): Route | undefined => (r ? { peer: r.peer, via: r.via, bytes: r.bytes, hops: r.hops, priority: r.priority } : undefined);

export const toContactInfo = (c: Contact): ContactInfo => ({ id: c.id, name: c.name, via: c.via, request: !!c.request });

export class MeshNode {
  readonly messenger: Messenger;
  private unsubs: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(private o: MeshOptions) {
    const now = o.now ?? (() => Math.floor(Date.now() / 1000));
    const events: Partial<MessengerEvents> = {
      message: (contactId, m) => { const c = this.messenger.getContact(contactId); if (c) o.events.message?.(toContactInfo(c), m, false); },
      newContact: (c, m) => o.events.message?.(toContactInfo(c), m, true),
      status: (msgId, status, route) => o.events.status?.(msgId, status, toRoute(route)),
      groupUpdated: (g, change) => o.events.groupChanged?.(this.groupInfo(g), change),
      groupMessage: (id, _from, sender, m) => { const g = this.messenger.getGroup(id); if (g) o.events.groupMessage?.(this.groupInfo(g), m, sender); },
      changed: () => o.events.changed?.(),
    };
    this.messenger = new Messenger({
      identities: o.keys.identities,
      node: o.keys.node,
      relay: o.relay,
      now,
      transmit: (peerId, bytes) => this.transmit(peerId, bytes),
      events,
      state: o.state ?? undefined,
    });
    this.messenger.displayName = o.displayName;
  }

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
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const u of this.unsubs.splice(0)) u();
    await Promise.all(this.o.transports.map(t => t.stop()));
    this.messenger.clearPeers();
  }

  private onTransport(t: Transport, e: TransportEvent) {
    switch (e.type) {
      case 'connected': this.messenger.peerConnected(e.id, 'eth'); this.o.events.peers?.(); break;
      case 'disconnected': this.messenger.peerDisconnected(e.id); this.o.events.peers?.(); break;
      case 'envelope': {
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
    throw lastErr ?? new Error('Nenhum transporte ligado.');
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
    if (!options.name.trim()) throw new Error('O nome não pode ficar vazio.');
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
  private groupId(id: string): string {
    if (!/^group:[0-9a-f]{32}$/.test(id)) throw new Error('Grupo desconhecido.');
    return id.slice(6);
  }

  listContacts(): ContactInfo[] { return this.messenger.listContacts().map(toContactInfo); }
  removeContact(id: string) { this.messenger.removeContact(id); }

  /** Código de segurança 12 × 5 entre mim (identidade usada com ele) e o contato. */
  safetyCode(contactId: string): string[] {
    const c = this.messenger.getContact(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    return safetyNumber(this.o.keys.identities[c.via], c.pub);
  }

  /** Id novo de mensagem (quem chama pode registrar a mensagem ANTES de enfileirar, para não perder o primeiro estado). */
  newMessageId(): string { return `${Date.now().toString(36)}-${(++this.seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

  /** Cifra e enfileira; devolve o id da mensagem (estados chegam por `events.status`, já durante esta chamada). */
  sendText(contactId: string, text: string, msgId = this.newMessageId()): string {
    if (contactId.startsWith('group:')) {
      this.messenger.sendGroupText(this.groupId(contactId), msgId, text);
      this.messenger.tick();
      return msgId;
    }
    this.messenger.sendText(contactId, msgId, text);
    // Responder a um pedido de conversa o transforma em conversa normal.
    const c = this.messenger.getContact(contactId);
    if (c?.request) this.messenger.addContact({ ...c, request: false });
    this.messenger.tick();
    return msgId;
  }

  export() { return this.messenger.export(); }
}
