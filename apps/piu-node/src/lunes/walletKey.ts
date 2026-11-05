// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/lib/walletKey.ts. Não edite aqui.
/**
 * Chave da carteira LUNES (etapa 1 de docs/carteira/proposta-carteira-propria.md).
 *
 * Mesma frase de 12 palavras do Piu, árvore de chaves independente das identidades:
 *   mini-secret = PBKDF2-HMAC-SHA512(entropia BIP39, "mnemonic" ‖ senha, 2048)[0..32]  (substrate-bip39)
 *   segredo sr25519 = secretFromSeed(mini)  →  chave pública  →  SS58 prefixo 57 (Lunes).
 * É exatamente o que Polkadot.js, SubWallet e Talisman fazem com a mesma frase, então a conta pode ser
 * importada em outra carteira. A identidade do Piu usa HKDF com rótulo próprio (protocol/phrase.ts):
 * KDFs diferentes, chaves criptograficamente independentes.
 *
 * Segurança: nada aqui é guardado em disco. O chamador deriva a chave só na hora de assinar e zera o
 * segredo depois — `withWalletKey` faz as duas coisas. `@scure/sr25519` é JS puro (sem WebAssembly),
 * roda no Hermes; é autoauditado, não auditado por terceiros (risco declarado no estudo), por isso os
 * vetores cruzados com @polkadot/util-crypto em __tests__/walletFixture.ts.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as sr from '@scure/sr25519';
import { isValidPhrase } from '../protocol/phrase.js';
import { encodeSs58, LUNES_SS58_PREFIX } from './ss58.js';

export interface WalletKey {
  /** Segredo sr25519 expandido (64 bytes: escalar ‖ nonce). Zerar com `wipe` após o uso. */
  secret: Uint8Array;
  publicKey: Uint8Array;
  /** Endereço SS58 no prefixo 57 (Lunes). */
  address: string;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const normalize = (words: string[]) => words.map(w => w.trim().toLowerCase()).filter(Boolean);

/** Zera buffers sensíveis (segredos, sementes) depois do uso. */
export function wipe(...buffers: Uint8Array[]) { for (const b of buffers) b.fill(0); }

/**
 * Mini-secret de 32 bytes no padrão substrate-bip39 (igual ao `mnemonicToMiniSecret` do @polkadot).
 * ~2048 iterações de HMAC-SHA512: alguns milissegundos no aparelho; derivar só quando precisar.
 */
export function miniSecretFromPhrase(words: string[], password = ''): Uint8Array {
  const w = normalize(words);
  if (!isValidPhrase(w)) throw new Error('Frase inválida.');
  const entropy = mnemonicToEntropy(w.join(' '), wordlist);
  const seed = pbkdf2(sha512, entropy, utf8('mnemonic' + password), { c: 2048, dkLen: 64 });
  wipe(entropy);
  const mini = seed.slice(0, 32);
  wipe(seed);
  return mini;
}

function keyFromSecret(secret: Uint8Array, prefix: number): WalletKey {
  const publicKey = sr.getPublicKey(secret);
  return { secret, publicKey, address: encodeSs58(publicKey, prefix) };
}

/** Chave sr25519 da carteira. O chamador é responsável por `wipe(key.secret)` (ou use `withWalletKey`). */
export function walletKeyFromPhrase(words: string[], prefix: number = LUNES_SS58_PREFIX): WalletKey {
  const mini = miniSecretFromPhrase(words);
  const secret = sr.secretFromSeed(mini);
  wipe(mini);
  return keyFromSecret(secret, prefix);
}

/** Só o endereço (para mostrar/QR): deriva, lê a pública e zera o segredo na hora. */
export function walletAddressFromPhrase(words: string[], prefix: number = LUNES_SS58_PREFIX): string {
  return withWalletKey(words, k => encodeSs58(k.publicKey, prefix));
}

/**
 * Deriva a chave, entrega ao `fn` e zera o segredo ao terminar — também quando `fn` lança ou devolve
 * uma Promise (zera depois que ela resolve ou rejeita).
 */
export function withWalletKey<T>(words: string[], fn: (key: WalletKey) => T): T {
  const key = walletKeyFromPhrase(words);
  let result: T;
  try { result = fn(key); } catch (e) { wipe(key.secret); throw e; }
  if (result instanceof Promise) return result.finally(() => wipe(key.secret)) as T;
  wipe(key.secret);
  return result;
}

/** Assina com sr25519 (contexto "substrate", o mesmo do Polkadot.js). `random` fixo só em testes. */
export const signWithWalletKey = (key: Pick<WalletKey, 'secret'>, message: Uint8Array, random?: Uint8Array) => sr.sign(key.secret, message, random);
export const verifyWalletSignature = (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => sr.verify(message, signature, publicKey);

/**
 * Derivação dura `//rótulo` (DeriveJunction do Substrate): chain code = SCALE(rótulo) preenchido com
 * zeros até 32 bytes, ou blake2b-256 disso se passar de 32. Não é usada na carteira (opção (a) do
 * estudo); fica para o vetor `//Alice` e para uma eventual opção (c).
 */
export function deriveHard(secret: Uint8Array, label: string, prefix: number = LUNES_SS58_PREFIX): WalletKey {
  const bytes = utf8(label);
  if (bytes.length > 63) throw new Error('Rótulo longo demais.');
  const scale = new Uint8Array(1 + bytes.length);
  scale[0] = bytes.length << 2; // compact(len) para len < 64
  scale.set(bytes, 1);
  let chainCode: Uint8Array;
  if (scale.length > 32) chainCode = blake2b(scale, { dkLen: 32 });
  else { chainCode = new Uint8Array(32); chainCode.set(scale); }
  return keyFromSecret(sr.HDKD.secretHard(secret, chainCode), prefix);
}
