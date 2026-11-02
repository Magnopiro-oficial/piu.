/**
 * Mensageiro: liga as sessões cifradas (Double Ratchet dentro do envelope selado), o roteador
 * store-and-forward e o transporte por perto. Puro TypeScript, testável no Node.
 *
 * - Enviar: cifra na sessão do contato, guarda na fila do roteador e entrega a cada vizinho conectado.
 *   Quem não é o destino só guarda e repassa (se estiver com o Modo nó ligado), sem conseguir ler.
 * - Receber: o roteador confere integridade, autenticidade, validade e duplicatas; a sessão decifra.
 * - Confirmação de entrega: o destino responde com um recibo DENTRO da sessão (os relays não sabem
 *   que é um recibo). Ao receber o recibo, a mensagem vira "entregue" e sai da fila.
 * - Estado salvo (`export`): sessões, fila própria, ids vistos (contra replay) e contatos.
 *   Contém segredos: o app guarda cifrado (lib/persist.ts).
 */
import { fromUtf8, toHex, utf8 } from '../protocol/bytes';
import { random } from '../protocol/suite';
import { envelopeId, Priority } from '../protocol/envelope';
import { identityId, type Identity, type IdentityKind, type KeyPair, type PublicIdentity, verifyBinding } from '../protocol/keys';
import { randomDelaySec, Router, type TransportClass } from '../protocol/router';
import { SessionManager } from '../protocol/sessions';
import { b64url, unb64url } from './card';

export interface Contact {
  /** `piu:…` da identidade do contato. */
  id: string;
  /** Qual das MINHAS identidades conversa com este contato (listas separadas). */
  via: IdentityKind;
  pub: PublicIdentity;
  name: string;
  /** Escreveu primeiro (usou o meu convite) sem que eu tivesse o código dele. */
  request?: boolean;
  /** Código do convite do cartão que EU escaneei: vai nas primeiras mensagens até a sessão firmar. */
  invite?: string;
}

/** Convite emitido por mim (o código vai no QR). Uso único; vence com o cartão. */
interface Invite { code: string; kind: IdentityKind; expiresAt: number }

export interface IncomingText { msgId: string; text: string; sentAt: number }

export interface MessengerEvents {
  /** Mensagem nova de um contato conhecido. */
  message(contactId: string, m: IncomingText): void;
  /** Alguém que tem o meu código escreveu pela primeira vez (pedido de conversa). */
  newContact(c: Contact, m: IncomingText): void;
  /** `encaminhada`: saiu deste aparelho para um vizinho; `entregue`: o destino confirmou. */
  status(msgId: string, status: 'encaminhada' | 'entregue' | 'expirada'): void;
  /** Um convite meu foi usado: o QR precisa mostrar um código novo. */
  inviteUsed(): void;
  /** Estado mudou: salvar `export()`. */
  changed(): void;
}

/**
 * Limites do nó escolhidos pela pessoa (FUN-017). Valem para mensagens de TERCEIROS: as próprias
 * sempre saem. `hours`: 'night' = só das 22h às 7h (hora local).
 */
export interface NodePolicy {
  maxBytes: number;
  retentionSec: number;
  /** Tráfego de terceiros por dia (bytes); acima disso, para de retransmitir até o dia seguinte. */
  dailyBytes: number;
  /** Banda para terceiros (bytes por segundo); `Infinity` = sem limite. */
  bytesPerSec: number;
  hours: 'always' | 'night';
}

export interface MessengerOptions {
  identities: Record<IdentityKind, Identity>;
  node: KeyPair;
  relay: boolean;
  /** Relógio em segundos. */
  now: () => number;
  /** Entrega bytes a um vizinho pelo transporte. */
  transmit: (peerId: string, bytes: Uint8Array) => Promise<void>;
  events: Partial<MessengerEvents>;
  /** Ajuste de Privacidade "Atraso aleatório no envio". */
  randomDelay?: () => boolean;
  /** Ajuste de Privacidade "Igualar tamanho das mensagens". */
  pad?: () => boolean;
  state?: string;
}

/** Conteúdo dentro da sessão. Curto de propósito: cada byte conta em LoRa e Bluetooth. */
type Payload =
  | { t: 'm'; i: string; x: string; n?: string; k?: string }
  | { t: 'a'; i: string[] };

interface Outgoing { env: string; msgId: string; to: string; bytes: string; forwarded: boolean }

const TTL_SEC = 3 * 24 * 3600;
const MAX_TEXT = 4000;
const MAX_CONTACTS_FROM_STRANGERS = 50;
const MAX_DELIVERED_IDS = 5000;
const INVITE_TTL_SEC = 24 * 3600;
const MAX_INVITES = 100;
const randomHex = (n: number) => toHex(random(n));

