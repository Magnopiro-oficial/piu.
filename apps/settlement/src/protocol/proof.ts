// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/proof.ts. Não edite aqui.
/**
 * Prova de entrega v2 (docs/economia/prova-de-entrega-v2.md; auditoria 2026-11-06, C-01 e A-01).
 *
 * No v1 a prova era só o `ackSecret` em claro: o validador calculava o `ackHash` a partir do próprio
 * segredo, e qualquer par {id aleatório, segredo aleatório} "comprovava" uma entrega. Na v2:
 * - o `ackHash` vem do CABEÇALHO do envelope (escolhido e assinado pelo remetente, dentro da cifra);
 * - quem prova é o DESTINO: depois de abrir o envelope (AEAD e assinatura do remetente conferidas),
 *   ele assina {id, cabeçalho autenticado, ackSecret} com um PSEUDÔNIMO da identidade que recebeu,
 *   derivado para este validador (`proofPseudonym`): o validador não liga a prova à identidade
 *   social nem a pública à anônima, mas o mesmo destino tem sempre o mesmo pseudônimo (teto por destino);
 * - a prova ainda viaja SELADA para a chave X25519 do validador: os relays não ligam provas entre si
 *   pelo pseudônimo. O remetente nunca aparece.
 *
 * O envelope e o recibo de retransmissão não mudam (os celulares instalados continuam iguais).
 */
import { concat, equal, ProtocolError, Reader, toHex, utf8, Writer } from './bytes.js';
import { authHeader, CLOCK_SKEW_SEC, EnvelopeKind, envelopeId, HEADER_BYTES, type Header, HOP_OFFSET, MAX_TTL_SEC, parseAuthHeader } from './envelope.js';
import type { Identity, KeyPair } from './keys.js';
import { roundReceiptTime } from './receipts.js';
import { aead, agree, hash, kdf, KEY_BYTES, NONCE_BYTES, random, sign, SIG_BYTES } from './suite.js';

export const PROOF_VERSION = 2;
/** versão, id, cabeçalho, segredo, pseudônimo, provedAt, assinatura. */
export const DELIVERY_PROOF_BYTES = 1 + 16 + HEADER_BYTES + 16 + 32 + 4 + SIG_BYTES;
const TAG_BYTES = 16;
/** versão, chave efêmera, nonce, prova cifrada + tag. */
export const SEALED_PROOF_BYTES = 1 + KEY_BYTES + NONCE_BYTES + DELIVERY_PROOF_BYTES + TAG_BYTES;

/**
 * Chave pública X25519 do validador para as provas seladas. `null`: o app não gera prova v2 (só a v1,
 * que não rende nada no validador v2). Preencher com a saída de `npm run validator:keygen`
 * (apps/settlement) antes de ativar a recompensa.
 */
export const VALIDATOR_PROOF_PK: Uint8Array | null = null;

export interface DeliveryProof {
  envelopeId: string;
  /** Cabeçalho autenticado (104 bytes, saltos zerados). */
  header: Uint8Array;
  ackSecret: Uint8Array;
  /** Pseudônimo Ed25519 do destino para este validador (`proofPseudonym`). */
  pseudonym: Uint8Array;
  /** Hora cheia (s, para baixo) em que o destino abriu. */
  provedAt: number;
  sig: Uint8Array;
}

const HEX_ID = /^[0-9a-f]{32}$/;
function idBytes(id: string): Uint8Array {
  if (!HEX_ID.test(id)) throw new ProtocolError('MALFORMED', 'Id de envelope inválido.');
  return Uint8Array.from(id.match(/../g) ?? [], x => parseInt(x, 16));
}

const unsignedBytes = (p: Omit<DeliveryProof, 'sig'>) =>
  new Writer().u8(PROOF_VERSION).bytes(idBytes(p.envelopeId)).bytes(p.header).bytes(p.ackSecret)
    .bytes(p.pseudonym).u32(p.provedAt).done();
const proofMessage = (unsigned: Uint8Array) => hash(concat(utf8('piu/v2/delivery-proof'), unsigned));

