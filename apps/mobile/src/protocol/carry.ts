/**
 * Carga pela malha até um gateway (docs/carteira/transacoes-pela-malha.md): transação Lunes já
 * assinada no aparelho e pacotes de evidências para o validador viajam como envelopes diretos para
 * "qualquer gateway"; quem tem internet e o papel de gateway ligado envia à Mainnet (ou à caixa de
 * entrada do validador) e devolve um recibo pela malha.
 *
 * Como cabe no envelope atual (envelope.ts), sem formato novo:
 * - O destino é a identidade `GATEWAY_IDENTITY`, derivada de um rótulo FIXO: a chave é pública de
 *   propósito. Qualquer gateway abre; qualquer relay também conseguiria abrir, e tudo bem: uma transação
 *   assinada é dado público, e o pacote de evidências vai selado para a chave do validador.
 * - Quem envia é uma identidade DESCARTÁVEL, nova a cada carga (`returnSeed`): nada liga o envelope à
 *   identidade de mensagens da pessoa. O recibo volta para essa identidade descartável (o "token de
 *   retorno de uso único"), num envelope direto comum, de outra identidade descartável do gateway.
 * - Tipo `MsgType.Carry` (5). Aparelhos antigos não têm a chave do gateway nem a descartável: para eles
 *   é um envelope de terceiros como outro qualquer (guardam e repassam com o Modo nó ligado) e o tipo
 *   novo nunca chega a ser aberto (`readInner` antigo recusa tipo > 4).
 *
 * O recibo NÃO é prova: qualquer relay que viu a carga pode forjar um. A carteira só trata como
 * "informado pelo gateway" e confirma na Mainnet quando o próprio aparelho tiver internet.
 */
import { concat, fromUtf8, ProtocolError, Reader, toHex, utf8, Writer } from './bytes';
import { directDest, EnvelopeKind, type Header, MAX_TTL_SEC, MsgType, type Opened, openDirect, parseHeader, Priority, sealDirect } from './envelope';
import { deriveIdentity, type Identity, type KeyPair, type PublicIdentity } from './keys';
import { aead, agree, hash, kdf, KEY_BYTES, NONCE_BYTES, random } from './suite';

export const CARRY_VERSION = 1;
export enum CarryKind { Tx = 1, Evidence = 2, Receipt = 3 }
/** Rede de destino da transação. Só a Lunes Mainnet por enquanto. */
export enum CarryChain { LunesMainnet = 1 }
/** O que o pacote de evidências leva (dentro do selo do validador). */
export enum BundleKind { Evidence = 1, Registry = 2 }

/** Uma `transfer_keep_alive` assinada tem ~145 bytes; folga para outras chamadas pequenas. */
export const MAX_CARRIED_TX_BYTES = 512;
/** Pacote selado: cabe no bloco de preenchimento de 16 KB do envelope. */
export const MAX_BUNDLE_BYTES = 12 * 1024;
export const MAX_REASON_CHARS = 120;
/** Carga e recibo vivem o máximo que um envelope vive (7 dias): o gateway pode estar longe. */
export const CARRY_TTL_SEC = MAX_TTL_SEC;
export const RECEIPT_TTL_SEC = MAX_TTL_SEC;

/**
 * "Qualquer gateway": identidades conhecidas por todos (sementes de rótulo fixo, NÃO são segredo). Duas,
 * para cada gateway só "pegar" o que consegue entregar: quem tem internet e o papel ligado aceita as
 * transações (`GATEWAY_TX_IDENTITY`); só quem tem a caixa de entrada do validador configurada aceita os
 * pacotes (`GATEWAY_INBOX_IDENTITY`). Os outros nós repassam como envelope de terceiros. Mudar um rótulo
 * separa a rede em duas: só com versão nova do formato.
 */