export class Messenger {
  readonly router: Router;
  private managers: Record<IdentityKind, SessionManager>;
  private contacts = new Map<string, Contact>();
  private outbox = new Map<string, Outgoing>();
  private delivered: string[] = [];
  private deliveredSet = new Set<string>();
  private peers = new Map<string, TransportClass>();
  private invites = new Map<string, Invite>();
  private wantRelay: boolean;
  private policy: NodePolicy | null = null;
  /** Bytes de terceiros enviados hoje (dia local) e o balde de banda. */
  private relayDay = { day: '', bytes: 0 };
  private bw = { tokens: 0, at: 0 };
  /** Hora local (0–23) e dia; injetáveis nos testes. */
  clock = { hour: () => new Date().getHours(), day: () => new Date().toDateString() };
  private o: MessengerOptions;
  /** Nome enviado na primeira mensagem para quem ainda não nos conhece. */
  displayName = '';

  constructor(o: MessengerOptions) {
    this.o = o;
    const st = o.state ? JSON.parse(o.state) : null;
    this.managers = {
      public: st?.s?.public ? SessionManager.import(o.identities.public, st.s.public) : new SessionManager(o.identities.public),
      anon: st?.s?.anon ? SessionManager.import(o.identities.anon, st.s.anon) : new SessionManager(o.identities.anon),
    };
    this.wantRelay = o.relay;
    this.router = new Router({
      node: o.node,
      identities: [o.identities.public, o.identities.anon],
      relay: o.relay,
      acceptDest: (d, e) => this.managers.public.acceptsDest(d, e) || this.managers.anon.acceptsDest(d, e),
    });
    if (!st) return;
    for (const c of st.c ?? []) this.contacts.set(c.id, { id: c.id, via: c.via, name: c.name, request: !!c.r, invite: c.k || undefined, pub: { signPk: unb64url(c.s), agreePk: unb64url(c.a), binding: unb64url(c.b) } });
    for (const i of (st.inv ?? []) as Invite[]) if (i.expiresAt > o.now()) this.invites.set(i.code, i);
    // A fila própria volta antes dos ids vistos (senão os próprios envelopes contariam como repetidos).
    for (const q of (st.q ?? []) as Outgoing[]) {
      if (this.router.send(unb64url(q.bytes), o.now()).status === 'stored') this.outbox.set(q.env, q);
    }
    this.router.importSeen(st.seen ?? [], o.now());
    for (const d of st.d ?? []) this.markDelivered(d);
  }

  set relay(v: boolean) { this.wantRelay = v; this.applyRelay(); }

  /** Aplica os limites do nó: espaço e prazo no roteador; banda, tráfego diário e horário aqui. */
  setPolicy(p: NodePolicy) {
    this.policy = p;
    this.router.limits.maxBytes = p.maxBytes;
    this.router.limits.maxRetentionSec = p.retentionSec;
    this.applyRelay();
  }

  /** Estado dos limites, para a tela de diagnóstico. */
  relayStatus() {
    this.rollDay();
    const p = this.policy;
    const reason = !this.wantRelay ? 'off' : p && p.hours === 'night' && !this.isNight() ? 'hours' : p && this.relayDay.bytes >= p.dailyBytes ? 'daily' : null;
    return { relaying: this.router.relay, reason: reason as null | 'off' | 'hours' | 'daily', bytesToday: this.relayDay.bytes };
  }

  private isNight() { const h = this.clock.hour(); return h >= 22 || h < 7; }
  private rollDay() { const d = this.clock.day(); if (d !== this.relayDay.day) this.relayDay = { day: d, bytes: 0 }; }
  private applyRelay() {
    this.rollDay();
    const p = this.policy;
    const allowed = this.wantRelay && (!p || ((p.hours === 'always' || this.isNight()) && this.relayDay.bytes < p.dailyBytes));
    this.router.relay = allowed;
  }

  addContact(c: Contact) {
    if (!verifyBinding(c.pub) || identityId(c.pub.signPk, c.pub.agreePk) !== c.id) throw new Error('Chaves do contato inválidas.');
    const mine = [this.o.identities.public.id, this.o.identities.anon.id];
    if (mine.includes(c.id)) throw new Error('Este é o seu próprio código.');
    const cur = this.contacts.get(c.id);
    this.contacts.set(c.id, { ...c, name: c.name || cur?.name || '', request: false });
    this.o.events.changed?.();
  }

  getContact(id: string) { return this.contacts.get(id); }
  listContacts() { return [...this.contacts.values()]; }

