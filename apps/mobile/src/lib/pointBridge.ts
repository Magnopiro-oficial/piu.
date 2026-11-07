/**
 * Ponte do ponto Piu com quem fica ACIMA do PointProvider na árvore (state/transport.tsx e
 * state/messaging.tsx): um pequeno estado global com assinatura, como lib/carryBridge.ts.
 * - `runtime`: o que o ponto liga agora (guardar/repassar com limites, serviço em primeiro plano, gateway).
 * - `handlers`: o mensageiro registra leitura de contagens e "apagar o que é de terceiros" (encerrar o ponto).
 */
import { useSyncExternalStore } from 'react';
import { NO_POINT, type PointRuntime } from './pointCore';

export interface PointMessengerHandlers {
  /** Envelopes de terceiros guardados agora (quantidade e bytes). */
  stored: () => { count: number; bytes: number };
  /** Apaga todos os envelopes de terceiros guardados (encerrar o ponto). Devolve quantos saíram. */
  dropThirdParty: () => number;
}

let runtime: PointRuntime = NO_POINT;
let handlers: PointMessengerHandlers | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(fn => { try { fn(); } catch { /* ouvinte */ } });

export const pointBridge = {
  get runtime() { return runtime; },
  setRuntime(r: PointRuntime) {
    if (JSON.stringify(r) === JSON.stringify(runtime)) return;
    runtime = r;
    emit();
  },
  get handlers() { return handlers; },
  setHandlers(h: PointMessengerHandlers | null) { handlers = h; },
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
};

/** Runtime do ponto para os provedores de cima (re-renderiza quando muda). */
export function usePointRuntime(): PointRuntime {
  return useSyncExternalStore(pointBridge.subscribe, () => runtime, () => runtime);
}
