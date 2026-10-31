import type { RelayNode } from '../types';
import { fmt, fmtDec, fmtInt } from './format';

export const statusShort = (d: RelayNode) => (d.status === 'active' ? 'Ativo' : d.status === 'paused' ? 'Pausado' : 'Aquecendo');

/** Rótulos de exibição usados nas tabelas. */
export function deviceLabels(d: RelayNode) {
  return {
    pph: d.passive ? '—' : d.status === 'paused' ? '0' : d.pph ? fmtInt(d.pph) : '—',
    today: d.passive ? '—' : '+' + fmt(d.today),
    stoPct: d.storage ? ((d.storage[0] / d.storage[1]) * 100).toFixed(0) + '%' : '0%',
    stoLabel: d.storage ? `${fmtDec(d.storage[0])} de ${d.storage[1]} GB` : 'não guarda mensagens',
  };
}

export const parentName = (devices: RelayNode[], id?: string) => devices.find(x => x.id === id)?.name ?? 'nó pai';
