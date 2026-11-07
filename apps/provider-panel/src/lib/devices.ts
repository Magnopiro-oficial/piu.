import { t } from '../i18n';
import type { RelayNode } from '../types';
import { fmt, fmtDec, fmtInt } from './format';

/** Com piu-node, um equipamento com identidade técnica mostra o enlace real (online/offline); sem ela, só "Registrado". */
export const statusShort = (d: RelayNode) =>
  d.telemetry === 'none' && d.status === 'active' ? (d.link ? (d.link.online ? t('status.online') : t('status.offline')) : t('status.registered'))
  : d.status === 'active' ? t('status.active') : d.status === 'paused' ? t('status.paused') : t('status.warming');

/** Rótulos de exibição usados nas tabelas. Com piu-node, "hoje" é contagem de recibos (LUNES só depois da liquidação). */
export function deviceLabels(d: RelayNode) {
  if (d.telemetry === 'none') {
    // Resumo assinado pelo próprio equipamento: contadores desde que ele ligou (não são "por hora" nem "hoje").
    if (d.report) return { pph: '—', today: '—', stoPct: '0%', stoLabel: t('dev.fwdSinceOn', { n: fmtInt(d.report.forwarded) }) };
    return { pph: '—', today: '—', stoPct: '0%', stoLabel: d.passive ? t('dev.noStore') : t('dev.noDataHere') };
  }
  if (d.telemetry === 'live') {
    const n = d.receiptsToday ?? 0;
    return {
      pph: d.status === 'paused' ? '0' : fmtInt(d.pph), today: t('dev.receipts', { count: n }),
      stoPct: d.storage && d.storage[1] ? ((d.storage[0] / d.storage[1]) * 100).toFixed(0) + '%' : '0%',
      stoLabel: d.storage ? t('dev.stoOf', { used: fmtDec(d.storage[0]), total: fmtDec(d.storage[1]) }) : t('dev.relayOff'),
    };
  }
  return {
    pph: d.passive ? '—' : d.status === 'paused' ? '0' : d.pph ? fmtInt(d.pph) : '—',
    today: d.passive ? '—' : '+' + fmt(d.today),
    stoPct: d.storage ? ((d.storage[0] / d.storage[1]) * 100).toFixed(0) + '%' : '0%',
    stoLabel: d.storage ? t('dev.stoOf', { used: fmtDec(d.storage[0]), total: String(d.storage[1]) }) : t('dev.noStore'),
  };
}

export const parentName = (devices: RelayNode[], id?: string) => devices.find(x => x.id === id)?.name ?? t('dev.parentFallback');
