/** Formatos puros da interface (sem React), testados em test/format.test.ts. */
import { fmtNumber } from '../shared/i18n';

/** Tamanho legível em base 1000 (como o Finder e o GNOME mostram espaço em disco), decimal do idioma e da região. */
export function fmtBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  const [v, u] = n < 1e6 ? [n / 1e3, 'kB'] : n < 1e9 ? [n / 1e6, 'MB'] : [n / 1e9, 'GB'];
  const d = v < 10 ? 1 : 0;
  return `${fmtNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d })} ${u}`;
}
