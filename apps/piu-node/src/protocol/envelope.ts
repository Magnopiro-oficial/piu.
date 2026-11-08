// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/envelope.ts. Não edite aqui.
/**
 * Envelope criptográfico (documento, seção 10): identificador único, destino lógico, prioridade,
 * TTL, tamanho e material de integridade. Os relays leem só o cabeçalho; o conteúdo, inclusive
 * QUEM enviou, fica cifrado (remetente selado).
 *
 * Cabeçalho (104 bytes, big-endian):
 *   0 versão · 1 suíte · 2 tipo · 3 flags (bit 0 mídia, bit 1 ao vivo) · 4 prioridade · 5 saltos restantes (único campo mutável)
 *   6 versão da chave (grupo) · 8 expira em (s) · 12 destino (16) · 28 chave efêmera (32)
 *   60 nonce (24) · 84 hash do segredo de entrega (16) · 100 tamanho do corpo (u32) · 104 corpo
 *
 * Integridade: o cabeçalho (com os saltos zerados) entra como dado associado do AEAD e na assinatura
 * do remetente; o id é o hash de tudo menos os saltos. Mudar qualquer outro byte invalida o envelope.
 */
import { concat, equal, ProtocolError, Reader, toHex, utf8, Writer } from './bytes.js';
import { type Identity, identityId, type PublicIdentity, verifyBinding } from './keys.js';
import { ACCEPTED_SUITES, aead, agree, hash, kdf, KEY_BYTES, NONCE_BYTES, random, sign, SIG_BYTES, SUITE_V0 } from './suite.js';

export const PROTOCOL_VERSION = 0;
export const HEADER_BYTES = 104;
export const HOP_OFFSET = 5;
/** Ninguém guarda uma mensagem por mais de 7 dias (FUN-011). */
export const MAX_TTL_SEC = 7 * 24 * 3600;
/** Tolerância de relógio entre aparelhos. */
export const CLOCK_SKEW_SEC = 5 * 60;
export const DEFAULT_HOPS = 8;
export const MAX_ENVELOPE_BYTES = 32 * 1024;

export enum EnvelopeKind { Direct = 1, Group = 2 }
export enum Priority { Low = 0, Normal = 1, High = 2, Critical = 3 }
export enum MsgType {
  Text = 1, DeliveryReceipt = 2, GroupKey = 3, /** Conteúdo de sessão Double Ratchet (ratchet.ts). */ Session = 4,
  /** Carga para gateway e recibo dela (carry.ts). Versões antigas recusam o tipo ao abrir (e nunca têm a chave). */
  Carry = 5,
}

export interface Header {
  version: number; suite: number; kind: EnvelopeKind; bulk: boolean;
  /**
   * Sinal ao vivo da chamada de voz (oferta, aceite, recusa, desligar): vale segundos e nunca vai por
   * LoRa (bit 1 das flags). Leitores antigos ignoram o bit; o envelope continua igual para eles.
   */
  live: boolean;
  priority: Priority; hops: number;
  keyVersion: number; expiresAt: number; dest: Uint8Array; eph: Uint8Array; nonce: Uint8Array; ackHash: Uint8Array; bodyLen: number;
}

export interface Opened {
  id: string; kind: EnvelopeKind; type: MsgType; body: Uint8Array; sentAt: number;
  from: PublicIdentity; fromId: string;
  /** Revelado pelo destino como prova de entrega (o validador confere contra `ackHash`). */
  ackSecret: Uint8Array;
  group?: { id: string; version: number };
}

export interface SealOptions {
  from: Identity; type: MsgType; body: Uint8Array; now: number;
  ttlSec?: number; priority?: Priority; bulk?: boolean; live?: boolean; hops?: number;
  /** Preencher até o próximo tamanho padrão (padrão: sim). */
  pad?: boolean;
}

/** Aceita destinos lógicos além do da própria chave (sessões estabelecidas). */
export type AcceptDest = (dest: Uint8Array, expiresAt: number) => boolean;

export interface GroupKey { groupId: Uint8Array; version: number; key: Uint8Array }

// ── cabeçalho ───────────────────────────────────────────────

/** Campos do cabeçalho, com as validações de versão, suíte, tipo e prioridade. */
function readHeader(r: Reader): Header {
  const version = r.u8();
  if (version !== PROTOCOL_VERSION) throw new ProtocolError('VERSION', `Versão ${version} não suportada.`);
  const suite = r.u8();
  if (!ACCEPTED_SUITES.has(suite)) throw new ProtocolError('SUITE', `Suíte ${suite} recusada.`);
  const kind = r.u8();
  if (kind !== EnvelopeKind.Direct && kind !== EnvelopeKind.Group) throw new ProtocolError('KIND', 'Tipo de envelope desconhecido.');
  const flags = r.u8();
  const priority = r.u8();
  if (priority > Priority.Critical) throw new ProtocolError('PRIORITY', 'Prioridade inválida.');
  return {
    version, suite, kind, bulk: (flags & 1) === 1, live: (flags & 2) === 2, priority, hops: r.u8(), keyVersion: r.u16(), expiresAt: r.u32(),
    dest: r.bytes(16), eph: r.bytes(32), nonce: r.bytes(NONCE_BYTES), ackHash: r.bytes(16), bodyLen: r.u32(),
  };
}