/**
 * Pseudônimo de prova de uma identidade para um validador: Ed25519 derivado da chave de assinatura da
 * identidade e da chave do validador. Outro validador, ou a outra identidade (pública/anônima) do
 * mesmo aparelho, dá outro pseudônimo; ninguém volta dele à identidade social.
 */
export function proofPseudonym(me: Identity, validatorPk: Uint8Array): KeyPair {
  const sk = kdf(me.sign.sk, validatorPk, 'piu/proof/pseudonym/v2');
  return { sk, pk: sign.publicKey(sk) };
}

/**
 * O destino assina a prova de um envelope que ele ACABOU de abrir (o chamador garante isso: só depois
 * de `openDirect` dar certo), com o pseudônimo para `validatorPk`. Confere de novo o segredo.
 */
export function makeDeliveryProof(envelope: Uint8Array, me: Identity, ackSecret: Uint8Array, now: number, validatorPk: Uint8Array): DeliveryProof {
  const header = authHeader(envelope);
  const h = parseAuthHeader(header);
  if (!equal(hash(ackSecret).slice(0, 16), h.ackHash)) throw new ProtocolError('ACK', 'Segredo não confere com o cabeçalho.');
  const ps = proofPseudonym(me, validatorPk);
  return signDeliveryProof({ envelopeId: envelopeId(envelope), header, ackSecret, pseudonym: ps.pk, provedAt: roundReceiptTime(now) }, ps);
}

/** Assina campos já montados (baixo nível: `makeDeliveryProof` é o caminho normal; testes usam para forjar). */
export function signDeliveryProof(p: Omit<DeliveryProof, 'sig'>, key: KeyPair): DeliveryProof {
  return { ...p, pseudonym: key.pk, sig: sign.sign(proofMessage(unsignedBytes({ ...p, pseudonym: key.pk })), key.sk) };
}

export const encodeDeliveryProof = (p: DeliveryProof) => concat(unsignedBytes(p), p.sig);

export function decodeDeliveryProof(b: Uint8Array): DeliveryProof {
  if (b.length !== DELIVERY_PROOF_BYTES) throw new ProtocolError('LENGTH', 'Prova de entrega com tamanho errado.');
  const r = new Reader(b);
  if (r.u8() !== PROOF_VERSION) throw new ProtocolError('VERSION', 'Versão de prova não suportada.');
  const envelopeId = toHex(r.bytes(16)), header = r.bytes(HEADER_BYTES), ackSecret = r.bytes(16);
  return { envelopeId, header, ackSecret, pseudonym: r.bytes(32), provedAt: r.u32(), sig: r.bytes(SIG_BYTES) };
}

/**
 * Confere a prova. Devolve o cabeçalho (com o `ackHash` do remetente) ou `null`:
 * cabeçalho v0 de mensagem DIRETA com saltos zerados, assinatura do pseudônimo do destino,
 * `H(ackSecret)[:16]` = `ackHash` do cabeçalho, e horário dentro da vida do envelope.
 */
export function verifyDeliveryProof(p: DeliveryProof, now: number): Header | null {
  let h: Header;
  try { h = parseAuthHeader(p.header); } catch { return null; }
  if (h.kind !== EnvelopeKind.Direct || p.header[HOP_OFFSET] !== 0) return null;
  if (p.ackSecret.length !== 16 || !equal(hash(p.ackSecret).slice(0, 16), h.ackHash)) return null;
  let unsigned: Uint8Array;
  try { unsigned = unsignedBytes(p); } catch { return null; }
  if (p.pseudonym.length !== 32 || !sign.verify(p.sig, proofMessage(unsigned), p.pseudonym)) return null;
  if (p.provedAt > now + CLOCK_SKEW_SEC) return null;
  if (p.provedAt > h.expiresAt + CLOCK_SKEW_SEC) return null;
  if (p.provedAt + MAX_TTL_SEC + 3600 + CLOCK_SKEW_SEC < h.expiresAt) return null;
  return h;
}

// ── selagem para o validador ─────────────────────────────────

