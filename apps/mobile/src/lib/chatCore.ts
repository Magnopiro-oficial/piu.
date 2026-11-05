/**
 * Conversa (TypeScript puro, testado): separadores de data e resumo de uma mensagem para listas,
 * banners e a folha de rota.
 */
import type { Msg } from '../data/types';
import { fmtDate, t as tGlobal, type Key, type Vars } from '../i18n/core';
import { formatCoords } from './locationCore';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

/** Dia local (ano, mês, dia) como número comparável. */
const dayKey = (ms: number) => { const d = new Date(ms); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };

/** "Hoje", "Ontem", "12 de março" (do ano corrente) ou "12 de março de 2025". Hora local do aparelho. */
export function dayLabel(at: number, now: number = Date.now(), t: Tr = tGlobal): string {
  const k = dayKey(at);
  if (k === dayKey(now)) return t('day.today');
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (k === dayKey(y.getTime())) return t('day.yesterday');
  const d = new Date(at);
  return d.getFullYear() === new Date(now).getFullYear() ? fmtDate(d, { day: 'numeric', month: 'long' }) : fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Para cada mensagem, o rótulo do separador de data que vem antes dela (ou `null`). Agrupa por
 * `msg.at`; mensagem sem data (avisos antigos) fica no dia da anterior e não abre grupo novo.
 */
export function daySeparators(msgs: Pick<Msg, 'at'>[], now: number = Date.now(), t: Tr = tGlobal): (string | null)[] {
  let cur: number | null = null;
  return msgs.map(m => {
    if (m.at == null) return null;
    const k = dayKey(m.at);
    if (k === cur) return null;
    cur = k;
    return dayLabel(m.at, now, t);
  });
}

/** Texto curto de uma mensagem (lista de conversas, banners, folha de rota). */
export function msgSummary(m: Pick<Msg, 'text' | 'file' | 'loc'>, t: Tr = tGlobal): string {
  if (m.loc) return t('msg.location', { text: m.text ? m.text : formatCoords(m.loc) });
  if (m.text) return m.text;
  if (m.file) return m.file.purged ? t('msg.mediaPurged', { name: m.file.name }) : t('msg.file', { name: m.file.name });
  return '';
}
