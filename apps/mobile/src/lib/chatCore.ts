/**
 * Conversa (TypeScript puro, testado): separadores de data e resumo de uma mensagem para listas,
 * banners e a folha de rota.
 */
import type { Msg } from '../data/types';
import { formatCoords } from './locationCore';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Dia local (ano, mês, dia) como número comparável. */
const dayKey = (ms: number) => { const d = new Date(ms); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };

/** "Hoje", "Ontem", "12 de março" (do ano corrente) ou "12 de março de 2025". Hora local do aparelho. */
export function dayLabel(at: number, now: number = Date.now()): string {
  const k = dayKey(at);
  if (k === dayKey(now)) return 'Hoje';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (k === dayKey(y.getTime())) return 'Ontem';
  const d = new Date(at);
  const base = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} de ${d.getFullYear()}`;
}

/**
 * Para cada mensagem, o rótulo do separador de data que vem antes dela (ou `null`). Agrupa por
 * `msg.at`; mensagem sem data (avisos antigos) fica no dia da anterior e não abre grupo novo.
 */
export function daySeparators(msgs: Pick<Msg, 'at'>[], now: number = Date.now()): (string | null)[] {
  let cur: number | null = null;
  return msgs.map(m => {
    if (m.at == null) return null;
    const k = dayKey(m.at);
    if (k === cur) return null;
    cur = k;
    return dayLabel(m.at, now);
  });
}

/** Texto curto de uma mensagem (lista de conversas, banners, folha de rota). */
export function msgSummary(m: Pick<Msg, 'text' | 'file' | 'loc'>): string {
  if (m.loc) return m.text ? `Localização: ${m.text}` : `Localização: ${formatCoords(m.loc)}`;
  if (m.text) return m.text;
  if (m.file) return m.file.purged ? `Mídia apagada: ${m.file.name}` : `Arquivo: ${m.file.name}`;
  return '';
}
