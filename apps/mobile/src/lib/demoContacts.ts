import { sha256 } from '@noble/hashes/sha2.js';
import { deriveIdentity, type Identity, type IdentityKind, safetyNumber, toPublic } from '../protocol';

const cache = new Map<string, Identity>();

/**
 * DEMONSTRAÇÃO: os contatos de exemplo não têm aparelho de verdade. Para o código de segurança
 * ser calculado com o algoritmo real, cada um recebe chaves determinísticas a partir do id.
 * Contatos reais trazem as próprias chaves (QR ou primeira mensagem).
 */
export function demoContactIdentity(chatId: string, kind: IdentityKind): Identity {
  const k = `${chatId}:${kind}`;
  let i = cache.get(k);
  if (!i) { i = deriveIdentity(sha256(new TextEncoder().encode('piu-demo-contact:' + chatId)), kind); cache.set(k, i); }
  return i;
}

const codes = new Map<string, string[]>();

/** Código de segurança (hash iterado, ~25 ms): calculado uma vez por par de identidades e guardado. */
export function safetyCodeFor(me: Identity, chatId: string, kind: IdentityKind): string[] {
  const k = `${me.id}|${chatId}:${kind}`;
  let c = codes.get(k);
  if (!c) { c = safetyNumber(toPublic(me), toPublic(demoContactIdentity(chatId, kind))); codes.set(k, c); }
  return c;
}

/** Já calculado? (para mostrar na hora, sem esperar o efeito). */
export const cachedSafetyCode = (me: Identity, chatId: string, kind: IdentityKind) => codes.get(`${me.id}|${chatId}:${kind}`) ?? null;
