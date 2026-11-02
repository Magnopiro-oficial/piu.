// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/lnnp.ts. Não edite aqui.
/**
 * LNNP v1 (Lunes Network Node Protocol): o enlace entre dois nós vizinhos.
 * Especificação: docs/lnnp/especificacao-v1.md (este arquivo é a implementação de referência).
 *
 * Camadas: o ENVELOPE (envelope.ts, formato versão 0) é o que vai de ponta a ponta, cifrado para o
 * destino. O LNNP (versão 1) é o que dois vizinhos falam entre si para trocar envelopes: identidade
 * técnica do nó, handshake autenticado, negociação de versão e capacidades, quadros cifrados no enlace.
 * O LNNP anuncia quais formatos de envelope aceita (capacidade ENVELOPE_VERSIONS), então as duas
 * versões evoluem separadamente.
 *
 * Handshake (simétrico, os dois lados fazem o mesmo, sem papel de iniciador):
 *   1. cada lado manda HELLO: versões aceitas, chave do nó (Ed25519), chave efêmera (X25519),
 *      desafio aleatório de 32 bytes, horário e capacidades;
 *   2. cada lado manda AUTH: assinatura, com a chave do nó, dos dois HELLO (o seu primeiro).
 *      Como o HELLO do outro tem o desafio dele, a assinatura não serve para outra sessão (anti-replay);
 *      como cobre os dois HELLO, adulterar versões ou capacidades no caminho invalida o enlace (anti-downgrade).
 *   3. com as duas assinaturas conferidas, o segredo X25519 efêmero gera duas chaves (uma por sentido) e
 *      todo quadro seguinte vai cifrado (XChaCha20-Poly1305) com contador crescente.
 * Nenhuma identidade social aparece no enlace: só a chave técnica do nó (keys.ts, `deriveNodeKey`).
 */
import { concat, equal, fromUtf8, ProtocolError, Reader, toHex, utf8, Writer } from './bytes.js';
import { CLOCK_SKEW_SEC, PROTOCOL_VERSION as ENVELOPE_VERSION } from './envelope.js';
import type { KeyPair } from './keys.js';
import type { RelayReceipt } from './receipts.js';
import { ACCEPTED_SUITES, aead, agree, hash, kdf, KEY_BYTES, random, sign, SIG_BYTES } from './suite.js';

/** Versão do LNNP implementada aqui (a do `SERVICE_ID` `net.piu.lnnp.v1`). */
export const LNNP_VERSION = 1;
/** Menor versão do LNNP que este nó ainda aceita. */
export const LNNP_MIN_VERSION = 1;
export const LNNP_MAGIC = utf8('LNNP');
/** Maior quadro aceito (antes de cifrar): cabe um envelope de 32 KiB com folga. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Tamanho do registro cifrado além do quadro: contador (4) + tag Poly1305 (16). */
export const RECORD_OVERHEAD = 4 + 16;
/** MTU assumida quando o vizinho não declara a sua. */
export const DEFAULT_MTU = 512;
export const NONCE_BYTES_LNNP = 32;

export enum FrameType {
  Hello = 0x01, Auth = 0x02,
  Envelope = 0x10, Fragment = 0x11, RelayReceipt = 0x12,
  Ping = 0x20, Pong = 0x21, CapsUpdate = 0x30,
  Close = 0x7e, Error = 0x7f,
}

export enum LnnpErrorCode {
  Malformed = 1, NoCommonVersion = 2, NoCommonSuite = 3, NoCommonFormat = 4, MissingCapability = 5,
  BadSignature = 6, Replay = 7, Clock = 8, Self = 9, Unauthorized = 10, State = 11, TooLarge = 12, Busy = 13,
}

export class LnnpError extends ProtocolError {
  constructor(public wire: LnnpErrorCode, message: string, public fromPeer = false) {
    super(`LNNP_${LnnpErrorCode[wire]?.toUpperCase() ?? wire}`, message);
    this.name = 'LnnpError';
  }
}

