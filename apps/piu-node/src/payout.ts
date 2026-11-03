/**
 * Carteira do lote e evidências para o validador (proposta econômica, seção 7;
 * apps/settlement/src/validator.ts).
 *
 * - Época = semana ISO em UTC (`AAAA-Snn`), igual a `epochOf` do validador.
 * - Endereço LUNES no formato SS58 (prefixo 42, o que o explorador mostra, ou 57, o do chain spec).
 *   Conferido por inteiro sem dependência pesada: base58, prefixo, 32 bytes de chave e os 2 bytes
 *   de soma de verificação (BLAKE2b-512 de "SS58PRE" ‖ prefixo ‖ chave), como o `decodeAddress` do
 *   @polkadot/util-crypto que o validador usa.
 */
import { blake2b } from '@noble/hashes/blake2.js';

const WEEK = 7 * 86400;

/** Semana ISO em UTC, `AAAA-Snn` (mesma conta do validador). */
export function epochOf(sec: number): string {
  const d = new Date(sec * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

/** A época de agora e a seguinte (as que o operador pode declarar). */
export const claimableEpochs = (nowMs: number) => {
  const sec = Math.floor(nowMs / 1000);
  return [epochOf(sec), epochOf(sec + WEEK)];
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array | null {
  if (!s || s.length > 64) return null;
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

export const SS58_PREFIXES = [42, 57] as const;

/** Endereço SS58 válido (prefixo 42 ou 57, chave de 32 bytes, soma de verificação certa)? */
export function isLunesAddress(a: string): boolean {
  const b = base58Decode(a.trim());
  if (!b || b.length !== 35) return false;
  const prefix = b[0]!;
  if (!(SS58_PREFIXES as readonly number[]).includes(prefix)) return false;
  const body = b.subarray(0, 33);
  const sum = blake2b(Uint8Array.from([...new TextEncoder().encode('SS58PRE'), ...body]), { dkLen: 64 });
  return sum[0] === b[33] && sum[1] === b[34];
}