/** Lê e valida o cabeçalho. Relays usam isto sem ter nenhuma chave. */
export function parseHeader(bytes: Uint8Array): Header {
  if (bytes.length < HEADER_BYTES) throw new ProtocolError('TRUNCATED', 'Envelope truncado.');
  if (bytes.length > MAX_ENVELOPE_BYTES) throw new ProtocolError('TOO_LARGE', 'Envelope maior que o limite.');
  const r = new Reader(bytes);
  const h = readHeader(r);
  if (h.bodyLen !== r.remaining) throw new ProtocolError('LENGTH', 'Tamanho do corpo não confere.');
  return h;
}

/**
 * Só o cabeçalho (exatamente 104 bytes, sem o corpo): é o que a prova de entrega v2 carrega
 * (proof.ts). O tamanho do corpo declarado não é conferido aqui (o corpo não vem junto).
 */
export function parseAuthHeader(header: Uint8Array): Header {
  if (header.length !== HEADER_BYTES) throw new ProtocolError('LENGTH', 'Cabeçalho com tamanho errado.');
  return readHeader(new Reader(header));
}

function writeHeader(h: Header): Uint8Array {
  return new Writer().u8(h.version).u8(h.suite).u8(h.kind).u8((h.bulk ? 1 : 0) | (h.live ? 2 : 0)).u8(h.priority).u8(h.hops)
    .u16(h.keyVersion).u32(h.expiresAt).bytes(h.dest).bytes(h.eph).bytes(h.nonce).bytes(h.ackHash).u32(h.bodyLen).done();
}

/** Cabeçalho com os saltos zerados: o que é autenticado (dado associado e assinatura). */
export const authHeader = (bytes: Uint8Array) => { const a = bytes.slice(0, HEADER_BYTES); a[HOP_OFFSET] = 0; return a; };

/** Identificador criptográfico (deduplicação, FUN-012): hash do envelope sem o contador de saltos. */
export function envelopeId(bytes: Uint8Array): string {
  const a = bytes.slice(); a[HOP_OFFSET] = 0;
  return toHex(hash(a).slice(0, 16));
}

/** Cópia com um salto a menos (para retransmitir). */
export function withHops(bytes: Uint8Array, hops: number): Uint8Array {
  const c = bytes.slice(); c[HOP_OFFSET] = hops; return c;
}

const day = (expiresAt: number) => Math.floor(expiresAt / 86400);
const u32 = (n: number) => new Writer().u32(n).done();

/** Destino lógico de mensagem direta: muda a cada dia, e só quem conhece a chave do destino o calcula. */
export const directDest = (agreePk: Uint8Array, expiresAt: number) => kdf(agreePk, u32(day(expiresAt)), 'piu/v0/dest/direct', 16);
export const groupDest = (g: GroupKey, expiresAt: number) => kdf(g.key, concat(g.groupId, u32(day(expiresAt))), 'piu/v0/dest/group', 16);

// ── conteúdo interno (cifrado) ─────────────────────────────

/**
 * Preenchimento ("Igualar tamanho das mensagens", ajuste de Privacidade): o conteúdo vai num bloco
 * de tamanho fixo, para o tamanho do envelope não revelar o tamanho da mensagem.
 */
const PAD_BUCKETS = [256, 1024, 4096, 16384];
export function padBody(body: Uint8Array, pad = true): Uint8Array {
  const framed = new Writer().vbytes(body).done();
  if (!pad) return framed;
  const target = PAD_BUCKETS.find(b => b >= framed.length) ?? framed.length;
  return concat(framed, new Uint8Array(target - framed.length));
}
function unpadBody(block: Uint8Array): Uint8Array {
  const r = new Reader(block);
  return r.vbytes(block.length);
}

function sigMessage(auth: Uint8Array, innerNoSig: Uint8Array) {
  return hash(concat(utf8('piu/v0/sig'), auth, innerNoSig));
}

function innerBytes(o: SealOptions, block: Uint8Array, ackSecret: Uint8Array, auth: Uint8Array): Uint8Array {
  const noSig = new Writer().u8(o.type).u32(o.now).bytes(ackSecret).bytes(o.from.signPk).bytes(o.from.agreePk).bytes(o.from.binding).vbytes(block).done();
  // A assinatura cobre o cabeçalho autenticado: o destino não consegue reembrulhar a mensagem
  // e repassá-la a outra pessoa como se viesse do remetente original.
  return concat(noSig, sign.sign(sigMessage(auth, noSig), o.from.sign.sk));
}