/** Meios físicos (bitmask). Igual às classes de transporte do roteador, mais USB. */
export enum Medium { Ble = 1, Direct = 2, Mesh = 4, Lora = 8, Eth = 16, Usb = 32 }

/** Recursos opcionais (bitmask). O efetivo do enlace é o E lógico dos dois lados. */
export enum Feature { Fragments = 1, RelayReceipts = 2, CapsUpdate = 4 }

export enum CapTag { Mtu = 1, Media = 2, Relay = 3, Storage = 4, Suites = 5, EnvelopeVersions = 6, Features = 7 }

export interface Capabilities {
  /** Maior quadro que o meio deste nó transporta de uma vez (bytes). */
  mtu: number;
  /** Meios que este nó usa (bitmask de `Medium`). */
  media: number;
  /** Retransmite envelopes de terceiros agora (Modo nó / horário do operador). */
  relay: boolean;
  /** Espaço livre para envelopes de terceiros (MiB, aproximado; 0 = não guarda). */
  storageMiB: number;
  /** Suítes criptográficas de envelope aceitas (ids de suite.ts). */
  suites: number[];
  /** Formatos de envelope aceitos (envelope.ts, `PROTOCOL_VERSION`). */
  envelopeVersions: number[];
  /** Recursos opcionais (bitmask de `Feature`). */
  features: number;
  /** Capacidades desconhecidas recebidas (ignoradas, mas preservadas para diagnóstico). */
  unknown?: { tag: number; value: Uint8Array }[];
}

/** Capacidades padrão de um nó com este código. */
export function defaultCapabilities(o: Partial<Capabilities> = {}): Capabilities {
  return {
    mtu: MAX_FRAME_BYTES, media: 0, relay: true, storageMiB: 0,
    suites: [...ACCEPTED_SUITES], envelopeVersions: [ENVELOPE_VERSION],
    features: Feature.Fragments | Feature.RelayReceipts | Feature.CapsUpdate, ...o,
  };
}

const MAX_CAPS_BYTES = 1024;

export function encodeCaps(c: Capabilities): Uint8Array {
  const w = new Writer();
  const tlv = (tag: number, v: Uint8Array) => { w.u8(tag).u16(v.length).bytes(v); };
  tlv(CapTag.Mtu, new Writer().u32(c.mtu).done());
  tlv(CapTag.Media, new Writer().u16(c.media).done());
  tlv(CapTag.Relay, Uint8Array.of(c.relay ? 1 : 0));
  tlv(CapTag.Storage, new Writer().u32(c.storageMiB).done());
  tlv(CapTag.Suites, Uint8Array.from(c.suites));
  tlv(CapTag.EnvelopeVersions, Uint8Array.from(c.envelopeVersions));
  tlv(CapTag.Features, new Writer().u32(c.features).done());
  for (const u of c.unknown ?? []) tlv(u.tag, u.value);
  const out = w.done();
  if (out.length > MAX_CAPS_BYTES) throw new LnnpError(LnnpErrorCode.TooLarge, 'Capacidades grandes demais.');
  return out;
}

/**
 * Lê as capacidades. Tags desconhecidas são ignoradas (compatibilidade para frente); tag repetida
 * ou tamanho errado é erro. SUITES e ENVELOPE_VERSIONS são obrigatórias; as outras têm padrão.
 */
