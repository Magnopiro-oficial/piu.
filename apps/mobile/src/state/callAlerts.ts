import { useSyncExternalStore } from 'react';
import { getCallAlerts } from '../core';

/**
 * Chamada fora do app no Android: o toque, os avisos e as ações das notificações são do núcleo
 * (core/callAlertRunner.ts), com ou sem tela. A tela só lê `locked` (variante da tela bloqueada) e
 * `shown` (chamada aberta pela notificação ou tocada com a tela bloqueada: fica em tela cheia); ao
 * reabrir, já vem o que estiver em curso.
 */
export function useCallAlerts(): { locked: boolean; shown: string | null } {
  const r = getCallAlerts();
  return useSyncExternalStore(r.subscribe, r.getSnapshot, r.getSnapshot);
}