function readInner(plain: Uint8Array, auth: Uint8Array, h: Header, now: number): Omit<Opened, 'id' | 'kind'> | null {
  try {
    const r = new Reader(plain);
    const type = r.u8(), sentAt = r.u32(), ackSecret = r.bytes(16);
    const from: PublicIdentity = { signPk: r.bytes(32), agreePk: r.bytes(32), binding: r.bytes(SIG_BYTES) };
    const block = r.vbytes(MAX_ENVELOPE_BYTES);
    const noSigLen = r.offset;
    const sig = r.bytes(SIG_BYTES);
    if (r.remaining !== 0) return null;
    if (!verifyBinding(from)) return null;
    if (!sign.verify(sig, sigMessage(auth, plain.slice(0, noSigLen)), from.signPk)) return null;
    if (!equal(hash(ackSecret).slice(0, 16), h.ackHash)) return null;
    // Anti-replay temporal: não aceitar envio "do futuro" nem mais antigo que o TTL máximo.
    if (sentAt > now + CLOCK_SKEW_SEC || sentAt + MAX_TTL_SEC < h.expiresAt - CLOCK_SKEW_SEC) return null;
    if (type < MsgType.Text || type > MsgType.Carry) return null;
    return { type, body: unpadBody(block), sentAt, from, fromId: '', ackSecret };
  } catch {
    return null;
  }
}

function baseHeader(o: SealOptions, kind: EnvelopeKind, ackSecret: Uint8Array): Header {
  const ttl = Math.min(o.ttlSec ?? 48 * 3600, MAX_TTL_SEC);
  return {
    version: PROTOCOL_VERSION, suite: SUITE_V0, kind, bulk: !!o.bulk, live: !!o.live, priority: o.priority ?? Priority.Normal, hops: o.hops ?? DEFAULT_HOPS,
    keyVersion: 0, expiresAt: o.now + ttl, dest: new Uint8Array(16), eph: new Uint8Array(32), nonce: random(NONCE_BYTES),
    ackHash: hash(ackSecret).slice(0, 16), bodyLen: 0,
  };
}

const TAG_BYTES = 16; // Poly1305
/** Tamanho do conteúdo interno: tipo, envio, segredo, 2 chaves, vínculo, corpo (u32 + bytes), assinatura. */
const innerLen = (bodyLen: number) => 1 + 4 + 16 + 32 + 32 + SIG_BYTES + 4 + bodyLen + SIG_BYTES;

/** O tamanho do corpo cifrado é conhecido antes de cifrar, então o cabeçalho final entra como dado associado. */
function assemble(h: Header, block: Uint8Array, seal: (auth: Uint8Array) => Uint8Array): Uint8Array {
  h.bodyLen = innerLen(block.length) + TAG_BYTES;
  if (HEADER_BYTES + h.bodyLen > MAX_ENVELOPE_BYTES) throw new ProtocolError('TOO_LARGE', 'Conteúdo grande demais para um envelope; use fragmentos.');
  const header = writeHeader(h);
  const auth = header.slice(); auth[HOP_OFFSET] = 0;
  const body = seal(auth);
  if (body.length !== h.bodyLen) throw new ProtocolError('LENGTH', 'Tamanho cifrado inesperado.');
  return concat(header, body);
}

// ── mensagens diretas ──────────────────────────────────────

const directKey = (shared: Uint8Array, eph: Uint8Array, to: Uint8Array) => kdf(shared, concat(eph, to), 'piu/v0/direct/key');

/** Cifra para uma pessoa. Gera uma chave efêmera por mensagem (o relay não vê o remetente). */
export function sealDirect(o: SealOptions & { to: PublicIdentity; destFor?: (expiresAt: number) => Uint8Array }): { bytes: Uint8Array; id: string; ackSecret: Uint8Array } {
  if (!verifyBinding(o.to)) throw new ProtocolError('BINDING', 'Chaves do destinatário não conferem.');
  const ackSecret = random(16);
  const h = baseHeader(o, EnvelopeKind.Direct, ackSecret);
  const ephSk = random(KEY_BYTES);
  h.eph = agree.publicKey(ephSk);
  h.dest = o.destFor ? o.destFor(h.expiresAt) : directDest(o.to.agreePk, h.expiresAt);
  const key = directKey(agree.shared(ephSk, o.to.agreePk), h.eph, o.to.agreePk);
  const block = padBody(o.body, o.pad ?? true);
  const bytes = assemble(h, block, auth => aead.seal(key, h.nonce, innerBytes(o, block, ackSecret, auth), auth));
  return { bytes, id: envelopeId(bytes), ackSecret };
}