export function decodeCaps(b: Uint8Array): Capabilities {
  if (b.length > MAX_CAPS_BYTES) throw new LnnpError(LnnpErrorCode.TooLarge, 'Capacidades grandes demais.');
  const r = new Reader(b);
  const seen = new Set<number>();
  const c: Partial<Capabilities> & { unknown: { tag: number; value: Uint8Array }[] } = { unknown: [] };
  const fixed = (v: Uint8Array, n: number) => { if (v.length !== n) throw new LnnpError(LnnpErrorCode.Malformed, 'Capacidade com tamanho errado.'); return new Reader(v); };
  try {
    while (r.remaining > 0) {
      const tag = r.u8(), v = r.bytes(r.u16());
      if (seen.has(tag)) throw new LnnpError(LnnpErrorCode.Malformed, 'Capacidade repetida.');
      seen.add(tag);
      switch (tag) {
        case CapTag.Mtu: c.mtu = fixed(v, 4).u32(); break;
        case CapTag.Media: c.media = fixed(v, 2).u16(); break;
        case CapTag.Relay: c.relay = fixed(v, 1).u8() === 1; break;
        case CapTag.Storage: c.storageMiB = fixed(v, 4).u32(); break;
        case CapTag.Suites: c.suites = [...v]; break;
        case CapTag.EnvelopeVersions: c.envelopeVersions = [...v]; break;
        case CapTag.Features: c.features = fixed(v, 4).u32(); break;
        default: if (c.unknown.length < 32) c.unknown.push({ tag, value: v });
      }
    }
  } catch (e) {
    if (e instanceof LnnpError) throw e;
    throw new LnnpError(LnnpErrorCode.Malformed, 'Capacidades malformadas.');
  }
  if (!c.suites) throw new LnnpError(LnnpErrorCode.MissingCapability, 'Capacidade obrigatória ausente: SUITES.');
  if (!c.envelopeVersions) throw new LnnpError(LnnpErrorCode.MissingCapability, 'Capacidade obrigatória ausente: ENVELOPE_VERSIONS.');
  return {
    mtu: c.mtu ?? DEFAULT_MTU, media: c.media ?? 0, relay: c.relay ?? false, storageMiB: c.storageMiB ?? 0,
    suites: c.suites, envelopeVersions: c.envelopeVersions, features: c.features ?? 0, unknown: c.unknown,
  };
}

// ── HELLO ───────────────────────────────────────────────────

export interface Hello {
  minVersion: number; maxVersion: number; time: number;
  nodePk: Uint8Array; ephPk: Uint8Array; nonce: Uint8Array; caps: Capabilities;
}

/**
 * HELLO tem formato fixo em todas as versões do LNNP (é o que permite negociar):
 *   tipo 0x01 · "LNNP" · versão mínima u8 · versão máxima u8 · horário u32 · chave do nó (32)
 *   · chave efêmera (32) · desafio (32) · capacidades (u16 + TLVs)
 */
export function encodeHello(h: Omit<Hello, 'caps'> & { caps: Capabilities | Uint8Array }): Uint8Array {
  const caps = h.caps instanceof Uint8Array ? h.caps : encodeCaps(h.caps);
  return new Writer().u8(FrameType.Hello).bytes(LNNP_MAGIC).u8(h.minVersion).u8(h.maxVersion).u32(h.time)
    .bytes(h.nodePk).bytes(h.ephPk).bytes(h.nonce).u16(caps.length).bytes(caps).done();
}

export function decodeHello(frame: Uint8Array): Hello {
  const type = frame[0];
  if (type === FrameType.Error) throw decodeError(frame);
  if (type !== FrameType.Hello) throw new LnnpError(LnnpErrorCode.State, 'Esperava HELLO.');
  let r: Reader, h: Omit<Hello, 'caps'>, caps: Uint8Array;
  try {
    r = new Reader(frame);
    r.u8();
    if (!equal(r.bytes(4), LNNP_MAGIC)) throw new LnnpError(LnnpErrorCode.Malformed, 'Não é LNNP.');
    h = { minVersion: r.u8(), maxVersion: r.u8(), time: r.u32(), nodePk: r.bytes(32), ephPk: r.bytes(32), nonce: r.bytes(NONCE_BYTES_LNNP) };
    caps = r.bytes(r.u16());
  } catch (e) {
    if (e instanceof LnnpError) throw e;
    throw new LnnpError(LnnpErrorCode.Malformed, 'HELLO truncado.');
  }
  // Bytes depois das capacidades: reservados para versões futuras, ignorados.
  if (h.minVersion === 0 || h.minVersion > h.maxVersion) throw new LnnpError(LnnpErrorCode.Malformed, 'Faixa de versões inválida.');
  return { ...h, caps: decodeCaps(caps) };
}