  removeContact(id: string) {
    this.contacts.delete(id);
    for (const [k, q] of this.outbox) if (q.to === id) { this.outbox.delete(k); this.router.forget(k); }
    this.o.events.changed?.();
  }

  /** Mensagens ainda na fila para um contato (aguardando rota ou confirmação). */
  pendingFor(contactId: string) { return [...this.outbox.values()].filter(q => q.to === contactId).map(q => q.msgId); }

  /** Cifra e enfileira. `msgId` é o id da mensagem na conversa (para os estados). */
  /**
   * Convite atual para o QR da identidade `kind`: o mesmo enquanto não for usado e tiver mais de 1 h
   * de validade; `fresh` revoga os anteriores dessa identidade e gera outro ("Gerar novo código").
   */
  issueInvite(kind: IdentityKind, fresh = false): { code: string; expiresAt: number } {
    const now = this.o.now();
    for (const [k, i] of this.invites) if (i.expiresAt <= now || (fresh && i.kind === kind)) this.invites.delete(k);
    if (!fresh) {
      const cur = [...this.invites.values()].filter(i => i.kind === kind && i.expiresAt - now > 3600).sort((a, b) => b.expiresAt - a.expiresAt)[0];
      if (cur) return { code: cur.code, expiresAt: cur.expiresAt };
    }
    const inv: Invite = { code: randomHex(8), kind, expiresAt: now + INVITE_TTL_SEC };
    this.invites.set(inv.code, inv);
    while (this.invites.size > MAX_INVITES) this.invites.delete(this.invites.keys().next().value!);
    this.o.events.changed?.();
    return { code: inv.code, expiresAt: inv.expiresAt };
  }

  sendText(contactId: string, msgId: string, text: string) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    const x = text.slice(0, MAX_TEXT);
    const mgr = this.managers[c.via];
    const p: Payload = { t: 'm', i: msgId, x };
    const firm = mgr.get(contactId)?.established;
    if (!firm && c.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    if (!firm && c.invite) p.k = c.invite; // prova que escaneei o QR (uso único do lado de lá)
    this.enqueue(c, p, msgId, Priority.Normal);
  }

  private enqueue(c: Contact, p: Payload, msgId: string | null, priority: Priority) {
    const now = this.o.now();
    const sealed = this.managers[c.via].seal(c.pub, utf8(JSON.stringify(p)), { now, ttlSec: TTL_SEC, priority, pad: this.o.pad?.() ?? true });
    const delaySec = msgId && this.o.randomDelay?.() ? randomDelaySec() : 0;
    const r = this.router.send(sealed.bytes, now, { delaySec });
    if (msgId && r.status === 'stored') this.outbox.set(sealed.id, { env: sealed.id, msgId, to: c.id, bytes: b64url(sealed.bytes), forwarded: false });
    this.o.events.changed?.();
    this.flushAll();
  }

  peerConnected(peerId: string, via: TransportClass) { this.peers.set(peerId, via); this.flush(peerId); }
  peerDisconnected(peerId: string) { this.peers.delete(peerId); }
  clearPeers() { this.peers.clear(); }

  /** Chamar de tempos em tempos: libera envios com atraso aleatório e apaga o que venceu. */
  tick() {
    this.applyRelay();
    this.router.purge(this.o.now());
    // Venceu o TTL sem confirmação: sai da fila e a conversa mostra "expirada" (com Reenviar).
    let changed = false;
    for (const [k, q] of this.outbox) {
      if (this.router.has(k)) continue;
      this.outbox.delete(k); changed = true;
      this.o.events.status?.(q.msgId, 'expirada');
    }
    if (changed) this.o.events.changed?.();
    this.flushAll();
  }

  private flushAll() { for (const p of this.peers.keys()) this.flush(p); }

  private flush(peerId: string) {
    const via = this.peers.get(peerId);
    if (!via) return;
    const now = this.o.now();
    // Banda e tráfego diário só limitam mensagens de terceiros.
    let budget = Infinity;
    const p = this.policy;
    if (p) {
      this.rollDay();
      if (Number.isFinite(p.bytesPerSec)) {
        const burst = p.bytesPerSec * 2;
        this.bw.tokens = this.bw.at ? Math.min(burst, this.bw.tokens + (now - this.bw.at) * p.bytesPerSec) : burst;
        this.bw.at = now;
        budget = this.bw.tokens;
      }
      budget = Math.min(budget, Math.max(0, p.dailyBytes - this.relayDay.bytes));
    }
    const out = this.router.outgoing(peerId, via, now, { thirdPartyBudget: budget });
    let changed = false;
    for (const bytes of out) {
      const id = envelopeId(bytes);
      if (!this.router.isOwn(id)) {
        this.relayDay.bytes += bytes.length;
        if (Number.isFinite(this.bw.tokens)) this.bw.tokens = Math.max(0, this.bw.tokens - bytes.length);
      }
      const q = this.outbox.get(id);
      if (q && !q.forwarded) { q.forwarded = true; changed = true; this.o.events.status?.(q.msgId, 'encaminhada'); }
      this.o.transmit(peerId, bytes).catch(() => { /* o vizinho saiu; fica na fila para o próximo */ });
    }
    if (p && this.relayDay.bytes >= p.dailyBytes) this.applyRelay(); // chegou ao limite do dia
    if (changed) this.o.events.changed?.();
  }

