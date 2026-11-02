/**
 * Estado da migração que o resto do app consome:
 * - Rotação das chaves de sessão: pedida no fim da migração e ao desconectar/revogar um aparelho.
 *   O mensageiro (do líder) aplica com `applySessionRotation` ao montar e se remonta quando
 *   `useSessionRotationEpoch()` muda.
 * - Dados do app vindos de um arquivo de backup (histórico), guardados para importação.
 */
import { useSyncExternalStore } from 'react';
import { dropSessions } from './migration';
import { persistNow, readPersisted } from './persist';

const ROTATE = 'mig.rotate', IMPORT = 'mig.import';

let epoch = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Pede a rotação das chaves de sessão (vale até o mensageiro aplicar). */
export async function requestSessionRotation(reason: string) {
  const p = persistNow(ROTATE, { at: Date.now(), reason });
  epoch += 1;
  listeners.forEach(l => l());
  await p;
}

export const sessionRotationPending = () => !!readPersisted<{ at: number }>(ROTATE);

/**
 * Para o mensageiro: recebe o estado salvo (`Messenger.export()`) e, se houver rotação pendente,
 * devolve o estado sem as sessões e marca a rotação como feita. Sem pendência, devolve igual.
 */
export function applySessionRotation(state: string | undefined): string | undefined {
  if (!sessionRotationPending()) return state;
  void persistNow(ROTATE, null).catch(() => {});
  if (!state) return state;
  try { return dropSessions(state); } catch { return state; }
}

/** Muda a cada pedido de rotação (para o mensageiro se remontar e aplicar). */
export const useSessionRotationEpoch = () => useSyncExternalStore(subscribe, () => epoch, () => epoch);

/** Dados do app trazidos no arquivo de backup (chaves de `persist.ts` → valor). */
export const stashRestoredData = (data: Record<string, unknown>) => persistNow(IMPORT, data);

/** Para o líder: devolve (uma vez) os dados do arquivo de backup para importar. */
export function takeRestoredData(): Record<string, unknown> | null {
  const d = readPersisted<Record<string, unknown>>(IMPORT);
  if (!d) return null;
  void persistNow(IMPORT, null).catch(() => {});
  return d;
}

/** Chaves salvas que vão no arquivo de backup (histórico). As sessões saem antes (`dropSessions`). */
export const BACKUP_DATA_KEYS = ['profile', 'identity', 'chats', 'verified', 'msg.state'] as const;

/** Lê os dados do app para o arquivo de backup, sem as chaves de sessão. */
export function collectBackupData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BACKUP_DATA_KEYS) {
    const v = readPersisted<unknown>(k);
    if (v === undefined) continue;
    out[k] = k === 'msg.state' && typeof v === 'string' ? (() => { try { return dropSessions(v); } catch { return undefined; } })() : v;
  }
  return out;
}
