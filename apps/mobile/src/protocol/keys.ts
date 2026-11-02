/**
 * Hierarquia de chaves: tudo deriva de uma semente de 32 bytes, com um rótulo de domínio por finalidade.
 * Regras do documento (seção 9): identidade pública e anônima não compartilham chaves nem
 * identificadores; identidade do nó, identidade social e carteira também são separadas.
 * Cada identidade tem um par de assinatura (Ed25519) e um par de acordo de chaves (X25519) distintos.
 */
import { concat, toHex, utf8 } from './bytes';
import { agree, hash, kdf, random, sign } from './suite';

export type IdentityKind = 'public' | 'anon';

export interface KeyPair { sk: Uint8Array; pk: Uint8Array }

/** Parte pública de uma identidade: o que se troca com contatos (QR, código de segurança). */
export interface PublicIdentity {
  signPk: Uint8Array;
  agreePk: Uint8Array;
  /** Assinatura do `agreePk` pela chave de assinatura: liga as duas chaves à mesma identidade. */
  binding: Uint8Array;
}

export interface Identity extends PublicIdentity {
  kind: IdentityKind;
  sign: KeyPair;
  agree: KeyPair;
  /** Identificador exibido (`piu:7f3a…c19e`): hash das duas chaves públicas. */
  id: string;
}

const ROOT_SALT = utf8('piu/v0/root');

export const newSeed = () => random(32);

function pair(seed: Uint8Array, label: string, kind: 'sign' | 'agree'): KeyPair {
  const sk = kdf(seed, ROOT_SALT, label);
  return { sk, pk: kind === 'sign' ? sign.publicKey(sk) : agree.publicKey(sk) };
}

const bindingMessage = (agreePk: Uint8Array) => concat(utf8('piu/v0/binding'), agreePk);

export const identityId = (signPk: Uint8Array, agreePk: Uint8Array) => 'piu:' + toHex(hash(concat(signPk, agreePk)).slice(0, 16));

/** Identidade social (pública ou anônima). `index` permite várias identidades do mesmo tipo. */
export function deriveIdentity(seed: Uint8Array, kind: IdentityKind, index = 0): Identity {
  const s = pair(seed, `identity/${kind}/${index}/sign`, 'sign');
  const a = pair(seed, `identity/${kind}/${index}/agree`, 'agree');
  return { kind, sign: s, agree: a, signPk: s.pk, agreePk: a.pk, binding: sign.sign(bindingMessage(a.pk), s.sk), id: identityId(s.pk, a.pk) };
}

/** Identidade técnica do nó (assina recibos de retransmissão). Nunca usada para conversar. */
export const deriveNodeKey = (seed: Uint8Array, index = 0): KeyPair => pair(seed, `node/${index}/sign`, 'sign');

/** Semente da carteira LUNES: separada de tudo o que é social ou de rede. */
export const deriveWalletSeed = (seed: Uint8Array) => kdf(seed, ROOT_SALT, 'wallet/0/seed');

export const toPublic = (i: Identity): PublicIdentity => ({ signPk: i.signPk, agreePk: i.agreePk, binding: i.binding });

/** Confere se a chave de acordo pertence mesmo à chave de assinatura (evita troca de chave por terceiros). */
export const verifyBinding = (p: PublicIdentity) => sign.verify(p.binding, bindingMessage(p.agreePk), p.signPk);