// ── negociação ──────────────────────────────────────────────

export interface Negotiated {
  /** Maior versão do LNNP comum aos dois. */
  version: number;
  /** Suítes de envelope que os dois aceitam (só envelopes dessas suítes passam no enlace). */
  suites: number[];
  envelopeVersions: number[];
  /** Maior quadro que cabe nos dois lados (acima disso, fragmentar). */
  mtu: number;
  features: number;
}

const intersect = (a: number[], b: number[]) => a.filter(x => b.includes(x)).sort((x, y) => x - y);

/**
 * Regra de compatibilidade: vale a MAIOR versão comum às duas faixas. Uma versão desconhecida
 * (maior que a minha) no outro lado não derruba o enlace enquanto houver interseção.
 */
export function negotiate(mine: { minVersion: number; maxVersion: number; caps: Capabilities }, peer: { minVersion: number; maxVersion: number; caps: Capabilities }): Negotiated {
  const version = Math.min(mine.maxVersion, peer.maxVersion);
  if (version < Math.max(mine.minVersion, peer.minVersion)) throw new LnnpError(LnnpErrorCode.NoCommonVersion, `Sem versão comum (${mine.minVersion}–${mine.maxVersion} × ${peer.minVersion}–${peer.maxVersion}).`);
  const suites = intersect(mine.caps.suites, peer.caps.suites);
  if (!suites.length) throw new LnnpError(LnnpErrorCode.NoCommonSuite, 'Sem suíte criptográfica comum.');
  const envelopeVersions = intersect(mine.caps.envelopeVersions, peer.caps.envelopeVersions);
  if (!envelopeVersions.length) throw new LnnpError(LnnpErrorCode.NoCommonFormat, 'Sem formato de envelope comum.');
  return { version, suites, envelopeVersions, mtu: Math.min(mine.caps.mtu, peer.caps.mtu), features: mine.caps.features & peer.caps.features };
}

// ── anti-replay de desafios ─────────────────────────────────

/** Desafios (nonces de HELLO) vistos recentemente: um HELLO repetido é recusado. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  constructor(private windowSec = 2 * CLOCK_SKEW_SEC, private max = 10_000) {}
  /** `true` se o desafio é novo (e passa a ser lembrado). */
  check(nonce: Uint8Array, now: number): boolean {
    for (const [k, exp] of this.seen) { if (exp > now) break; this.seen.delete(k); }
    const k = toHex(nonce);
    if (this.seen.has(k)) return false;
    this.seen.set(k, now + this.windowSec);
    if (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
}

// ── erros no fio ────────────────────────────────────────────

/** Quadro ERROR: código u8 · motivo (u8 + UTF-8, até 200 bytes). Antes do handshake vai em claro. */
export function errorFrame(code: LnnpErrorCode, reason = ''): Uint8Array {
  const r = utf8(reason).slice(0, 200);
  return new Writer().u8(FrameType.Error).u8(code).u8(r.length).bytes(r).done();
}

export function decodeError(frame: Uint8Array): LnnpError {
  try {
    const r = new Reader(frame); r.u8();
    const code = r.u8();
    const reason = fromUtf8(r.bytes(r.u8()));
    return new LnnpError(code in LnnpErrorCode ? code : LnnpErrorCode.Malformed, reason || 'Erro do vizinho.', true);
  } catch {
    return new LnnpError(LnnpErrorCode.Malformed, 'Erro malformado do vizinho.', true);
  }
}

// ── handshake ───────────────────────────────────────────────

export interface HandshakeOptions {
  /** Chave técnica do nó (`deriveNodeKey`). Nunca a identidade social. */
  node: KeyPair;
  caps: Capabilities;
  /** Horário (s). */
  now: number;
  /** Faixa de versões do LNNP aceitas (padrão: LNNP_MIN_VERSION…LNNP_VERSION). */
  versions?: { min: number; max: number };
  /** Compartilhado entre os handshakes do nó: recusa HELLO repetido. */
  replay?: ReplayGuard;
  /** Autorização: lista de permitidos, revogação de chaves etc. `false` recusa o vizinho. */
  authorize?: (nodePk: Uint8Array, caps: Capabilities) => boolean;
}

const AUTH_LABEL = utf8('piu/lnnp/v1/auth');
const authMessage = (first: Uint8Array, second: Uint8Array) => hash(concat(AUTH_LABEL, hash(first), hash(second)));

function compareBytes(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; }
  return a.length - b.length;
}

