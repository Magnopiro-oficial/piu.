import type { Status } from '../data/types';
import type { IconName } from '../ui/Icon';

export const STATUS_ICON: Record<Status, IconName> = {
  criada: 'radio_button_unchecked', aguardando: 'schedule', encaminhada: 'check', entregue: 'done_all', expirada: 'timer_off', falha: 'error',
};
export const STATUS_LABEL: Record<Status, string> = {
  criada: 'criada', aguardando: 'na fila', encaminhada: 'encaminhada', entregue: 'entregue', expirada: 'expirada', falha: 'falha',
};
