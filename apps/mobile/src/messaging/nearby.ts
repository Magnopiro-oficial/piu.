/**
 * Por perto (design: Por perto, perfil, convite e pedidos; ECO §5): anúncio de presença assinado
 * pela identidade PÚBLICA. A anônima nunca entra aqui.
 *
 * - O anúncio só sai enquanto a pessoa está visível. Vale poucos minutos (`PRESENCE_TTL_SEC`) e nunca
 *   passa do fim da visibilidade de 1 h. Ao ficar invisível, sai um anúncio de retirada, e quem o
 *   recebe apaga o perfil na hora. Sem anúncio novo, o perfil some sozinho quando o prazo acaba.
 * - O anúncio anda poucos saltos (`PRESENCE_HOPS`). Os saltos andados dão a proximidade sem
 *   localização: direto = "muito perto", 1 salto = "perto", 2 saltos = "mais longe".
 * - Leva o nome do perfil público, a taxa do convite (definida por quem recebe) e, uma vez por
 *   vizinho, a foto pequena do perfil público. A assinatura cobre o hash da foto.
 *
 * Formato do quadro: "PN" + JSON. Não é um envelope do roteador: é público de propósito (é o perfil
 * que a pessoa escolheu mostrar), e por isso não passa pela fila nem gera crédito.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, fromUtf8, toHex, utf8 } from '../protocol/bytes';
import { identityId, type Identity, type PublicIdentity, verifyBinding } from '../protocol/keys';
import { sign } from '../protocol/suite';
import { stripBidi } from './bidi';
import { b64url, unb64url } from './card';
import { isJpegBase64 } from './photo';

export const PRESENCE_MAGIC = [0x50, 0x4e]; // "PN"
/** Validade de um anúncio (s): sem anúncio novo, o perfil some em até 3 min. */
export const PRESENCE_TTL_SEC = 180;
/** Anúncio novo a cada minuto enquanto visível. */
export const PRESENCE_EVERY_SEC = 60;
/** Saltos além do vizinho direto (0 = direto, 1 = perto, 2 = mais longe). */
export const PRESENCE_HOPS = 2;
/** Taxas aceitas (design `feeOpts`; ECO §5). */
export const NEAR_FEES = [1, 3, 5, 10] as const;
/** Convite pago: até 140 caracteres; vale 24 h; nova tentativa para a mesma pessoa só em 30 dias. */
export const NEAR_INVITE_MAX = 140;
export const NEAR_INVITE_TTL_SEC = 24 * 3600;
export const NEAR_COOLDOWN_SEC = 30 * 86400;
const MAX_FRAME = 40 * 1024;
const MAX_NAME = 40;
const SKEW_SEC = 120;
const DOMAIN = utf8('piu/v0/nearby');

export type NearProx = 'muito perto' | 'perto' | 'mais longe';
export const proxOf = (traveled: number): NearProx => (traveled <= 0 ? 'muito perto' : traveled === 1 ? 'perto' : 'mais longe');

/** Anúncio conferido. `until` <= `at` é uma retirada (ficou invisível). */
export interface Presence {
  id: string; pub: PublicIdentity; name: string; fee: number;
  /** Hash (hex, 16) da foto anunciada; vazio sem foto. */
  photoHash: string; photo?: string;
  at: number; until: number;
  /** Saltos que ainda pode andar. */
  hops: number;
}

const photoHash = (p: string | null | undefined) => (p ? toHex(sha256(utf8(p))).slice(0, 16) : '');
const signedPart = (j: { s: string; a: string; b: string; n: string; f: number; ph: string; t: number; x: number }) =>
  concat(DOMAIN, utf8(JSON.stringify([1, j.s, j.a, j.b, j.n, j.f, j.ph, j.t, j.x])));

/** Monta o anúncio assinado. `until` <= `now` = retirada. `withPhoto`: manda a foto junto (uma vez por vizinho). */
export function makePresence(me: Identity, o: { name: string; fee: number; photo?: string | null; now: number; until: number; withPhoto: boolean }) {
  if (me.kind !== 'public') throw new Error('Por perto usa só a identidade pública.');
  const photo = o.photo && isJpegBase64(o.photo) ? o.photo : '';
  const body = {
    s: b64url(me.signPk), a: b64url(me.agreePk), b: b64url(me.binding), n: [...o.name.trim()].slice(0, MAX_NAME).join(''),
    f: o.fee, ph: photoHash(photo), t: o.now, x: Math.min(o.until, o.now + PRESENCE_TTL_SEC),
  };
  const sig = b64url(sign.sign(signedPart(body), me.sign.sk));
  return { ...body, sig, photo: photo || undefined };
}
export type PresenceBody = ReturnType<typeof makePresence>;

/** Quadro para o transporte, com os saltos restantes (fora da assinatura). */
export function encodePresence(p: PresenceBody, hops: number, withPhoto: boolean): Uint8Array {
  const { photo, ...rest } = p;
  const j = { ...rest, h: hops, ...(withPhoto && photo ? { p: photo } : {}) };
  return concat(Uint8Array.from(PRESENCE_MAGIC), utf8(JSON.stringify(j)));
}

export const isPresenceFrame = (b: Uint8Array) => b.length > 2 && b[0] === PRESENCE_MAGIC[0] && b[1] === PRESENCE_MAGIC[1];

/** Lê e confere (assinatura, vínculo, id, prazo, taxa, foto). `null` se algo não bate. */
export function decodePresence(b: Uint8Array, now: number): (Presence & { body: PresenceBody }) | null {
  if (!isPresenceFrame(b) || b.length > MAX_FRAME) return null;
  try {
    const j = JSON.parse(fromUtf8(b.subarray(2))) as Record<string, unknown>;
    const { s, a, b: bd, n, f, ph, t, x, sig, h, p } = j as { s: string; a: string; b: string; n: string; f: number; ph: string; t: number; x: number; sig: string; h: number; p?: string };
    if (typeof s !== 'string' || typeof a !== 'string' || typeof bd !== 'string' || typeof n !== 'string' || typeof sig !== 'string' || typeof ph !== 'string') return null;
    if (!Number.isInteger(t) || !Number.isInteger(x) || !Number.isInteger(h) || h < 0 || h > PRESENCE_HOPS) return null;
    if (!(NEAR_FEES as readonly number[]).includes(f) || [...n].length > MAX_NAME) return null;
    if (t > now + SKEW_SEC || x - t > PRESENCE_TTL_SEC || now - t > PRESENCE_TTL_SEC) return null;
    const pub = { signPk: unb64url(s), agreePk: unb64url(a), binding: unb64url(bd) };
    if (!verifyBinding(pub)) return null;
    const body = { s, a, b: bd, n, f, ph, t, x };
    if (!sign.verify(unb64url(sig), signedPart(body), pub.signPk)) return null;
    let photo: string | undefined;
    if (p !== undefined) { if (!isJpegBase64(p) || photoHash(p) !== ph) return null; photo = p; }
    // `body` segue intacto (é o que se repassa, com a assinatura); só o nome exibido perde os controles bidi.
    return { id: identityId(pub.signPk, pub.agreePk), pub, name: stripBidi(n), fee: f, photoHash: ph, photo, at: t, until: x, hops: h, body: { ...body, sig, photo } };
  } catch { return null; }
}