/** Par X25519 do validador para abrir provas seladas (semente de 32 bytes, rótulo próprio). */
export function validatorProofKey(seed: Uint8Array): KeyPair {
  const sk = kdf(seed, utf8('piu/v2/validator'), 'proof/agree');
  return { sk, pk: agree.publicKey(sk) };
}

const sealAd = (id: string, validatorPk: Uint8Array) => concat(utf8('piu/v2/sealed-proof'), idBytes(id), validatorPk);
const sealKey = (shared: Uint8Array, ephPk: Uint8Array, validatorPk: Uint8Array) => kdf(shared, concat(ephPk, validatorPk), 'piu/v2/proof/seal');

/** Cifra a prova para o validador (chave efêmera por prova). */
export function sealDeliveryProof(p: DeliveryProof, validatorPk: Uint8Array): Uint8Array {
  const ephSk = random(KEY_BYTES), ephPk = agree.publicKey(ephSk), nonce = random(NONCE_BYTES);
  const key = sealKey(agree.shared(ephSk, validatorPk), ephPk, validatorPk);
  return concat(Uint8Array.of(PROOF_VERSION), ephPk, nonce, aead.seal(key, nonce, encodeDeliveryProof(p), sealAd(p.envelopeId, validatorPk)));
}

/** Abre uma prova selada. `null` se não for para esta chave, estiver adulterada ou o id não bater. */
export function openSealedProof(sealed: Uint8Array, envelopeId: string, validator: KeyPair): DeliveryProof | null {
  try {
    if (sealed.length !== SEALED_PROOF_BYTES || sealed[0] !== PROOF_VERSION) return null;
    const r = new Reader(sealed);
    r.u8();
    const ephPk = r.bytes(KEY_BYTES), nonce = r.bytes(NONCE_BYTES), ct = r.bytes(r.remaining);
    const key = sealKey(agree.shared(validator.sk, ephPk), ephPk, validator.pk);
    const plain = aead.open(key, nonce, ct, sealAd(envelopeId, validator.pk));
    if (!plain) return null;
    const p = decodeDeliveryProof(plain);
    return p.envelopeId === envelopeId ? p : null;
  } catch {
    return null;
  }
}

// ── quadro "P2" da malha (aparelho ↔ aparelho) ───────────────

/** "P2". Não é "PR" (provas v1) nem "PN" (presença), e envelopes começam com a versão 0. */
export const PROOF_V2_MAGIC = [0x50, 0x32] as const;
export const MAX_PROOFS_PER_FRAME = 8;
const ITEM = 16 + SEALED_PROOF_BYTES;

export interface SealedProofItem { envelopeId: string; sealed: Uint8Array }

export const isProofV2Frame = (b: Uint8Array) => b.length >= 3 && b[0] === PROOF_V2_MAGIC[0] && b[1] === PROOF_V2_MAGIC[1];

export function encodeProofV2Frame(items: SealedProofItem[]): Uint8Array {
  if (items.length < 1 || items.length > MAX_PROOFS_PER_FRAME) throw new ProtocolError('MALFORMED', 'Quantidade de provas inválida.');
  const w = new Writer().u8(PROOF_V2_MAGIC[0]).u8(PROOF_V2_MAGIC[1]).u8(items.length);
  for (const it of items) {
    if (it.sealed.length !== SEALED_PROOF_BYTES) throw new ProtocolError('LENGTH', 'Prova selada com tamanho errado.');
    w.bytes(idBytes(it.envelopeId)).bytes(it.sealed);
  }
  return w.done();
}

/** `null` se malformado (tamanho não bate, zero ou provas demais). */
export function decodeProofV2Frame(b: Uint8Array): SealedProofItem[] | null {
  if (!isProofV2Frame(b)) return null;
  const n = b[2] ?? 0;
  if (n < 1 || n > MAX_PROOFS_PER_FRAME || b.length !== 3 + n * ITEM) return null;
  const out: SealedProofItem[] = [];
  for (let i = 0; i < n; i++) {
    const o = 3 + i * ITEM;
    out.push({ envelopeId: toHex(b.subarray(o, o + 16)), sealed: b.slice(o + 16, o + ITEM) });
  }
  return out;
}
