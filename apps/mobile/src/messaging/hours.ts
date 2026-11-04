/**
 * Horário do Modo nó (Ajustes → Bateria e limites → Horário): Sempre, 22h–7h ou uma faixa
 * Personalizada escolhida pela pessoa. TypeScript puro, testado no Node.
 *
 * - A faixa vai de `start` a `end`, em minutos desde 00:00, de 30 em 30 min. `start > end` atravessa
 *   a meia-noite (ex.: 22:00–07:00). `start === end` é uma faixa vazia: inválida.
 * - `days` (opcional): dias da semana em que a faixa COMEÇA (0 = domingo … 6 = sábado). Numa faixa que
 *   atravessa a meia-noite, a madrugada pertence ao dia em que começou (22:00–07:00 só na sexta vale de
 *   sexta 22:00 a sábado 07:00). Ausente: todos os dias.
 */

export interface HoursWindow { start: number; end: number; days?: number[] }
export type HoursPolicy = 'always' | 'night' | HoursWindow;

export const DAY_MIN = 24 * 60;
/** Passo do seletor (minutos). */
export const HOURS_STEP = 30;
/** 22:00–07:00, a opção "22h–7h". */
export const NIGHT_WINDOW: HoursWindow = { start: 22 * 60, end: 7 * 60 };

const okMin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < DAY_MIN && v % HOURS_STEP === 0;

/** Confere a faixa (lida do disco ou montada na tela). `null` se vazia ou inválida. */
export function validWindow(w: unknown): HoursWindow | null {
  if (!w || typeof w !== 'object') return null;
  const x = w as Record<string, unknown>;
  if (!okMin(x.start) || !okMin(x.end) || x.start === x.end) return null;
  if (x.days === undefined) return { start: x.start, end: x.end };
  if (!Array.isArray(x.days)) return null;
  const days = [...new Set(x.days)].filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length || days.length !== x.days.length) return null;
  return days.length === 7 ? { start: x.start, end: x.end } : { start: x.start, end: x.end, days };
}

/** Momento local: dia da semana (0 = domingo) e minutos desde 00:00. */
export interface LocalTime { weekday: number; minutes: number }
export const localTime = (d: Date): LocalTime => ({ weekday: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() });

/** O momento está dentro da faixa? Faixa inválida ou vazia: nunca. */
export function inWindow(now: LocalTime, janela: HoursWindow | null): boolean {
  const w = validWindow(janela);
  if (!w) return false;
  const m = now.minutes, day = now.weekday;
  const startsOn = (d: number) => !w.days || w.days.includes(((d % 7) + 7) % 7);
  if (w.start < w.end) return m >= w.start && m < w.end && startsOn(day);
  // Atravessa a meia-noite: do início até 24:00 no dia em que começa, e de 00:00 ao fim no dia seguinte.
  if (m >= w.start) return startsOn(day);
  if (m < w.end) return startsOn(day - 1);
  return false;
}

/** A política deixa retransmitir agora? */
export function hoursAllow(p: HoursPolicy, now: LocalTime): boolean {
  if (p === 'always') return true;
  return inWindow(now, p === 'night' ? NIGHT_WINDOW : p);
}

export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DAY_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const DAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "22:00–07:00" e, com dias escolhidos, "· seg, qua, sex". */
export function formatWindow(w: HoursWindow): string {
  const base = `${hm(w.start)}–${hm(w.end)}`;
  return w.days?.length && w.days.length < 7 ? `${base} · ${w.days.map(d => DAY_SHORT[d]).join(', ')}` : base;
}

export type HoursChoice = 'always' | 'night' | 'custom';

/**
 * Ajuste salvo → escolha válida. Versões antigas guardavam só 'custom' (sem faixa), que valia como
 * "Sempre": sem faixa válida, "Personalizado" migra para "Sempre".
 */
export function normHoursChoice(hours: unknown, custom: unknown): { hours: HoursChoice; custom?: HoursWindow } {
  const w = validWindow(custom);
  const h: HoursChoice = hours === 'night' ? 'night' : hours === 'custom' && w ? 'custom' : 'always';
  return w ? { hours: h, custom: w } : { hours: h };
}

/** Escolha da tela → política do mensageiro (`NodePolicy.hours`). */
export function policyHours(hours: unknown, custom: unknown): HoursPolicy {
  const n = normHoursChoice(hours, custom);
  return n.hours === 'custom' ? n.custom! : n.hours;
}

/** Texto da opção "Personalizado" (com a faixa, quando há). */
export const customLabel = (custom: unknown) => { const w = validWindow(custom); return w ? `Personalizado · ${formatWindow(w)}` : 'Personalizado'; };
