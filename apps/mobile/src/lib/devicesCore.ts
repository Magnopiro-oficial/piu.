/**
 * Aparelhos de uma identidade e aviso de revogação assinado. TypeScript puro (testado no Node).
 *
 * Cada aparelho tem uma chave própria (Ed25519, aleatória, nunca sai dele) que o identifica no
 * registro. Revogar um aparelho gera um `RevocationNotice` assinado pela chave da IDENTIDADE
 * (pública ou anônima, um aviso por identidade, para não ligar uma à outra): os contatos conferem a
 * assinatura com a chave que já conhecem e passam a recusar o aparelho revogado.
 *
 * Limite atual (ver README): no protocolo v0 todos os aparelhos derivam as mesmas chaves da frase,
 * então o aviso só tem efeito quando o protocolo passar a usar chaves por aparelho; até lá, quem
 * perdeu um aparelho deve também criar uma identidade nova (frase nova).
 */
import { b64url, unb64url } from '../messaging/card';
import { concat, toHex, utf8, Writer } from '../protocol/bytes';
import type { Identity, KeyPair } from '../protocol/keys';
import { hash, random, sign } from '../protocol/suite';

export type DevicePlatform = 'android' | 'ios' | 'web' | 'other';
/** this: este aparelho · paired: adicionado daqui (Adicionar aparelho) · origin: o aparelho de onde as chaves vieram. */
export type DeviceVia = 'this' | 'paired' | 'origin';
export type RevokeReason = 'lost' | 'disconnected';

export interface DeviceRecord {
  /** `dev:` + 16 hex do hash da chave do aparelho. */
  id: string;
  /** Chave pública do aparelho (base64url). */
  pk: string;
  name: string;
  platform: DevicePlatform;
  via: DeviceVia;
  /** Segundos. */
  addedAt: number;
  revokedAt?: number;
  revokeReason?: RevokeReason;
}

export const newDeviceKey = (): KeyPair => { const sk = random(32); return { sk, pk: sign.publicKey(sk) }; };

export const deviceIdOf = (pk: Uint8Array) => 'dev:' + toHex(hash(concat(utf8('piu/v0/device'), pk)).slice(0, 8));

/** Insere ou atualiza (pelo id), sem desfazer uma revogação. */
export function upsertDevice(list: DeviceRecord[], d: DeviceRecord): DeviceRecord[] {
  const cur = list.find(x => x.id === d.id);
  if (!cur) return [...list, d];
  return list.map(x => (x.id === d.id ? { ...x, ...d, revokedAt: x.revokedAt ?? d.revokedAt, revokeReason: x.revokeReason ?? d.revokeReason, via: x.via === 'this' ? 'this' : d.via } : x));
}

/** Marca como revogado. Este aparelho não pode ser revogado por ele mesmo. */
export function markRevoked(list: DeviceRecord[], id: string, reason: RevokeReason, at: number): DeviceRecord[] {
  return list.map(x => (x.id === id && x.via !== 'this' && !x.revokedAt ? { ...x, revokedAt: at, revokeReason: reason } : x));
}

// ── aviso de revogação ──────────────────────────────────────────

export const REVOCATION_VERSION = 1;

/** Aviso serializável (JSON) para distribuir aos contatos pelo protocolo. */
export interface RevocationNotice {
  t: 'piu/revoke-device';
  v: number;
  /** Chave de assinatura da identidade que revoga (base64url). */
  by: string;
  /** Aparelho revogado: id e chave pública (base64url). */
  device: string;
  devicePk: string;
  reason: RevokeReason;
  /** Segundos. */
  at: number;
  /** Ed25519 da identidade sobre `revocationMessage`. */
  sig: string;
}

const REASON_CODE: Record<RevokeReason, number> = { lost: 1, disconnected: 2 };

/** Bytes assinados: rótulo de domínio + todos os campos em ordem fixa. */
function revocationMessage(by: Uint8Array, devicePk: Uint8Array, reason: RevokeReason, at: number, v = REVOCATION_VERSION) {
  return new Writer().bytes(utf8('piu/v0/revoke-device')).u8(v).bytes(by).bytes(devicePk).u8(REASON_CODE[reason]).u32(at).done();
}

export function createRevocation(identity: Pick<Identity, 'sign'>, device: Pick<DeviceRecord, 'pk'>, reason: RevokeReason, at: number): RevocationNotice {
  const devicePk = unb64url(device.pk);
  if (devicePk.length !== 32) throw new Error('Chave do aparelho inválida.');
  const by = identity.sign.pk;
  const sig = sign.sign(revocationMessage(by, devicePk, reason, at), identity.sign.sk);
  return { t: 'piu/revoke-device', v: REVOCATION_VERSION, by: b64url(by), device: deviceIdOf(devicePk), devicePk: device.pk, reason, at, sig: b64url(sig) };
}

/**
 * Confere o aviso. `expectedBy`: a chave de assinatura que o contato já conhece para essa identidade
 * (sem ela, qualquer um poderia "revogar" aparelhos alheios com a própria chave).
 */
export function verifyRevocation(n: RevocationNotice, expectedBy?: Uint8Array): boolean {
  try {
    if (n.t !== 'piu/revoke-device' || n.v !== REVOCATION_VERSION || !(n.reason in REASON_CODE)) return false;
    if (!Number.isInteger(n.at) || n.at < 0 || n.at > 0xffffffff) return false;
    const by = unb64url(n.by), devicePk = unb64url(n.devicePk), sig = unb64url(n.sig);
    if (by.length !== 32 || devicePk.length !== 32 || sig.length !== 64) return false;
    if (expectedBy && b64url(expectedBy) !== n.by) return false;
    if (deviceIdOf(devicePk) !== n.device) return false;
    return sign.verify(sig, revocationMessage(by, devicePk, n.reason, n.at, n.v), by);
  } catch { return false; }
}

export const encodeRevocation = (n: RevocationNotice) => JSON.stringify(n);

/** Lê um aviso recebido. Lança erro se o formato for inválido; a assinatura é conferida por `verifyRevocation`. */
export function decodeRevocation(s: string): RevocationNotice {
  if (s.length > 4096) throw new Error('Aviso grande demais.');
  const o = JSON.parse(s);
  const fields = ['by', 'device', 'devicePk', 'reason', 'sig'] as const;
  if (!o || o.t !== 'piu/revoke-device' || typeof o.v !== 'number' || typeof o.at !== 'number' || fields.some(f => typeof o[f] !== 'string')) {
    throw new Error('Aviso de revogação inválido.');
  }
  return { t: o.t, v: o.v, by: o.by, device: o.device, devicePk: o.devicePk, reason: o.reason, at: o.at, sig: o.sig };
}
