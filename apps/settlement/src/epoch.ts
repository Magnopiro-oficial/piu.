/** Épocas do validador: semana ISO em UTC (`AAAA-Snn`). */
export const WEEK = 7 * 86400;

/** Semana ISO em UTC, `AAAA-Snn`. */
export function epochOf(sec: number): string {
  const d = new Date(sec * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // quinta-feira da semana
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

/** Início (segunda 00:00 UTC) da época, em segundos. */
export function epochStart(label: string): number {
  const m = /^(\d{4})-S(\d{2})$/.exec(label);
  if (!m) throw new Error(`Época inválida: ${label} (use AAAA-Snn).`);
  const jan4 = Date.UTC(Number(m[1]), 0, 4) / 1000;
  const monday1 = jan4 - ((new Date(jan4 * 1000).getUTCDay() + 6) % 7) * 86400;
  const start = monday1 + (Number(m[2]) - 1) * WEEK;
  if (epochOf(start) !== label) throw new Error(`Época inexistente: ${label}.`);
  return start;
}
export const epochEnd = (label: string) => epochStart(label) + WEEK;
