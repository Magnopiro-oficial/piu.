/**
 * Suíte criptográfica do protótipo (v0).
 *
 * ATENÇÃO: o documento de requisitos (seção 9) determina que os algoritmos finais sejam escolhidos
 * numa etapa formal de threat modeling e revisão especializada. Esta suíte usa candidatos listados lá
 * (X25519, Ed25519, ChaCha20-Poly1305, HKDF) por meio das bibliotecas auditadas @noble/*, e cada
 * envelope declara o id da suíte, para que ela possa ser trocada sem quebrar a rede (agilidade
 * criptográfica). Não é uma decisão final e não deve ir para produção sem auditoria independente.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { utf8 } from './bytes';

/** Id da suíte no cabeçalho do envelope. 0 é reservado (inválido). */
export const SUITE_V0 = 1;
/** Suítes aceitas por este nó. Envelopes com outra suíte são recusados (proteção contra downgrade). */
export const ACCEPTED_SUITES: ReadonlySet<number> = new Set([SUITE_V0]);

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SIG_BYTES = 64;

export const random = (n: number) => randomBytes(n);
export const hash = (m: Uint8Array) => sha256(m);
export const hash512 = (m: Uint8Array) => sha512(m);

/** HKDF-SHA256 com rótulo de domínio (cada uso tem o seu, para nunca reutilizar chaves entre contextos). */
export const kdf = (ikm: Uint8Array, salt: Uint8Array | undefined, label: string, len = KEY_BYTES) =>
  hkdf(sha256, ikm, salt, utf8(label), len);

export const sign = {
  publicKey: (sk: Uint8Array) => ed25519.getPublicKey(sk),
  sign: (msg: Uint8Array, sk: Uint8Array) => ed25519.sign(msg, sk),
  verify: (sig: Uint8Array, msg: Uint8Array, pk: Uint8Array) => {
    try { return ed25519.verify(sig, msg, pk); } catch { return false; }
  },
};

/** Escalar fixo só para testar chaves públicas (o resultado é descartado; não protege nada). */
const PROBE_SK = new Uint8Array(KEY_BYTES).fill(1);

export const agree = {
  publicKey: (sk: Uint8Array) => x25519.getPublicKey(sk),
  /** Segredo compartilhado X25519; recusa pontos de ordem baixa (resultado todo zero). */
  shared: (sk: Uint8Array, pk: Uint8Array) => x25519.getSharedSecret(sk, pk),
  /** Chave pública utilizável: 32 bytes e fora dos pontos de ordem baixa (com eles, `shared` lança). */
  valid: (pk: Uint8Array) => {
    try { return pk.length === KEY_BYTES && x25519.getSharedSecret(PROBE_SK, pk).length === KEY_BYTES; } catch { return false; }
  },
};

/** AEAD XChaCha20-Poly1305 (nonce de 24 bytes, seguro para gerar aleatoriamente). */
export const aead = {
  seal: (key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, ad: Uint8Array) => xchacha20poly1305(key, nonce, ad).encrypt(plaintext),
  /** `null` se a autenticação falhar (dados adulterados ou chave errada). */
  open: (key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Uint8Array | null => {
    try { return xchacha20poly1305(key, nonce, ad).decrypt(ciphertext); } catch { return null; }
  },
};