export const GATEWAY_TX_IDENTITY: Identity = deriveIdentity(kdf(utf8('piu/v1/carry'), undefined, 'gateway/tx/seed'), 'public', 0);
export const GATEWAY_INBOX_IDENTITY: Identity = deriveIdentity(kdf(utf8('piu/v1/carry'), undefined, 'gateway/inbox/seed'), 'public', 0);
const gatewayFor = (kind: CarryKind.Tx | CarryKind.Evidence) => (kind === CarryKind.Tx ? GATEWAY_TX_IDENTITY : GATEWAY_INBOX_IDENTITY);
export const gatewayDest = (kind: CarryKind.Tx | CarryKind.Evidence, expiresAt: number) => directDest(gatewayFor(kind).agreePk, expiresAt);

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Para qual tipo de gateway vai este envelope (só o cabeçalho; relays usam para os limites por enlace). */
export function gatewayKindOf(h: Header | Uint8Array): CarryKind.Tx | CarryKind.Evidence | null {
  try {
    const header = h instanceof Uint8Array ? parseHeader(h) : h;
    if (header.kind !== EnvelopeKind.Direct) return null;
    if (sameBytes(header.dest, gatewayDest(CarryKind.Tx, header.expiresAt))) return CarryKind.Tx;
    if (sameBytes(header.dest, gatewayDest(CarryKind.Evidence, header.expiresAt))) return CarryKind.Evidence;
    return null;
  } catch { return null; }
}
export const isGatewayBound = (h: Header | Uint8Array) => gatewayKindOf(h) !== null;

// ── itens ─────────────────────────────────────────────────

export type CarryItem =
  | { kind: CarryKind.Tx; chain: CarryChain; extrinsic: Uint8Array }
  | { kind: CarryKind.Evidence; sealed: Uint8Array };

export type CarryStatus =
  /** Aceita no pool de um nó da Lunes (ainda não está em bloco). */
  | 'pool'
  | 'included'
  | 'finalized'
  /** Recusada pela Lunes na validação (nonce já usado, saldo, assinatura, runtime). */
  | 'invalid'
  /** Pacote entregue à caixa de entrada do validador. */
  | 'accepted'
  /** O gateway não conseguiu (sem rota, caixa recusou); outro gateway ainda pode tentar. */
  | 'error';
const STATUSES: CarryStatus[] = ['pool', 'included', 'finalized', 'invalid', 'accepted', 'error'];

export interface CarryReceipt {
  about: CarryKind.Tx | CarryKind.Evidence;
  /** Tx: hash da transação (blake2b-256). Evidência: `bundleRef` do pacote selado. */
  ref: Uint8Array;
  status: CarryStatus;
  block?: { number: number; hash: Uint8Array; index: number };
  reason?: string;
}

export function encodeCarryItem(it: CarryItem): Uint8Array {
  const w = new Writer().u8(CARRY_VERSION).u8(it.kind);
  if (it.kind === CarryKind.Tx) {
    if (it.extrinsic.length < 1 || it.extrinsic.length > MAX_CARRIED_TX_BYTES) throw new ProtocolError('TOO_LARGE', 'Transação grande demais para levar pela malha.');
    return w.u8(it.chain).u16(it.extrinsic.length).bytes(it.extrinsic).done();
  }
  if (it.sealed.length < 1 || it.sealed.length > MAX_BUNDLE_BYTES) throw new ProtocolError('TOO_LARGE', 'Pacote de evidências grande demais.');
  return w.u16(it.sealed.length).bytes(it.sealed).done();
}

export function decodeCarryItem(b: Uint8Array): CarryItem | null {
  try {
    const r = new Reader(b);
    if (r.u8() !== CARRY_VERSION) return null;
    const kind = r.u8();
    let it: CarryItem;
    if (kind === CarryKind.Tx) {
      const chain = r.u8();
      if (chain !== CarryChain.LunesMainnet) return null;
      const n = r.u16();
      if (n < 1 || n > MAX_CARRIED_TX_BYTES) return null;
      it = { kind, chain, extrinsic: r.bytes(n) };
    } else if (kind === CarryKind.Evidence) {
      const n = r.u16();
      if (n < 1 || n > MAX_BUNDLE_BYTES) return null;
      it = { kind, sealed: r.bytes(n) };
    } else return null;
    return r.remaining === 0 ? it : null;
  } catch { return null; }
}

