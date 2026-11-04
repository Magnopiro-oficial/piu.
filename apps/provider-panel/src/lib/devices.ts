import type { RelayNode } from '../types';
import { fmt, fmtDec, fmtInt } from './format';

/** Com piu-node, um equipamento com identidade técnica mostra o enlace real (online/offline); sem ela, só "Registrado". */
export const statusShort = (d: RelayNode) =>
  d.telemetry === 'none' && d.status === 'active' ? (d.link ? (d.link.online ? 'Online' : 'Offline') : 'Registrado')
  : d.status === 'active' ? 'Ativo' : d.status === 'paused' ? 'Pausado' : 'Aquecendo';

/** Rótulos de exibição usados nas tabelas. Com piu-node, "hoje" é contagem de recibos (LUNES só depois da liquidação). */
export function deviceLabels(d: RelayNode) {
  if (d.telemetry === 'none') {
    // Resumo assinado pelo próprio equipamento: contadores desde que ele ligou (não são "por hora" nem "hoje").
    if (d.report) return { pph: '—', today: '—', stoPct: '0%', stoLabel: `${fmtInt(d.report.forwarded)} encaminhados desde que ligou` };
    return { pph: '—', today: '—', stoPct: '0%', stoLabel: d.passive ? 'não guarda mensagens' : 'sem dados neste nó' };
  }
  if (d.telemetry === 'live') {
    const n = d.receiptsToday ?? 0;
    return {
      pph: d.status === 'paused' ? '0' : fmtInt(d.pph), today: `${fmtInt(n)} ${n === 1 ? 'recibo' : 'recibos'}`,
      stoPct: d.storage && d.storage[1] ? ((d.storage[0] / d.storage[1]) * 100).toFixed(0) + '%' : '0%',
      stoLabel: d.storage ? `${fmtDec(d.storage[0])} de ${fmtDec(d.storage[1])} GB` : 'retransmissão desligada',
    };
  }
  return {
    pph: d.passive ? '—' : d.status === 'paused' ? '0' : d.pph ? fmtInt(d.pph) : '—',
    today: d.passive ? '—' : '+' + fmt(d.today),
    stoPct: d.storage ? ((d.storage[0] / d.storage[1]) * 100).toFixed(0) + '%' : '0%',
    stoLabel: d.storage ? `${fmtDec(d.storage[0])} de ${d.storage[1]} GB` : 'não guarda mensagens',
  };
}

export const parentName = (devices: RelayNode[], id?: string) => devices.find(x => x.id === id)?.name ?? 'nó pai';
