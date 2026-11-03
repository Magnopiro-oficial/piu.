import type { Status } from '../data/types';
import type { IconName } from '../ui/Icon';

export const STATUS_ICON: Record<Status, IconName> = {
  criada: 'radio_button_unchecked', aguardando: 'schedule', encaminhada: 'check', entregue: 'done_all', lida: 'done_all', expirada: 'timer_off', falha: 'error',
};
export const STATUS_LABEL: Record<Status, string> = {
  criada: 'criada', aguardando: 'na fila', encaminhada: 'encaminhada', entregue: 'entregue', lida: 'lida', expirada: 'expirada', falha: 'falha',
};

/** Ordem do avanço de uma mensagem enviada: um estado mais novo nunca volta para um anterior. */
const RANK: Partial<Record<Status, number>> = { criada: 0, aguardando: 1, encaminhada: 2, entregue: 3, lida: 4 };
export const isStatusBack = (from: Status | undefined, to: Status) => from !== undefined && RANK[from] !== undefined && RANK[to] !== undefined && RANK[to]! < RANK[from]! && RANK[from]! >= 3;

/** Prazo das mensagens temporárias, em segundos (`undefined` = desligado). */
export const tempSeconds = (t: 'off' | '7d' | '24h' | undefined) => (t === '24h' ? 86400 : t === '7d' ? 7 * 86400 : undefined);