/**
 * Um handshake LNNP de um lado do enlace. Uso:
 *   const hs = new Handshake({ node, caps, now });
 *   enviar(hs.hello);
 *   enviar(hs.receiveHello(helloDoVizinho));   // devolve o AUTH
 *   const link = hs.receiveAuth(authDoVizinho); // sessão autenticada
 * Qualquer falha lança `LnnpError`: mande `errorFrame(e.wire)` e feche.
 */
export class Handshake {
  readonly hello: Uint8Array;
  private ephSk = random(KEY_BYTES);
  private mine: Hello;
  private peerHelloBytes: Uint8Array | null = null;
  private peer: Hello | null = null;
  private negotiated: Negotiated | null = null;
  private done = false;

  constructor(private o: HandshakeOptions) {
    const v = o.versions ?? { min: LNNP_MIN_VERSION, max: LNNP_VERSION };
    this.mine = { minVersion: v.min, maxVersion: v.max, time: o.now, nodePk: o.node.pk, ephPk: agree.publicKey(this.ephSk), nonce: random(NONCE_BYTES_LNNP), caps: o.caps };
    this.hello = encodeHello(this.mine);
  }

  /** HELLO do vizinho: valida, negocia e devolve o AUTH a enviar. */
  receiveHello(frame: Uint8Array): Uint8Array {
    if (this.peer || this.done) throw new LnnpError(LnnpErrorCode.State, 'HELLO fora de hora.');
    const h = decodeHello(frame);
    if (equal(h.nodePk, this.o.node.pk)) throw new LnnpError(LnnpErrorCode.Self, 'Conexão consigo mesmo.');
    if (Math.abs(h.time - this.o.now) > CLOCK_SKEW_SEC) throw new LnnpError(LnnpErrorCode.Clock, 'Relógio do vizinho fora da tolerância.');
    if (equal(h.nonce, this.mine.nonce)) throw new LnnpError(LnnpErrorCode.Replay, 'Desafio refletido.');
    if (this.o.replay && !this.o.replay.check(h.nonce, this.o.now)) throw new LnnpError(LnnpErrorCode.Replay, 'Desafio repetido (replay).');
    this.negotiated = negotiate(this.mine, h);
    if (this.o.authorize && !this.o.authorize(h.nodePk, h.caps)) throw new LnnpError(LnnpErrorCode.Unauthorized, 'Nó não autorizado.');
    this.peer = h;
    this.peerHelloBytes = frame.slice();
    const sig = sign.sign(authMessage(this.hello, frame), this.o.node.sk);
    return new Writer().u8(FrameType.Auth).bytes(sig).done();
  }

