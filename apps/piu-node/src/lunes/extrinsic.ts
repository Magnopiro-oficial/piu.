// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/lib/extrinsic.ts. Não edite aqui.
/**
 * SCALE à mão para UMA chamada: `balances.transfer_keep_alive` da Lunes Mainnet, em extrinsic v4
 * assinado com sr25519 (etapa 2 de docs/carteira/proposta-carteira-propria.md). Sem @polkadot/*.
 *
 * Confirmado ao vivo na metadata v14 da Mainnet (2026-11-04):
 * - Balances = pallet 4; `transfer_keep_alive(dest: MultiAddress, value: Compact<u128>)` = índice 3.
 * - Signed extensions, nesta ordem: CheckNonZeroSender, CheckSpecVersion, CheckTxVersion, CheckGenesis,
 *   CheckMortality, CheckNonce, CheckWeight, RestrictAssetMint (vazio), ChargeTransactionPayment.
 *   → extra = era ‖ compact(nonce) ‖ compact(tip)
 *   → additional = u32 specVersion ‖ u32 transactionVersion ‖ gênese ‖ hash do bloco da era
 * - Payload assinado = call ‖ extra ‖ additional; se passar de 256 bytes, assina-se o blake2b-256 dele.
 * - Extrinsic = compact(len) ‖ 0x84 ‖ MultiAddress::Id(0x00 ‖ pk) ‖ MultiSignature::Sr25519(0x01 ‖ sig) ‖ extra ‖ call
 * Se o runtime mudar (specVersion ≠ 107), repetir a conferência das extensões antes de confiar neste arquivo.
 * Os bytes aqui são idênticos aos do @polkadot/types (fixtures em __tests__/walletFixture.ts).
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { decodeSs58 } from './ss58.js';
import { signWithWalletKey, type WalletKey } from './walletKey.js';

export const BALANCES_PALLET = 4;
export const TRANSFER_KEEP_ALIVE = 3;
/** Era padrão: 64 blocos (~6,4 min), como em apps/settlement. */
export const DEFAULT_ERA_PERIOD = 64;
/**
 * `period: 0` = era IMORTAL (1 byte `0x00`; o bloco da era é a gênese). Só para a transação levada pela
 * malha (docs/carteira/transacoes-pela-malha.md): a Lunes guarda só os últimos 2400 hashes de bloco
 * (`System.BlockHash`, lido ao vivo em 2026-11-06), então uma era mortal vale no máximo ~4 h, pouco
 * para um gateway alcançar. A imortal vale até o nonce ser usado ou o runtime mudar (spec/tx version).
 */
export const IMMORTAL_PERIOD = 0;

const U128_MAX = (1n << 128n) - 1n;
const toHex = (b: Uint8Array) => '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32le = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
const hash32 = (h: string, what: string) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`Hash ${what} inválido (0x + 64 hex).`);
  return Uint8Array.from(h.slice(2).match(/../g)!, x => parseInt(x, 16));
};

// ── compact ───────────────────────────────────────────────
/** SCALE Compact<u128>. */
export function compact(n: bigint | number): Uint8Array {
  const v = BigInt(n);
  if (v < 0n) throw new Error('Compact não aceita negativo.');
  if (v > U128_MAX) throw new Error('Valor maior que u128.');
  if (v < 64n) return Uint8Array.of(Number(v) << 2);
  if (v < 1n << 14n) { const x = (Number(v) << 2) | 1; return Uint8Array.of(x & 255, x >>> 8); }
  if (v < 1n << 30n) { const x = (Number(v) << 2) | 2; return Uint8Array.of(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255); }
  const bytes: number[] = [];
  for (let x = v; x > 0n; x >>= 8n) bytes.push(Number(x & 255n));
  return Uint8Array.of(((bytes.length - 4) << 2) | 3, ...bytes);
}

/** Lê um Compact a partir de `offset`: valor e quantos bytes ocupou. */
export function decodeCompact(b: Uint8Array, offset = 0): { value: bigint; length: number } {
  const need = (n: number) => { if (offset + n > b.length) throw new Error('Compact curto demais.'); };
  need(1);
  const mode = b[offset]! & 3;
  if (mode === 0) return { value: BigInt(b[offset]! >>> 2), length: 1 };
  if (mode === 1) { need(2); return { value: BigInt((b[offset]! | (b[offset + 1]! << 8)) >>> 2), length: 2 }; }
  if (mode === 2) { need(4); return { value: BigInt(((b[offset]! | (b[offset + 1]! << 8) | (b[offset + 2]! << 16) | (b[offset + 3]! << 24)) >>> 2)), length: 4 }; }
  const len = (b[offset]! >>> 2) + 4;
  need(1 + len);
  let value = 0n;
  for (let i = len - 1; i >= 0; i--) value = (value << 8n) | BigInt(b[offset + 1 + i]!);
  return { value, length: 1 + len };
}