export function encodeCarryReceipt(rc: CarryReceipt): Uint8Array {
  if (rc.ref.length !== 32) throw new ProtocolError('LENGTH', 'Referência do recibo com tamanho errado.');
  const reason = utf8((rc.reason ?? '').slice(0, MAX_REASON_CHARS));
  const w = new Writer().u8(CARRY_VERSION).u8(CarryKind.Receipt).u8(rc.about).bytes(rc.ref).u8(STATUSES.indexOf(rc.status));
  if (rc.block) {
    if (rc.block.hash.length !== 32) throw new ProtocolError('LENGTH', 'Hash do bloco com tamanho errado.');
    w.u8(1).u32(rc.block.number).bytes(rc.block.hash).u16(rc.block.index);
  } else w.u8(0);
  return w.u16(reason.length).bytes(reason).done();
}

export function decodeCarryReceipt(b: Uint8Array): CarryReceipt | null {
  try {
    const r = new Reader(b);
    if (r.u8() !== CARRY_VERSION || r.u8() !== CarryKind.Receipt) return null;
    const about = r.u8();
    if (about !== CarryKind.Tx && about !== CarryKind.Evidence) return null;
    const ref = r.bytes(32);
    const status = STATUSES[r.u8()];
    if (!status) return null;
    const hasBlock = r.u8();
    if (hasBlock > 1) return null;
    const block = hasBlock ? { number: r.u32(), hash: r.bytes(32), index: r.u16() } : undefined;
    const n = r.u16();
    if (n > MAX_REASON_CHARS * 4) return null;
    const reason = fromUtf8(r.bytes(n));
    if (r.remaining !== 0) return null;
    return { about, ref, status, ...(block ? { block } : {}), ...(reason ? { reason: reason.slice(0, MAX_REASON_CHARS) } : {}) };
  } catch { return null; }
}

// ── envelopes ─────────────────────────────────────────────

/** Identidade descartável de retorno (o recibo volta para ela). Guarde a semente até o recibo chegar. */
export const returnIdentity = (seed: Uint8Array): Identity => deriveIdentity(seed, 'anon', 0);

export interface SealedCarry { bytes: Uint8Array; id: string; returnSeed: Uint8Array; expiresAt: number }

/** Envelope para "qualquer gateway", assinado por uma identidade descartável nova. */
export function sealCarry(o: { item: CarryItem; now: number; ttlSec?: number; priority?: Priority; pad?: boolean }): SealedCarry {
  const returnSeed = random(32);
  const ttl = Math.min(o.ttlSec ?? CARRY_TTL_SEC, CARRY_TTL_SEC);
  const s = sealDirect({ from: returnIdentity(returnSeed), to: gatewayFor(o.item.kind), type: MsgType.Carry, body: encodeCarryItem(o.item), now: o.now, ttlSec: ttl, priority: o.priority ?? Priority.High, pad: o.pad });
  return { bytes: s.bytes, id: s.id, returnSeed, expiresAt: parseHeader(s.bytes).expiresAt };
}

export interface OpenedCarry { id: string; item: CarryItem; replyTo: PublicIdentity; sentAt: number; expiresAt: number }

/** Lado do gateway: abre a carga (ou `null` se não for carga válida, estiver adulterada ou vencida). */
export function openCarry(bytes: Uint8Array, now: number): OpenedCarry | null {
  const kind = gatewayKindOf(bytes);
  if (kind === null) return null;
  const m = openDirect(bytes, gatewayFor(kind), now);
  return m ? carryOf(m, bytes) : null;
}

/** A mesma conferência, para quem já abriu o envelope com o roteador (identidade do gateway na lista). */
export function carryOf(m: Opened, bytes: Uint8Array): OpenedCarry | null {
  if (m.type !== MsgType.Carry) return null;
  let h: Header;
  try { h = parseHeader(bytes); } catch { return null; }
  const kind = gatewayKindOf(h);
  const item = decodeCarryItem(m.body);
  // Cada item só vale no destino do tipo dele (transação no de transações, pacote no da caixa).
  return item && item.kind === kind ? { id: m.id, item, replyTo: m.from, sentAt: m.sentAt, expiresAt: h.expiresAt } : null;
}

