/**
 * Conversa (TypeScript puro, testado): separadores de data e resumo de uma mensagem para listas,
 * banners e a folha de rota.
 */
import type { Msg } from '../data/types';
import { fmtDate, t as tGlobal, type Key, type Vars } from '../i18n/core';
import { formatCoords } from './locationCore';
import { localizeStored } from './storedText';
import { contactOf, recordCard, type Tr as CallTr } from '../calls/callView';
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
export function msgSummary(m: Pick<Msg, 'text' | 'file' | 'loc' | 'call' | 'callReq'>, t: Tr = tGlobal): string {
  if (m.loc) return t('msg.location', { text: m.text ? m.text : formatCoords(m.loc) });
  // Chamada: o título gravado é do idioma da hora da ligação; refeito no idioma de agora.
  if (m.call) return recordCard(t as unknown as CallTr, m.call, contactOf('')).title;
  if (m.callReq) return t('call.rec.request');
  if (m.text) return localizeStored(m.text, t);
  if (m.file) return m.file.purged ? t('msg.mediaPurged', { name: m.file.name }) : t('msg.file', { name: m.file.name });
  return '';
}

/**
 * Horas até a mensagem mais antiga da fila expirar (o envelope vale `ttlSec`; design: "Expira em
 * 47 h"). Arredonda para cima, mínimo 1. Sem data em nenhuma mensagem: `null` (não se inventa prazo).
 */
export function queueHoursLeft(waiting: Pick<Msg, 'at'>[], now: number, ttlSec: number): number | null {
  const ats = waiting.map(m => m.at).filter((a): a is number => typeof a === 'number');
  if (!ats.length) return null;
  const left = Math.min(...ats) + ttlSec * 1000 - now;
  return Math.max(1, Math.ceil(left / 3600_000));
}