// ── era ───────────────────────────────────────────────────
/**
 * Era mortal (2 bytes) como o `ExtrinsicEra` do Substrate: período arredondado para potência de 2
 * entre 4 e 65536, fase = bloco atual mod período (quantizada quando o período passa de 4096).
 */
export function mortalEra(currentBlock: number, period: number = DEFAULT_ERA_PERIOD): Uint8Array {
  if (!Number.isInteger(currentBlock) || currentBlock < 0) throw new Error('Número de bloco inválido.');
  const p = Math.min(65536, Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, period)))));
  const phase = currentBlock % p;
  const q = Math.max(p >> 12, 1);
  const enc = Math.min(15, Math.max(1, Math.log2(p) - 1)) | ((phase / q) << 4);
  return Uint8Array.of(enc & 255, (enc >>> 8) & 255);
}

/** Decodifica os 2 bytes de uma era mortal. */
export function decodeEra(b: Uint8Array): { period: number; phase: number } {
  if (b.length >= 1 && b[0] === 0) return { period: IMMORTAL_PERIOD, phase: 0 };
  if (b.length < 2) throw new Error('Era curta demais.');
  const enc = b[0]! | (b[1]! << 8);
  const period = 2 ** ((enc & 15) + 1);
  const q = Math.max(period >> 12, 1);
  return { period, phase: (enc >>> 4) * q };
}

// ── call ──────────────────────────────────────────────────
/** `Balances(4).transfer_keep_alive(3)(MultiAddress::Id(dest), Compact(value))`. */
export function transferKeepAliveCall(dest: Uint8Array, value: bigint): Uint8Array {
  if (dest.length !== 32) throw new Error('O destino precisa ter 32 bytes.');
  if (value <= 0n) throw new Error('O valor precisa ser maior que zero.');
  return cat(Uint8Array.of(BALANCES_PALLET, TRANSFER_KEEP_ALIVE, 0), dest, compact(value));
}

/** O inverso: só reconhece exatamente o call acima (qualquer outra coisa → null). */
export function decodeTransferKeepAlive(call: Uint8Array): { dest: Uint8Array; value: bigint } | null {
  if (call.length < 36 || call[0] !== BALANCES_PALLET || call[1] !== TRANSFER_KEEP_ALIVE || call[2] !== 0) return null;
  try {
    const { value, length } = decodeCompact(call, 35);
    if (35 + length !== call.length) return null;
    return { dest: call.slice(3, 35), value };
  } catch { return null; }
}

// ── extra / additional / payload ──────────────────────────
/** O que o nó informa antes de assinar: lido ao vivo, nunca fixo no código. */
export interface SigningContext {
  specVersion: number;
  transactionVersion: number;
  genesisHash: string;
  /** Bloco de referência da era (finalizado recente) e seu número. */
  blockHash: string;
  blockNumber: number;
  nonce: number;
  /** Gorjeta em planck (padrão 0). */
  tip?: bigint;
  /** Blocos de validade (padrão 64). `IMMORTAL_PERIOD` (0): era imortal, com `blockHash` = gênese. */
  period?: number;
}

/** `extra` = era ‖ compact(nonce) ‖ compact(tip). (RestrictAssetMint e as demais extensões não têm bytes.) */
export const signedExtra = (ctx: SigningContext) =>
  cat(ctx.period === IMMORTAL_PERIOD ? Uint8Array.of(0) : mortalEra(ctx.blockNumber, ctx.period ?? DEFAULT_ERA_PERIOD), compact(ctx.nonce), compact(ctx.tip ?? 0n));

/** `additional` = u32 specVersion ‖ u32 transactionVersion ‖ gênese ‖ hash do bloco da era. */
export function additionalSigned(ctx: SigningContext): Uint8Array {
  // Na era imortal o runtime confere contra o hash do bloco 0: qualquer outro daria BadProof.
  if (ctx.period === IMMORTAL_PERIOD && ctx.blockHash.toLowerCase() !== ctx.genesisHash.toLowerCase()) throw new Error('Era imortal exige o hash da gênese como bloco da era.');
  return cat(u32le(ctx.specVersion), u32le(ctx.transactionVersion), hash32(ctx.genesisHash, 'da gênese'), hash32(ctx.blockHash, 'do bloco'));
}