/** Recibo de volta para a identidade descartável de quem mandou. O gateway também assina com uma descartável. */
export function sealCarryReceipt(replyTo: PublicIdentity, rc: CarryReceipt, now: number, ttlSec = RECEIPT_TTL_SEC) {
  return sealDirect({ from: deriveIdentity(random(32), 'anon', 0), to: replyTo, type: MsgType.Carry, body: encodeCarryReceipt(rc), now, ttlSec: Math.min(ttlSec, RECEIPT_TTL_SEC), priority: Priority.High });
}

/** Lado de quem mandou: o recibo para a minha identidade descartável (`null` se não for). */
export function openCarryReceipt(bytes: Uint8Array, me: Identity, now: number): CarryReceipt | null {
  const m = openDirect(bytes, me, now);
  return m && m.type === MsgType.Carry ? decodeCarryReceipt(m.body) : null;
}

// ── pacote selado para o validador ───────────────────────

const BUNDLE_VERSION = 1;
const bundleAd = (validatorPk: Uint8Array) => concat(utf8('piu/v1/evidence-bundle'), validatorPk);
const bundleKey = (shared: Uint8Array, ephPk: Uint8Array, validatorPk: Uint8Array) => kdf(shared, concat(ephPk, validatorPk), 'piu/v1/evidence-bundle/seal');

/**
 * Cifra um arquivo de evidências (`BundleKind.Evidence`) ou de registro (`BundleKind.Registry`) para a
 * chave X25519 do validador (a mesma das provas v2, `validatorProofKey`). Gateways e relays só levam.
 */
export function sealBundle(kind: BundleKind, json: string, validatorPk: Uint8Array): Uint8Array {
  const ephSk = random(KEY_BYTES), ephPk = agree.publicKey(ephSk), nonce = random(NONCE_BYTES);
  const key = bundleKey(agree.shared(ephSk, validatorPk), ephPk, validatorPk);
  const out = concat(Uint8Array.of(BUNDLE_VERSION), ephPk, nonce, aead.seal(key, nonce, concat(Uint8Array.of(kind), utf8(json)), bundleAd(validatorPk)));
  if (out.length > MAX_BUNDLE_BYTES) throw new ProtocolError('TOO_LARGE', 'Pacote de evidências grande demais; divida em partes.');
  return out;
}

/** Lado do validador. `null` se não for para esta chave, estiver adulterado ou o tipo for desconhecido. */
export function openBundle(sealed: Uint8Array, validator: KeyPair): { kind: BundleKind; json: string } | null {
  try {
    if (sealed.length > MAX_BUNDLE_BYTES || sealed[0] !== BUNDLE_VERSION) return null;
    const r = new Reader(sealed);
    r.u8();
    const ephPk = r.bytes(KEY_BYTES), nonce = r.bytes(NONCE_BYTES), ct = r.bytes(r.remaining);
    const plain = aead.open(bundleKey(agree.shared(validator.sk, ephPk), ephPk, validator.pk), nonce, ct, bundleAd(validator.pk));
    if (!plain || plain.length < 2) return null;
    const kind = plain[0];
    if (kind !== BundleKind.Evidence && kind !== BundleKind.Registry) return null;
    return { kind, json: fromUtf8(plain.subarray(1)) };
  } catch { return null; }
}

/** Referência de 32 bytes do pacote (vai no recibo e serve para deduplicar na caixa do validador). */
export const bundleRef = (sealed: Uint8Array) => hash(concat(utf8('piu/v1/bundle-ref'), sealed));
export const bundleRefHex = (sealed: Uint8Array) => toHex(bundleRef(sealed));

// ── limite por enlace ────────────────────────────────────

/**
 * Balde de fichas por vizinho só para cargas de gateway (além do limite geral do roteador): uma carga
 * custa a um gateway uma consulta à Mainnet, então um vizinho não pode despejar centenas.
 */
export class CarryLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(readonly perHour = 30, readonly burst = 10, private maxPeers = 4096) {}
  take(peer: string, now: number): boolean {
    const b = this.buckets.get(peer) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) * this.perHour) / 3600);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.delete(peer);
    this.buckets.set(peer, b);
    while (this.buckets.size > this.maxPeers) this.buckets.delete(this.buckets.keys().next().value!);
    return ok;
  }
}