  /** AUTH do vizinho: confere a assinatura e devolve a sessão de enlace. */
  receiveAuth(frame: Uint8Array): LinkSession {
    if (frame[0] === FrameType.Error) throw decodeError(frame);
    if (!this.peer || !this.peerHelloBytes || !this.negotiated || this.done) throw new LnnpError(LnnpErrorCode.State, 'AUTH fora de hora.');
    if (frame[0] !== FrameType.Auth || frame.length !== 1 + SIG_BYTES) throw new LnnpError(LnnpErrorCode.Malformed, 'AUTH malformado.');
    const sig = frame.slice(1);
    // O vizinho assinou (o HELLO dele, o MEU HELLO): o meu tem o meu desafio, novo nesta sessão.
    if (!sign.verify(sig, authMessage(this.peerHelloBytes, this.hello), this.peer.nodePk)) throw new LnnpError(LnnpErrorCode.BadSignature, 'Assinatura do vizinho não confere.');
    let shared: Uint8Array;
    try { shared = agree.shared(this.ephSk, this.peer.ephPk); } catch { throw new LnnpError(LnnpErrorCode.BadSignature, 'Chave efêmera inválida.'); }
    this.done = true;
    this.ephSk.fill(0);
    const iAmLo = compareBytes(this.o.node.pk, this.peer.nodePk) < 0;
    const [lo, hi] = iAmLo ? [this.hello, this.peerHelloBytes] : [this.peerHelloBytes, this.hello];
    const th = hash(concat(utf8('piu/lnnp/v1/transcript'), lo, hi));
    const dir = (label: string) => ({ key: kdf(shared, th, `piu/lnnp/v1/key/${label}`), prefix: kdf(shared, th, `piu/lnnp/v1/nonce/${label}`, 20) });
    const loHi = dir('lo-hi'), hiLo = dir('hi-lo');
    shared.fill(0);
    return new LinkSession(this.peer, this.negotiated, iAmLo ? loHi : hiLo, iAmLo ? hiLo : loHi, th);
  }
}

// ── sessão de enlace (quadros cifrados) ─────────────────────

export interface Frame { type: FrameType | number; body: Uint8Array }

interface Direction { key: Uint8Array; prefix: Uint8Array }

/**
 * Enlace autenticado. Cada registro: contador u32 · XChaCha20-Poly1305(tipo u8 · corpo).
 * O contador só cresce: registro repetido, fora de ordem ou adulterado é recusado.
 * Tipos de quadro desconhecidos são entregues como estão; quem usa deve ignorá-los.
 */
export class LinkSession {
  private sendCtr = 0;
  private recvCtr = -1;
  /** Capacidades atuais do vizinho (CAPS_UPDATE as atualiza). */
  peerCaps: Capabilities;
  readonly peerPk: Uint8Array;
  /** Id curto do vizinho (16 hex da chave do nó): para logs, estatísticas e o roteador. */
  readonly peerId: string;
  readonly version: number;

  constructor(peer: Hello, readonly negotiated: Negotiated, private tx: Direction, private rx: Direction, readonly transcript: Uint8Array) {
    this.peerPk = peer.nodePk;
    this.peerId = toHex(peer.nodePk).slice(0, 16);
    this.peerCaps = peer.caps;
    this.version = negotiated.version;
  }

  private nonce(d: Direction, ctr: number) { return concat(d.prefix, new Writer().u32(ctr).done()); }
  private ad(ctr: number) { return concat(LNNP_MAGIC, Uint8Array.of(this.version), new Writer().u32(ctr).done()); }

  seal(type: FrameType | number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
    if (body.length + 1 > MAX_FRAME_BYTES) throw new LnnpError(LnnpErrorCode.TooLarge, 'Quadro grande demais.');
    if (this.sendCtr > 0xffffffff) throw new LnnpError(LnnpErrorCode.State, 'Contador esgotado: refaça o handshake.');
    const ctr = this.sendCtr++;
    const ct = aead.seal(this.tx.key, this.nonce(this.tx, ctr), concat(Uint8Array.of(type), body), this.ad(ctr));
    return concat(new Writer().u32(ctr).done(), ct);
  }

