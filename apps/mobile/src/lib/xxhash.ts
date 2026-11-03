/**
 * xxHash64 (Yann Collet) e o `twox` do Substrate, em TypeScript puro com BigInt.
 *
 * O Substrate usa o xxHash64 nas chaves de armazenamento: `twox128(x)` = xxh64(x, semente 0) ‖
 * xxh64(x, semente 1), cada um em little endian. É o prefixo de todo item do estado (ex.: System.Account).
 * Entradas aqui são pequenas (nomes de módulo e de item), então BigInt basta e o código fica legível.
 * Sem react-native: roda no app, no piu-node (cópia gerada) e nos testes.
 */
const M = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & M;
const round = (acc: bigint, lane: bigint) => (rotl((acc + lane * P2) & M, 31n) * P1) & M;
const merge = (acc: bigint, v: bigint) => (((acc ^ round(0n, v)) * P1) + P4) & M;

function u64le(b: Uint8Array, o: number): bigint {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[o + i]!);
  return x;
}
const u32le = (b: Uint8Array, o: number) => BigInt((b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0);

/** xxHash64 de `data` com a semente dada (número de 64 bits sem sinal). */
export function xxh64(data: Uint8Array, seed = 0n): bigint {
  const len = data.length;
  let p = 0;
  let h: bigint;
  if (len >= 32) {
    let v1 = (seed + P1 + P2) & M, v2 = (seed + P2) & M, v3 = seed & M, v4 = (seed - P1) & M;
    for (; p + 32 <= len; p += 32) {
      v1 = round(v1, u64le(data, p));
      v2 = round(v2, u64le(data, p + 8));
      v3 = round(v3, u64le(data, p + 16));
      v4 = round(v4, u64le(data, p + 24));
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M;
    h = merge(h, v1); h = merge(h, v2); h = merge(h, v3); h = merge(h, v4);
  } else {
    h = (seed + P5) & M;
  }
  h = (h + BigInt(len)) & M;
  for (; p + 8 <= len; p += 8) h = ((rotl(h ^ round(0n, u64le(data, p)), 27n) * P1) + P4) & M;
  if (p + 4 <= len) { h = ((rotl(h ^ ((u32le(data, p) * P1) & M), 23n) * P2) + P3) & M; p += 4; }
  for (; p < len; p++) h = (rotl(h ^ ((BigInt(data[p]!) * P5) & M), 11n) * P1) & M;
  h ^= h >> 33n; h = (h * P2) & M;
  h ^= h >> 29n; h = (h * P3) & M;
  h ^= h >> 32n;
  return h;
}

/** `twox` do Substrate com `bits` = 64, 128 ou 256: xxh64 com sementes 0, 1, 2… em little endian. */
export function twox(data: Uint8Array | string, bits: 64 | 128 | 256 = 128): Uint8Array {
  const b = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const out = new Uint8Array(bits / 8);
  for (let s = 0; s < bits / 64; s++) {
    let h = xxh64(b, BigInt(s));
    for (let i = 0; i < 8; i++) { out[s * 8 + i] = Number(h & 0xffn); h >>= 8n; }
  }
  return out;
}

export const twox128 = (data: Uint8Array | string) => twox(data, 128);
