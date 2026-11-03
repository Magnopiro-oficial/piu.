/**
 * Endereços SS58 (formato de conta do Substrate), em TypeScript puro.
 *
 * Endereço = base58( prefixo ‖ chave pública de 32 bytes ‖ soma de 2 bytes ), com a soma = os 2
 * primeiros bytes de BLAKE2b-512("SS58PRE" ‖ prefixo ‖ chave). Igual ao `decodeAddress` do
 * @polkadot/util-crypto, sem a biblioteca (pesada para o React Native).
 *
 * Lunes Mainnet: o chain spec declara o prefixo 57; o runtime e o explorador mostram 42 (endereços
 * que começam com "5"). Os dois são a mesma conta (a mesma chave) e os dois são aceitos.
 * Sem react-native: roda no app, no piu-node (cópia gerada) e nos testes.
 */
import { blake2b } from '@noble/hashes/blake2.js';

/** Prefixo da Lunes Mainnet (chain spec). */
export const LUNES_SS58_PREFIX = 57;
/** Prefixos aceitos na leitura: 57 (Lunes) e 42 (genérico do Substrate, o que o explorador mostra). */
export const LUNES_SS58_ACCEPTED = [57, 42] as const;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PRE = new TextEncoder().encode('SS58PRE');

export function base58Decode(s: string): Uint8Array | null {
  if (!s || s.length > 128) return null;
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x !== 0) break; s = '1' + s; }
  return s;
}

const checksum = (body: Uint8Array) => {
  const m = new Uint8Array(PRE.length + body.length);
  m.set(PRE); m.set(body, PRE.length);
  return blake2b(m, { dkLen: 64 }).subarray(0, 2);
};

export type Ss58Result =
  | { ok: true; prefix: number; publicKey: Uint8Array }
  | { ok: false; error: string };

/**
 * Decodifica e confere um endereço. Só contas de 32 bytes (sr25519/ed25519) com prefixo de 1 byte
 * (0 a 63), que é o caso da Lunes. `accept`: prefixos permitidos (padrão: 57 e 42).
 */
export function decodeSs58(address: string, accept: readonly number[] = LUNES_SS58_ACCEPTED): Ss58Result {
  const a = address.trim();
  if (!a) return { ok: false, error: 'Informe o endereço.' };
  const b = base58Decode(a);
  if (!b) return { ok: false, error: 'O endereço tem caracteres que não existem no formato SS58 (0, O, I e l não são usados).' };
  if (b.length !== 35) return { ok: false, error: 'Endereço com tamanho errado. Confira se copiou inteiro.' };
  const prefix = b[0]!;
  if (prefix > 63) return { ok: false, error: 'Formato de endereço não suportado.' };
  const sum = checksum(b.subarray(0, 33));
  if (sum[0] !== b[33] || sum[1] !== b[34]) return { ok: false, error: 'A soma de verificação do endereço não confere. Confira se copiou inteiro, sem trocar letras.' };
  if (!accept.includes(prefix)) return { ok: false, error: `Este endereço é de outra rede (prefixo ${prefix}). Use um endereço da Lunes.` };
  return { ok: true, prefix, publicKey: b.slice(1, 33) };
}

export const isLunesAddress = (address: string) => decodeSs58(address).ok;

/** Codifica uma chave pública de 32 bytes como endereço SS58 (padrão: prefixo 57 da Lunes). */
export function encodeSs58(publicKey: Uint8Array, prefix = LUNES_SS58_PREFIX): string {
  if (publicKey.length !== 32) throw new Error('A chave pública precisa ter 32 bytes.');
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 63) throw new Error('Prefixo SS58 fora do intervalo 0–63.');
  const body = new Uint8Array(33);
  body[0] = prefix; body.set(publicKey, 1);
  const out = new Uint8Array(35);
  out.set(body); out.set(checksum(body), 33);
  return base58Encode(out);
}
