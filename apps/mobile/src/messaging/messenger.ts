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
import { sha256 } from '@noble/hashes/sha2.js';
import { random } from '../protocol/suite';
import { envelopeId, Priority } from '../protocol/envelope';
import { identityId, type Identity, type IdentityKind, type KeyPair, type PublicIdentity, verifyBinding } from '../protocol/keys';
import { randomDelaySec, Router, type TransportClass } from '../protocol/router';
import { SessionManager } from '../protocol/sessions';
import { b64url, unb64url } from './card';
import { canPost, decodeGroupText, decodeState, encodeGroupText, encodeState, GROUP_INVITE_MAX_USES, GROUP_INVITE_TTL_SEC, type GroupKind, type GroupMember, type GroupState, groupKeyOf, isAdmin, isMemberOf, MAX_GROUP_MEMBERS, newGroupId, newKey, type ChannelVisibility } from './groups';
import { EnvelopeKind, MsgType, type Opened, sealGroup } from '../protocol/envelope';
import { toPublic } from '../protocol/keys';

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
export interface IncomingFile { msgId: string; name: string; size: number; mime: string; blocks: number; data: Uint8Array }

export interface MessengerEvents {
  /** Mensagem nova de um contato conhecido. */
  message(contactId: string, m: IncomingText): void;
  /** Alguém que tem o meu código escreveu pela primeira vez (pedido de conversa). */
  newContact(c: Contact, m: IncomingText): void;
  /** `encaminhada`: saiu deste aparelho para um vizinho; `entregue`: o destino confirmou. */
  status(msgId: string, status: 'encaminhada' | 'entregue' | 'expirada'): void;
  /** Arquivo: progresso de envio (blocos confirmados) ou de recebimento. */
  fileProgress(msgId: string, done: number, total: number, dir: 'out' | 'in'): void;
  /** Arquivo recebido inteiro, com integridade conferida (SHA-256). */
  fileReceived(contactId: string, f: IncomingFile): void;
  /** Arquivo enviado: o destino confirmou que montou e conferiu. */
  fileDelivered(msgId: string): void;
  /** Alguém começou a enviar um arquivo (para mostrar o balão em andamento). */
  fileOffered(contactId: string, f: Omit<IncomingFile, 'data'>): void;
  /** Estado de um grupo mudou (criado, entrei, membros, regras, chave) ou fui removido (`removed`). */
  groupUpdated(g: GroupState, change: 'joined' | 'updated' | 'removed'): void;
  /** Mensagem nova num grupo, canal ou comunidade. */
  groupMessage(groupId: string, fromId: string, fromName: string, m: IncomingText): void;
  /** Pedido para entrar num grupo meu que exige aprovação. */
  joinRequest(groupId: string, who: { id: string; name: string }): void;
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
  | { t: 'a'; i: string[] }
  /** Oferta de arquivo: nome, tamanho, tipo, total de blocos e SHA-256 do conteúdo. */
  | { t: 'f'; i: string; n: string; s: number; m: string; c: number; h: string }
  /** Blocos recebidos (confirmação parcial) e arquivo montado e conferido. */
  | { t: 'fa'; i: string; k: number[] }
  | { t: 'fd'; i: string }
  /** Estado do grupo, enviado por um admin. */
  | { t: 'g'; s: string }
  /** Pedido para entrar (código do convite do grupo) e aviso de saída/remoção. */
  | { t: 'gj'; g: string; c: string; n?: string }
  | { t: 'gl'; g: string }
  | { t: 'gr'; g: string };

/** Pedido para entrar aguardando um admin (só no aparelho do admin). */
interface PendingJoin { id: string; name: string; via: IdentityKind; pub: PublicIdentity; at: number }

/** Envio de arquivo em andamento (só na memória: o conteúdo não vai para o armazenamento do app). */
interface FileJob { msgId: string; to: string; data: Uint8Array; total: number; next: number; acked: Set<number>; inFlight: Set<number>; paused: boolean }
interface FileRx { msgId: string; from: string; name: string; size: number; mime: string; total: number; hash: string; parts: Map<number, Uint8Array>; bytes: number; at: number }

/** Bloco de arquivo: 12 KB de dados por envelope (cabe no preenchimento de 16 KB). */
export const FILE_BLOCK = 12 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Quantos blocos sem confirmação podem estar na malha ao mesmo tempo. */
const FILE_WINDOW = 8;
const BLOCK_TAG = 0x01;

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
  private fileJobs = new Map<string, FileJob>();
  private groups = new Map<string, GroupState>();
  /** Chave anterior de cada grupo (mensagens que já estavam na malha quando a chave trocou). */
  private prevKeys = new Map<string, { keyV: number; key: string }>();
  private pendingJoins = new Map<string, PendingJoin[]>();
  /** Envelopes de grupo meus → id da mensagem (para mostrar "encaminhada"). */
  private groupOut = new Map<string, string>();
  private fileRx = new Map<string, FileRx>();
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
      // Grupo: só abre mensagem de quem ainda é membro e pode publicar (canal e comunidade: só admins).
      isMember: (fromId, gid) => { const g = this.groups.get(gid); return !!g && canPost(g, fromId); },
    });
    if (!st) return;
    for (const t of (st.g ?? []) as string[]) {
      const via = (JSON.parse(t) as { via?: IdentityKind }).via === 'anon' ? 'anon' : 'public';
      const g = decodeState(t, via);
      if (g) this.groups.set(g.id, g);
    }
    for (const [gid, k] of (st.gp ?? []) as [string, { keyV: number; key: string }][]) this.prevKeys.set(gid, k);
    for (const [gid, list] of (st.gq ?? []) as [string, { id: string; name: string; via: IdentityKind; s: string; a: string; b: string; at: number }[]][])
      this.pendingJoins.set(gid, list.map(p => ({ id: p.id, name: p.name, via: p.via, at: p.at, pub: { signPk: unb64url(p.s), agreePk: unb64url(p.a), binding: unb64url(p.b) } })));
    this.refreshGroupKeys();
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

  private enqueue(c: Contact, p: Payload | Uint8Array, msgId: string | null, priority: Priority, bulk = false) {
    const now = this.o.now();
    const body = p instanceof Uint8Array ? p : utf8(JSON.stringify(p));
    const sealed = this.managers[c.via].seal(c.pub, body, { now, ttlSec: TTL_SEC, priority, bulk, pad: this.o.pad?.() ?? true });
    const delaySec = msgId && this.o.randomDelay?.() ? randomDelaySec() : 0;
    const r = this.router.send(sealed.bytes, now, { delaySec });
    if (msgId && r.status === 'stored') this.outbox.set(sealed.id, { env: sealed.id, msgId, to: c.id, bytes: b64url(sealed.bytes), forwarded: false });
    this.o.events.changed?.();
    this.flushAll();
  }

  // ── arquivos (FUN-009): oferta, blocos com confirmação, pausa/retomada e SHA-256 no fim ──

  /** Começa a enviar um arquivo para o contato. `msgId` é o id do balão na conversa. */
  sendFile(contactId: string, msgId: string, f: { name: string; mime: string; data: Uint8Array }) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    if (f.data.length === 0 || f.data.length > MAX_FILE_BYTES) throw new Error('Arquivo vazio ou maior que 50 MB.');
    const total = Math.ceil(f.data.length / FILE_BLOCK);
    const job: FileJob = { msgId, to: contactId, data: f.data, total, next: 0, acked: new Set(), inFlight: new Set(), paused: false };
    this.fileJobs.set(msgId, job);
    this.enqueue(c, { t: 'f', i: msgId, n: f.name.slice(0, 120), s: f.data.length, m: f.mime.slice(0, 80), c: total, h: toHex(sha256(f.data)) }, null, Priority.Normal);
    this.pumpFile(job);
    return { blocks: total };
  }

  /** Pausar/retomar pelo usuário. Retomar continua de onde parou (só os blocos que faltam). */
  setFilePaused(msgId: string, paused: boolean) {
    const job = this.fileJobs.get(msgId);
    if (!job) return false;
    job.paused = paused;
    if (!paused) { job.inFlight.clear(); job.next = 0; this.pumpFile(job); }
    return true;
  }

  /** O envio ainda existe nesta execução do app? (depois de reabrir, o conteúdo não fica guardado). */
  hasFileJob(msgId: string) { return this.fileJobs.has(msgId); }

  private pumpFile(job: FileJob) {
    const c = this.contacts.get(job.to);
    if (!c || job.paused) return;
    while (job.inFlight.size < FILE_WINDOW) {
      while (job.next < job.total && (job.acked.has(job.next) || job.inFlight.has(job.next))) job.next++;
      if (job.next >= job.total) break;
      const k = job.next++;
      job.inFlight.add(k);
      const id = utf8(job.msgId);
      const chunk = job.data.subarray(k * FILE_BLOCK, (k + 1) * FILE_BLOCK);
      const body = new Uint8Array(1 + 1 + id.length + 4 + chunk.length);
      body[0] = BLOCK_TAG; body[1] = id.length; body.set(id, 2);
      new DataView(body.buffer).setUint32(2 + id.length, k);
      body.set(chunk, 6 + id.length);
      // Mídia nunca vai por LoRa (flag bulk no envelope).
      this.enqueue(c, body, null, Priority.Low, true);
    }
  }

  private onBlock(from: string, pt: Uint8Array) {
    if (pt.length < 7) return;
    const n = pt[1];
    if (n === 0 || n > 64 || pt.length < 6 + n) return;
    const msgId = fromUtf8(pt.subarray(2, 2 + n));
    const k = new DataView(pt.buffer, pt.byteOffset).getUint32(2 + n);
    const rx = this.fileRx.get(`${from}|${msgId}`);
    if (!rx || k >= rx.total) return;
    const data = pt.slice(6 + n);
    if (data.length > FILE_BLOCK || (k < rx.total - 1 && data.length !== FILE_BLOCK)) return;
    if (!rx.parts.has(k)) { rx.parts.set(k, data); rx.bytes += data.length; }
    if (rx.bytes > rx.size) { this.fileRx.delete(`${from}|${msgId}`); return; }
    const c = this.contacts.get(from);
    if (!c) return;
    this.o.events.fileProgress?.(msgId, rx.parts.size, rx.total, 'in');
    // Confirma cada bloco (repetido também: a confirmação anterior pode ter se perdido).
    this.enqueue(c, { t: 'fa', i: msgId, k: [k] }, null, Priority.High);
    if (rx.parts.size < rx.total) return;
    const whole = new Uint8Array(rx.size);
    let o = 0;
    for (let i = 0; i < rx.total; i++) { const part = rx.parts.get(i)!; whole.set(part, o); o += part.length; }
    this.fileRx.delete(`${from}|${msgId}`);
    if (o !== rx.size || toHex(sha256(whole)) !== rx.hash) return; // integridade não confere: descarta
    this.enqueue(c, { t: 'fd', i: msgId }, null, Priority.High);
    this.o.events.fileReceived?.(from, { msgId, name: rx.name, size: rx.size, mime: rx.mime, blocks: rx.total, data: whole });
  }

  private onFileControl(from: string, p: Payload) {
    const c = this.contacts.get(from);
    if (!c) return; // arquivo só de contato já aceito
    if (p.t === 'f') {
      if (typeof p.i !== 'string' || p.i.length > 64 || !(p.s > 0 && p.s <= MAX_FILE_BYTES) || p.c !== Math.ceil(p.s / FILE_BLOCK) || !/^[0-9a-f]{64}$/.test(p.h)) return;
      const key = `${from}|${p.i}`;
      if (this.fileRx.has(key) || this.deliveredSet.has(`${from}|file|${p.i}`)) return;
      if (this.fileRx.size >= 8) return; // poucos recebimentos simultâneos (memória)
      this.fileRx.set(key, { msgId: p.i, from, name: String(p.n).slice(0, 120), size: p.s, mime: String(p.m).slice(0, 80), total: p.c, hash: p.h, parts: new Map(), bytes: 0, at: this.o.now() });
      this.markDelivered(`${from}|file|${p.i}`);
      this.o.events.fileOffered?.(from, { msgId: p.i, name: String(p.n).slice(0, 120), size: p.s, mime: String(p.m).slice(0, 80), blocks: p.c });
      return;
    }
    if (p.t !== 'fa' && p.t !== 'fd') return;
    const job = typeof p.i === 'string' ? this.fileJobs.get(p.i) : undefined;
    if (!job || job.to !== from) return;
    if (p.t === 'fa' && Array.isArray(p.k)) {
      for (const k of p.k.slice(0, 64)) if (Number.isInteger(k) && k >= 0 && k < job.total) { job.acked.add(k); job.inFlight.delete(k); }
      this.o.events.fileProgress?.(job.msgId, job.acked.size, job.total, 'out');
      this.pumpFile(job);
    } else if (p.t === 'fd') { // montado e conferido do lado de lá (pode chegar antes da última confirmação de bloco)
      this.fileJobs.delete(job.msgId);
      this.o.events.fileDelivered?.(job.msgId);
    }
  }

  // ── grupos, canais e comunidades (FUN-006/007/008) ─────────────────────

  private myId(via: IdentityKind) { return this.o.identities[via].id; }
  getGroup(id: string) { return this.groups.get(id); }
  listGroups() { return [...this.groups.values()]; }
  pendingJoinsOf(gid: string) { return (this.pendingJoins.get(gid) ?? []).map(p => ({ id: p.id, name: p.name })); }

  private refreshGroupKeys() {
    const keys = [];
    for (const g of this.groups.values()) {
      keys.push(groupKeyOf(g));
      const prev = this.prevKeys.get(g.id);
      if (prev) keys.push(groupKeyOf({ id: g.id, keyV: prev.keyV, key: prev.key }));
    }
    this.router.groupKeys = keys;
  }

  /** Cria um grupo, canal ou comunidade comigo como admin e envia o estado a cada membro. */
  createGroup(o: { kind: GroupKind; name: string; desc?: string; via: IdentityKind; memberIds: string[]; send?: 'all' | 'admins'; inv?: 'all' | 'admins'; approve?: boolean; visibility?: ChannelVisibility; parent?: string; postMods?: boolean }): GroupState {
    const me = this.o.identities[o.via];
    const members: GroupMember[] = [{ id: me.id, name: o.via === 'public' ? this.displayName || 'Você' : '', role: 'admin', pub: toPublic(me) }];
    for (const id of o.memberIds) {
      const c = this.contacts.get(id);
      if (!c || c.via !== o.via || c.request) throw new Error('Só contatos aceitos da mesma identidade entram no grupo.');
      if (!members.some(m => m.id === id)) members.push({ id, name: c.name, role: 'member', pub: c.pub });
    }
    if (members.length > MAX_GROUP_MEMBERS) throw new Error(`Até ${MAX_GROUP_MEMBERS} membros.`);
    const g: GroupState = {
      id: newGroupId(), kind: o.kind, name: o.name.trim().slice(0, 60), desc: (o.desc ?? '').slice(0, 200), via: o.via, rev: 1, keyV: 1, key: newKey(), members,
      send: o.kind === 'group' ? o.send ?? 'all' : 'admins', inv: o.inv ?? 'admins', approve: o.approve ?? true,
      visibility: o.kind === 'channel' ? o.visibility ?? 'private' : undefined, postMods: o.kind === 'channel' ? !!o.postMods : undefined, children: o.kind === 'community' ? [] : undefined, parent: o.parent,
    };
    this.groups.set(g.id, g);
    this.refreshGroupKeys();
    this.distribute(g);
    // Dentro de uma comunidade minha: entra na lista dela.
    const parent = o.parent ? this.groups.get(o.parent) : undefined;
    if (parent && isAdmin(parent, me.id)) this.updateGroup(parent.id, { children: [...(parent.children ?? []), { id: g.id, name: g.name, kind: o.kind === 'channel' ? 'channel' : 'group' }] });
    this.o.events.changed?.();
    return g;
  }

  /** Envia o estado atual a cada membro (menos eu), pela sessão 1:1 de cada um. */
  private distribute(g: GroupState) {
    const me = this.myId(g.via);
    for (const m of g.members) {
      if (m.id === me) continue;
      let c = this.contacts.get(m.id);
      if (!c) { c = { id: m.id, via: g.via, pub: m.pub, name: m.name }; this.contacts.set(c.id, c); }
      this.enqueue(c, { t: 'g', s: encodeState(g, m.role === 'admin') }, null, Priority.High);
    }
  }

  private assertAdmin(gid: string) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    if (!isAdmin(g, this.myId(g.via))) throw new Error('Só admins mudam o grupo.');
    return g;
  }

  /** Muda nome, regras ou a lista de uma comunidade (admin). */
  updateGroup(gid: string, patch: Partial<Pick<GroupState, 'name' | 'desc' | 'send' | 'inv' | 'approve' | 'visibility' | 'children' | 'postMods'>>) {
    const g = this.assertAdmin(gid);
    const next: GroupState = { ...g, ...patch, rev: g.rev + 1 };
    if (next.kind !== 'group') next.send = 'admins';
    this.groups.set(gid, next);
    this.distribute(next);
    this.o.events.changed?.();
    return next;
  }

  /** Acrescenta contatos ao grupo (admin, ou qualquer membro se `inv` = todos). A chave não muda. */
  addMembers(gid: string, ids: string[]) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    const me = this.myId(g.via);
    if (!isAdmin(g, me) && !(g.inv === 'all' && isMemberOf(g, me))) throw new Error('Sem permissão para convidar.');
    if (!isAdmin(g, me)) throw new Error('Peça a um admin para adicionar.');
    const members = [...g.members];
    for (const id of ids) {
      const c = this.contacts.get(id);
      if (!c || c.via !== g.via) continue;
      if (!members.some(m => m.id === id)) members.push({ id, name: c.name, role: 'member', pub: c.pub });
    }
    if (members.length > MAX_GROUP_MEMBERS) throw new Error(`Até ${MAX_GROUP_MEMBERS} membros.`);
    const next = { ...g, members, rev: g.rev + 1 };
    this.groups.set(gid, next);
    this.distribute(next);
    this.o.events.changed?.();
    return next;
  }

  /** Remove alguém e troca a chave do grupo (v → v+1): quem saiu não lê nada novo. */
  removeMember(gid: string, id: string) {
    const g = this.assertAdmin(gid);
    if (!isMemberOf(g, id)) return g;
    this.prevKeys.set(gid, { keyV: g.keyV, key: g.key });
    const next: GroupState = { ...g, members: g.members.filter(m => m.id !== id), rev: g.rev + 1, keyV: g.keyV + 1, key: newKey() };
    if (!next.members.some(m => m.role === 'admin')) throw new Error('O grupo precisa de pelo menos um admin.');
    this.groups.set(gid, next);
    this.refreshGroupKeys();
    this.distribute(next);
    const c = this.contacts.get(id);
    if (c) this.enqueue(c, { t: 'gr', g: gid }, null, Priority.High);
    this.o.events.changed?.();
    return next;
  }

  /** Torna alguém admin (ou membro de novo). */
  setRole(gid: string, id: string, role: 'admin' | 'mod' | 'member') {
    const g = this.assertAdmin(gid);
    const next = { ...g, members: g.members.map(m => (m.id === id ? { ...m, role } : m)), rev: g.rev + 1 };
    if (!next.members.some(m => m.role === 'admin')) throw new Error('O grupo precisa de pelo menos um admin.');
    this.groups.set(gid, next);
    this.distribute(next);
    this.o.events.changed?.();
    return next;
  }

  /** Sair: avisa os admins (que trocam a chave) e apaga o grupo deste aparelho. */
  leaveGroup(gid: string) {
    const g = this.groups.get(gid);
    if (!g) return;
    const me = this.myId(g.via);
    for (const m of g.members) {
      if (m.role !== 'admin' || m.id === me) continue;
      const c = this.contacts.get(m.id) ?? { id: m.id, via: g.via, pub: m.pub, name: m.name };
      this.enqueue(c, { t: 'gl', g: gid }, null, Priority.High);
    }
    this.groups.delete(gid); this.prevKeys.delete(gid);
    this.refreshGroupKeys();
    this.o.events.changed?.();
  }

  /** Envia texto ao grupo (envelope de grupo, cifrado com a chave atual). */
  sendGroupText(gid: string, msgId: string, text: string) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    const me = this.o.identities[g.via];
    if (!canPost(g, me.id)) throw new Error(g.kind === 'group' ? 'Só admins publicam neste grupo.' : 'Só admins publicam aqui.');
    const now = this.o.now();
    const sealed = sealGroup({ from: me, group: groupKeyOf(g), type: MsgType.Text, body: encodeGroupText(msgId, text.slice(0, MAX_TEXT)), now, ttlSec: TTL_SEC, pad: this.o.pad?.() ?? true });
    const delaySec = this.o.randomDelay?.() ? randomDelaySec() : 0;
    const r = this.router.send(sealed.bytes, now, { delaySec });
    if (r.status === 'stored') this.groupOut.set(sealed.id, msgId);
    this.o.events.changed?.();
    this.flushAll();
  }

  /** Convite do grupo (link/QR): vale 7 dias e até 50 usos. `fresh` revoga o anterior. */
  groupInvite(gid: string, fresh = false) {
    const g = this.assertAdmin(gid);
    const now = this.o.now();
    if (!fresh && g.invite && g.invite.expiresAt > now && g.invite.uses < GROUP_INVITE_MAX_USES) return g.invite;
    const invite = { code: toHex(random(8)), expiresAt: now + GROUP_INVITE_TTL_SEC, uses: 0 };
    this.groups.set(gid, { ...g, invite });
    this.o.events.changed?.();
    return invite;
  }

  /** Quem escaneou o convite do grupo pede para entrar (vai para o admin que gerou o convite). */
  requestJoin(admin: Contact, gid: string, code: string) {
    const c = this.contacts.get(admin.id) ?? admin;
    if (!this.contacts.has(c.id)) { this.addContact({ ...c, invite: undefined }); }
    const p: Payload = { t: 'gj', g: gid, c: code };
    if (c.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    this.enqueue(this.contacts.get(c.id)!, p, null, Priority.High);
  }

  /** Membro de uma comunidade pede para entrar num grupo/canal dela (vai para os admins do grupo). */
  requestJoinChild(communityId: string, childId: string) {
    const com = this.groups.get(communityId);
    if (!com || !com.children?.some(x => x.id === childId)) throw new Error('Grupo fora desta comunidade.');
    const p: Payload = { t: 'gj', g: childId, c: 'community:' + communityId };
    if (com.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    const me = this.myId(com.via);
    for (const m of com.members) {
      if (m.role !== 'admin' || m.id === me) continue;
      const c = this.contacts.get(m.id) ?? { id: m.id, via: com.via, pub: m.pub, name: m.name };
      if (!this.contacts.has(c.id)) this.contacts.set(c.id, c);
      this.enqueue(c, p, null, Priority.High);
    }
  }

  /** Admin aprova ou recusa um pedido pendente. */
  answerJoin(gid: string, id: string, accept: boolean) {
    const list = this.pendingJoins.get(gid) ?? [];
    const p = list.find(x => x.id === id);
    this.pendingJoins.set(gid, list.filter(x => x.id !== id));
    if (!p) return;
    if (accept) {
      if (!this.contacts.has(p.id)) this.contacts.set(p.id, { id: p.id, via: p.via, pub: p.pub, name: p.name });
      this.addMembers(gid, [p.id]);
    }
    this.o.events.changed?.();
  }

  private onJoinRequest(from: string, via: IdentityKind, pub: PublicIdentity, p: Extract<Payload, { t: 'gj' }>) {
    const g = typeof p.g === 'string' ? this.groups.get(p.g) : undefined;
    if (!g || g.via !== via || !isAdmin(g, this.myId(via))) return;
    const inv = g.invite;
    // Pedido por convite (código do link) ou por fazer parte da comunidade que reúne o grupo.
    const viaCommunity = typeof p.c === 'string' && p.c.startsWith('community:') && g.parent === p.c.slice(10)
      && !!this.groups.get(g.parent) && isMemberOf(this.groups.get(g.parent)!, from);
    const viaInvite = !!inv && inv.code === p.c && inv.expiresAt > this.o.now() && inv.uses < GROUP_INVITE_MAX_USES;
    if (!viaCommunity && !viaInvite) return;
    if (isMemberOf(g, from)) { this.distribute(g); return; }
    const name = typeof p.n === 'string' && via === 'public' ? p.n.slice(0, 40) : '';
    if (viaInvite && inv) this.groups.set(g.id, { ...g, invite: { ...inv, uses: inv.uses + 1 } });
    if (g.approve) {
      const list = (this.pendingJoins.get(g.id) ?? []).filter(x => x.id !== from);
      if (list.length >= 100) return;
      this.pendingJoins.set(g.id, [...list, { id: from, name, via, pub, at: this.o.now() }]);
      this.o.events.joinRequest?.(g.id, { id: from, name });
      this.o.events.changed?.();
      return;
    }
    if (!this.contacts.has(from)) this.contacts.set(from, { id: from, via, pub, name });
    this.addMembers(g.id, [from]);
  }

  private onGroupControl(from: string, p: Payload) {
    if (p.t === 'g') {
      const cur0 = (() => { try { return this.groups.get((JSON.parse(p.s) as { id?: string }).id ?? ''); } catch { return undefined; } })();
      const contact = this.contacts.get(from);
      const via = cur0?.via ?? contact?.via;
      if (!via) return;
      const g = decodeState(p.s, via);
      if (!g) return;
      const cur = this.groups.get(g.id);
      // Só aceita de quem é admin (no estado que eu já tenho; num grupo novo, no próprio estado e sendo contato aceito).
      if (cur ? !isAdmin(cur, from) : !isAdmin(g, from) || !contact || contact.request) return;
      if (!isAdmin(g, from)) return;
      if (cur && (g.rev <= cur.rev || g.keyV < cur.keyV)) return; // sem voltar atrás
      const me = this.myId(via);
      if (!isMemberOf(g, me)) { this.dropGroup(g.id, cur); return; }
      if (cur && g.keyV > cur.keyV) this.prevKeys.set(g.id, { keyV: cur.keyV, key: cur.key });
      // Código de convite só fica com admins.
      if (!isAdmin(g, me)) delete g.invite; else if (cur?.invite && !g.invite) g.invite = cur.invite;
      this.groups.set(g.id, g);
      this.refreshGroupKeys();
      this.o.events.groupUpdated?.(g, cur ? 'updated' : 'joined');
      this.o.events.changed?.();
      return;
    }
    if (p.t !== 'gr' && p.t !== 'gl') return;
    const g = typeof p.g === 'string' ? this.groups.get(p.g) : undefined;
    if (!g) return;
    if (p.t === 'gr' && isAdmin(g, from)) this.dropGroup(g.id, g);
    if (p.t === 'gl' && isMemberOf(g, from) && isAdmin(g, this.myId(g.via))) this.removeMember(g.id, from);
  }

  private dropGroup(gid: string, cur: GroupState | undefined) {
    this.groups.delete(gid); this.prevKeys.delete(gid);
    this.refreshGroupKeys();
    if (cur) this.o.events.groupUpdated?.(cur, 'removed');
    this.o.events.changed?.();
  }

  private onGroupEnvelope(m: Opened) {
    const gid = m.group?.id;
    const g = gid ? this.groups.get(gid) : undefined;
    if (!g || m.type !== MsgType.Text) return;
    const t = decodeGroupText(m.body);
    if (!t) return;
    const key = `${gid}|${m.fromId}|${t.i}`;
    if (this.deliveredSet.has(key)) return;
    this.markDelivered(key);
    if (m.fromId === this.myId(g.via)) return; // minha própria, voltando pela malha
    const who = g.members.find(x => x.id === m.fromId);
    this.o.events.groupMessage?.(g.id, m.fromId, who?.name || 'Membro', { msgId: t.i, text: t.x, sentAt: m.sentAt });
    this.o.events.changed?.();
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
      const gm = this.groupOut.get(id);
      if (gm) { this.groupOut.delete(id); changed = true; this.o.events.status?.(gm, 'encaminhada'); }
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
    if (m.kind === EnvelopeKind.Group) { this.onGroupEnvelope(m); return r; }
    const via: IdentityKind = this.contacts.get(m.fromId)?.via ?? (this.managers.anon.get(m.fromId) ? 'anon' : 'public');
    // Abre na sessão da identidade que recebeu; tenta a outra se não abrir (primeira mensagem).
    let pt = this.managers[via].open(m), used: IdentityKind = via;
    if (!pt) { used = via === 'public' ? 'anon' : 'public'; pt = this.managers[used].open(m); }
    this.o.events.changed?.();
    if (!pt) return r;
    if (pt[0] === BLOCK_TAG) { this.onBlock(m.fromId, pt); return r; }
    let p: Payload;
    try { p = JSON.parse(fromUtf8(pt)); } catch { return r; }
    if (p?.t === 'fa' || p?.t === 'fd' || p?.t === 'f') { this.onFileControl(m.fromId, p); return r; }
    if (p?.t === 'g' || p?.t === 'gl' || p?.t === 'gr') { this.onGroupControl(m.fromId, p); return r; }
    if (p?.t === 'gj') { this.onJoinRequest(m.fromId, used, m.from, p); return r; }
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
      g: [...this.groups.values()].map(g => encodeState(g, true)),
      gp: [...this.prevKeys],
      gq: [...this.pendingJoins].map(([gid, l]) => [gid, l.map(p => ({ id: p.id, name: p.name, via: p.via, at: p.at, s: b64url(p.pub.signPk), a: b64url(p.pub.agreePk), b: b64url(p.pub.binding) }))]),
      c: [...this.contacts.values()].map(c => ({ id: c.id, via: c.via, name: c.name, r: c.request ? 1 : 0, k: c.invite ?? '', s: b64url(c.pub.signPk), a: b64url(c.pub.agreePk), b: b64url(c.pub.binding) })),
      q: [...this.outbox.values()],
      seen: this.router.exportSeen(),
      d: this.delivered,
    });
  }
}