  open(record: Uint8Array): Frame {
    if (record.length < RECORD_OVERHEAD + 1 || record.length > MAX_FRAME_BYTES + RECORD_OVERHEAD) throw new LnnpError(LnnpErrorCode.Malformed, 'Registro com tamanho inválido.');
    const ctr = new Reader(record).u32();
    if (ctr <= this.recvCtr) throw new LnnpError(LnnpErrorCode.Replay, 'Registro repetido ou fora de ordem.');
    const plain = aead.open(this.rx.key, this.nonce(this.rx, ctr), record.slice(4), this.ad(ctr));
    if (!plain || plain.length < 1) throw new LnnpError(LnnpErrorCode.BadSignature, 'Registro adulterado.');
    this.recvCtr = ctr;
    const type = plain[0] ?? 0;
    const body = plain.slice(1);
    if (type === FrameType.CapsUpdate && (this.negotiated.features & Feature.CapsUpdate)) this.peerCaps = decodeCaps(body);
    return { type, body };
  }

  /** O que este lado pode mandar ao vizinho de uma vez (antes de cifrar). */
  get maxFrame() { return Math.min(MAX_FRAME_BYTES, this.negotiated.mtu - RECORD_OVERHEAD); }
}

// ── recibos de retransmissão no fio ─────────────────────────

/** RELAY_RECEIPT: id do envelope (16) · hash do segredo de entrega (16) · chave do nó (32) · horário u32 · assinatura (64). */
export function encodeReceipt(r: RelayReceipt): Uint8Array {
  return new Writer().bytes(hexToBytes(r.envelopeId)).bytes(r.ackHash).bytes(r.nodePk).u32(r.at).bytes(r.sig).done();
}

export function decodeReceipt(b: Uint8Array): RelayReceipt {
  if (b.length !== 16 + 16 + 32 + 4 + SIG_BYTES) throw new LnnpError(LnnpErrorCode.Malformed, 'Recibo com tamanho inválido.');
  const r = new Reader(b);
  return { envelopeId: toHex(r.bytes(16)), ackHash: r.bytes(16), nodePk: r.bytes(32), at: r.u32(), sig: r.bytes(SIG_BYTES) };
}

// ── descoberta (anúncio na rede local) ──────────────────────

/**
 * Anúncio de descoberta (UDP, sem autenticação: é só uma dica; a identidade é provada no handshake):
 *   "LNNP" · 0xBE · versão mínima u8 · versão máxima u8 · porta do enlace u16 · etiqueta (8) · flags u8 (bit 0 = relay)
 * A etiqueta é hash(chave do nó)[0..8]: serve para os dois lados decidirem quem conecta (o de etiqueta menor).
 */
export interface Beacon { minVersion: number; maxVersion: number; port: number; tag: Uint8Array; relay: boolean }
export const BEACON_KIND = 0xbe;
export const BEACON_BYTES = 4 + 1 + 1 + 1 + 2 + 8 + 1;

export const nodeTag = (nodePk: Uint8Array) => hash(concat(utf8('piu/lnnp/v1/tag'), nodePk)).slice(0, 8);

export function encodeBeacon(b: Beacon): Uint8Array {
  return new Writer().bytes(LNNP_MAGIC).u8(BEACON_KIND).u8(b.minVersion).u8(b.maxVersion).u16(b.port).bytes(b.tag).u8(b.relay ? 1 : 0).done();
}

/** `null` se não for um anúncio LNNP (outros programas podem usar a mesma porta). */
export function decodeBeacon(b: Uint8Array): Beacon | null {
  if (b.length < BEACON_BYTES) return null;
  const r = new Reader(b);
  if (!equal(r.bytes(4), LNNP_MAGIC) || r.u8() !== BEACON_KIND) return null;
  const minVersion = r.u8(), maxVersion = r.u8(), port = r.u16(), tag = r.bytes(8), flags = r.u8();
  if (minVersion === 0 || minVersion > maxVersion || port === 0) return null;
  return { minVersion, maxVersion, port, tag, relay: (flags & 1) === 1 };
}

export { compareBytes };

function hexToBytes(h: string) {
  if (!/^[0-9a-f]{32}$/.test(h)) throw new LnnpError(LnnpErrorCode.Malformed, 'Id de envelope inválido.');
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}