  /** Bytes que chegaram de um vizinho. */
  receive(peerId: string, bytes: Uint8Array) {
    const r = this.router.ingest(bytes, peerId, this.o.now());
    if (r.status === 'stored') { this.o.events.changed?.(); this.flushAll(); return r; } // retransmissão para terceiros
    if (r.status !== 'delivered') return r;
    const m = r.message;
    const via: IdentityKind = this.contacts.get(m.fromId)?.via ?? (this.managers.anon.get(m.fromId) ? 'anon' : 'public');
    // Abre na sessão da identidade que recebeu; tenta a outra se não abrir (primeira mensagem).
    let pt = this.managers[via].open(m), used: IdentityKind = via;
    if (!pt) { used = via === 'public' ? 'anon' : 'public'; pt = this.managers[used].open(m); }
    this.o.events.changed?.();
    if (!pt) return r;
    let p: Payload;
    try { p = JSON.parse(fromUtf8(pt)); } catch { return r; }
    if (p?.t === 'a' && Array.isArray(p.i)) {
      for (const id of p.i.slice(0, 64)) {
        for (const [k, q] of this.outbox) {
          if (q.msgId === id && q.to === m.fromId) { this.outbox.delete(k); this.router.forget(k); this.o.events.status?.(id, 'entregue'); }
        }
      }
      this.o.events.changed?.();
      return r;
    }
    if (p?.t !== 'm' || typeof p.i !== 'string' || typeof p.x !== 'string' || p.i.length > 64) return r;
    let c = this.contacts.get(m.fromId);
    // Sempre confirma (mesmo repetida: o recibo anterior pode ter se perdido).
    const isNew = !c;
    if (!c) {
      // Contato novo só com convite válido, emitido por mim para a identidade que recebeu, e ainda não usado.
      const inv = typeof p.k === 'string' ? this.invites.get(p.k) : undefined;
      if (!inv || inv.kind !== used || inv.expiresAt <= this.o.now()) { this.o.events.changed?.(); return r; }
      const strangers = [...this.contacts.values()].filter(x => x.request).length;
      if (strangers >= MAX_CONTACTS_FROM_STRANGERS) return r; // contra enxurrada de pedidos
      this.invites.delete(inv.code); // uso único
      this.o.events.inviteUsed?.();
      const name = typeof p.n === 'string' && used === 'public' ? p.n.slice(0, 40) : '';
      c = { id: m.fromId, via: used, pub: m.from, name, request: true };
      this.contacts.set(c.id, c);
    }
    this.enqueue(c, { t: 'a', i: [p.i] }, null, Priority.High);
    const key = `${m.fromId}|${p.i}`;
    if (this.deliveredSet.has(key)) return r; // já mostrada
    this.markDelivered(key);
    const msg: IncomingText = { msgId: p.i, text: p.x.slice(0, MAX_TEXT), sentAt: m.sentAt };
    if (isNew) this.o.events.newContact?.(c, msg); else this.o.events.message?.(c.id, msg);
    this.o.events.changed?.();
    return r;
  }

  private markDelivered(key: string) {
    if (this.deliveredSet.has(key)) return;
    this.deliveredSet.add(key); this.delivered.push(key);
    while (this.delivered.length > MAX_DELIVERED_IDS) this.deliveredSet.delete(this.delivered.shift()!);
  }

  /** Estado completo para salvar (contém segredos das sessões). */
  export(): string {
    return JSON.stringify({
      v: 1,
      s: { public: this.managers.public.export(), anon: this.managers.anon.export() },
      inv: [...this.invites.values()],
      c: [...this.contacts.values()].map(c => ({ id: c.id, via: c.via, name: c.name, r: c.request ? 1 : 0, k: c.invite ?? '', s: b64url(c.pub.signPk), a: b64url(c.pub.agreePk), b: b64url(c.pub.binding) })),
      q: [...this.outbox.values()],
      seen: this.router.exportSeen(),
      d: this.delivered,
    });
  }
}