/** Abre uma mensagem direta para `me`. `null` se não for para mim, estiver adulterada ou vencida. */
export function openDirect(bytes: Uint8Array, me: Identity, now: number, acceptDest?: AcceptDest): Opened | null {
  let h: Header;
  try { h = parseHeader(bytes); } catch { return null; }
  if (h.kind !== EnvelopeKind.Direct || h.expiresAt <= now) return null;
  if (!equal(h.dest, directDest(me.agreePk, h.expiresAt)) && !acceptDest?.(h.dest, h.expiresAt)) return null;
  let shared: Uint8Array;
  try { shared = agree.shared(me.agree.sk, h.eph); } catch { return null; }
  const auth = authHeader(bytes);
  const plain = aead.open(directKey(shared, h.eph, me.agreePk), h.nonce, bytes.slice(HEADER_BYTES), auth);
  if (!plain) return null;
  const inner = readInner(plain, auth, h, now);
  if (!inner) return null;
  return { ...inner, id: envelopeId(bytes), kind: h.kind, fromId: idOf(inner.from) };
}

// ── grupos ─────────────────────────────────────────────────

const groupMsgKey = (g: GroupKey) => kdf(g.key, g.groupId, 'piu/v0/group/msg');

export function newGroupKey(groupId: Uint8Array, version: number): GroupKey {
  return { groupId, version, key: random(KEY_BYTES) };
}

/** Cifra para todos os membros que têm a chave do grupo na versão atual. */
export function sealGroup(o: SealOptions & { group: GroupKey }): { bytes: Uint8Array; id: string; ackSecret: Uint8Array } {
  const ackSecret = random(16);
  const h = baseHeader(o, EnvelopeKind.Group, ackSecret);
  h.keyVersion = o.group.version;
  h.dest = groupDest(o.group, h.expiresAt);
  const key = groupMsgKey(o.group);
  const block = padBody(o.body, o.pad ?? true);
  const bytes = assemble(h, block, auth => aead.seal(key, h.nonce, innerBytes(o, block, ackSecret, auth), auth));
  return { bytes, id: envelopeId(bytes), ackSecret };
}

/**
 * Abre mensagem de grupo. `isMember` confere se quem assinou ainda é membro: sem isso, alguém removido
 * que guardou a chave antiga poderia continuar publicando na versão anterior.
 */
export function openGroup(bytes: Uint8Array, keys: GroupKey[], now: number, isMember?: (fromId: string, groupId: string) => boolean): Opened | null {
  let h: Header;
  try { h = parseHeader(bytes); } catch { return null; }
  if (h.kind !== EnvelopeKind.Group || h.expiresAt <= now) return null;
  const g = keys.find(k => k.version === h.keyVersion && equal(h.dest, groupDest(k, h.expiresAt)));
  if (!g) return null;
  const auth = authHeader(bytes);
  const plain = aead.open(groupMsgKey(g), h.nonce, bytes.slice(HEADER_BYTES), auth);
  if (!plain) return null;
  const inner = readInner(plain, auth, h, now);
  if (!inner) return null;
  const fromId = idOf(inner.from), groupId = toHex(g.groupId);
  if (isMember && !isMember(fromId, groupId)) return null;
  return { ...inner, id: envelopeId(bytes), kind: h.kind, fromId, group: { id: groupId, version: g.version } };
}

/**
 * Aceita uma chave de grupo recebida só se: veio num envelope autêntico do tipo GroupKey, quem
 * assinou é admin do grupo e a versão é mais nova que a atual (impede injeção de chave por
 * qualquer membro ou terceiro e o retorno a uma chave antiga, que reabriria o grupo a removidos).
 */
export function acceptGroupKey(m: Opened, isAdmin: (fromId: string, groupId: string) => boolean, currentVersion: (groupId: string) => number): GroupKey | null {
  if (m.type !== MsgType.GroupKey) return null;
  const k = decodeGroupKey(m.body);
  if (!k) return null;
  const gid = toHex(k.groupId);
  if (!isAdmin(m.fromId, gid)) return null;
  if (k.version <= currentVersion(gid)) return null;
  return k;
}

/** Corpo da mensagem que distribui uma chave de grupo (sempre dentro de um envelope direto). */
export const encodeGroupKey = (g: GroupKey) => new Writer().vbytes(g.groupId).u16(g.version).bytes(g.key).done();
export function decodeGroupKey(body: Uint8Array): GroupKey | null {
  try { const r = new Reader(body); const k = { groupId: r.vbytes(64), version: r.u16(), key: r.bytes(KEY_BYTES) }; return r.remaining === 0 ? k : null; } catch { return null; }
}

const idOf = (p: PublicIdentity) => identityId(p.signPk, p.agreePk);