/** Bytes que se assinam: call ‖ extra ‖ additional, ou o blake2b-256 disso se passar de 256 bytes. */
export function signingPayload(call: Uint8Array, ctx: SigningContext): Uint8Array {
  const raw = cat(call, signedExtra(ctx), additionalSigned(ctx));
  return raw.length > 256 ? blake2b(raw, { dkLen: 32 }) : raw;
}

// ── extrinsic ─────────────────────────────────────────────
/** Extrinsic v4 assinado: compact(len) ‖ 0x84 ‖ Id(signer) ‖ Sr25519(sig) ‖ extra ‖ call. */
export function encodeSignedExtrinsic(signer: Uint8Array, signature: Uint8Array, extra: Uint8Array, call: Uint8Array): Uint8Array {
  if (signer.length !== 32) throw new Error('A chave pública precisa ter 32 bytes.');
  if (signature.length !== 64) throw new Error('A assinatura sr25519 precisa ter 64 bytes.');
  const body = cat(Uint8Array.of(0x84, 0x00), signer, Uint8Array.of(0x01), signature, extra, call);
  return cat(compact(body.length), body);
}

export interface SignedTransfer {
  call: Uint8Array;
  payload: Uint8Array;
  signature: Uint8Array;
  extrinsic: Uint8Array;
  /** Hex do extrinsic (o que vai em `author_submitExtrinsic` e `payment_queryInfo`). */
  hex: string;
  /** blake2b-256 do extrinsic: o hash da transação, como o nó e o explorador mostram. */
  hash: string;
  length: number;
  era: { period: number; phase: number };
  /** Último bloco em que o nó ainda aceita (depois disso: reassinar com nonce/bloco novos). Imortal: `Number.MAX_SAFE_INTEGER`. */
  validUntil: number;
}

/**
 * Monta e assina uma transferência `transfer_keep_alive`. `dest` pode ser a chave pública (32 bytes)
 * ou um endereço SS58 da Lunes (57 ou 42). O chamador zera `key.secret` depois (ou usa `withWalletKey`).
 * `random` só em testes (torna a assinatura determinística).
 */
export function buildTransferKeepAlive(key: WalletKey, o: { dest: Uint8Array | string; value: bigint; ctx: SigningContext; random?: Uint8Array }): SignedTransfer {
  let dest: Uint8Array;
  if (typeof o.dest === 'string') {
    const d = decodeSs58(o.dest);
    if (!d.ok) throw new Error(d.error);
    dest = d.publicKey;
  } else dest = o.dest;
  const call = transferKeepAliveCall(dest, o.value);
  const extra = signedExtra(o.ctx);
  const payload = signingPayload(call, o.ctx);
  const signature = signWithWalletKey(key, payload, o.random);
  const extrinsic = encodeSignedExtrinsic(key.publicKey, signature, extra, call);
  const era = decodeEra(extra);
  return {
    call, payload, signature, extrinsic, hex: toHex(extrinsic), hash: toHex(blake2b(extrinsic, { dkLen: 32 })), length: extrinsic.length, era,
    validUntil: era.period === IMMORTAL_PERIOD ? Number.MAX_SAFE_INTEGER : o.ctx.blockNumber + era.period,
  };
}

/**
 * Lê um extrinsic v4 assinado (sr25519) que seja exatamente uma `transfer_keep_alive` (o que a carteira
 * do Piu monta). O gateway usa antes de gastar uma consulta à Mainnet com o que chegou pela malha.
 * Não confere a assinatura (quem confere é o runtime, com o contexto que só ele tem). `null` se não for.
 */
export function decodeSignedTransfer(xt: Uint8Array): { signer: Uint8Array; era: { period: number; phase: number }; nonce: bigint; tip: bigint; dest: Uint8Array; value: bigint } | null {
  try {
    const prefix = decodeCompact(xt);
    if (Number(prefix.value) + prefix.length !== xt.length) return null;
    const body = xt.subarray(prefix.length);
    if (body.length < 100 || body[0] !== 0x84 || body[1] !== 0x00 || body[34] !== 0x01) return null;
    let o = 99;
    const era = decodeEra(body.subarray(o));
    o += era.period === IMMORTAL_PERIOD ? 1 : 2;
    const nonce = decodeCompact(body, o); o += nonce.length;
    const tip = decodeCompact(body, o); o += tip.length;
    const call = decodeTransferKeepAlive(body.subarray(o));
    if (!call) return null;
    return { signer: body.slice(2, 34), era, nonce: nonce.value, tip: tip.value, dest: call.dest, value: call.value };
  } catch { return null; }
}
