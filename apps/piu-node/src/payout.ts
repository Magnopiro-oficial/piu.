/**
 * Carteira do lote e evidências para o validador (proposta econômica, seção 7;
 * apps/settlement/src/validator.ts).
 *
 * - Época = semana ISO em UTC (`AAAA-Snn`), igual a `epochOf` do validador.
 * - Endereço LUNES no formato SS58 (prefixo 42, o que o explorador mostra, ou 57, o do chain spec).
 *   Conferido por inteiro sem dependência pesada (src/lunes/ss58.ts, o mesmo do app): base58, prefixo,
 *   32 bytes de chave e os 2 bytes de soma de verificação, como o `decodeAddress` do
 *   @polkadot/util-crypto que o validador usa.
 */
import { decodeSs58 } from './lunes/ss58.js';

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

export const SS58_PREFIXES = [42, 57] as const;

/** Endereço SS58 válido (prefixo 42 ou 57, chave de 32 bytes, soma de verificação certa)? */
export const isLunesAddress = (a: string): boolean => decodeSs58(a, SS58_PREFIXES).ok;
