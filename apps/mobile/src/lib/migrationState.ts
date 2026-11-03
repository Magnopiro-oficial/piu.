/**
 * Estado da migração que o resto do app consome:
 * - Rotação das chaves de sessão: pedida no fim da migração e ao desconectar/revogar um aparelho.
 *   O mensageiro (do líder) aplica com `applySessionRotation` ao montar e se remonta quando
 *   `useSessionRotationEpoch()` muda.
 * - Dados do app vindos de um arquivo de backup (histórico), guardados para importação.
 * - Aviso de troca de aparelho (restaurar pela frase ou por arquivo): pedido aqui, assinado pelo
 *   mensageiro com as identidades e distribuído aos contatos (lib/devicesCore.ts).
 */
import { useSyncExternalStore } from 'react';
import type { DeviceChangeOutbox, DeviceChangeReason } from './devicesCore';
import { deviceChangeActive } from './devicesCore';
import { dropSessions } from './migration';
import { persistNow, readPersisted } from './persist';

const ROTATE = 'mig.rotate', IMPORT = 'mig.import', CHANGE = 'mig.change', CHANGES = 'mig.changes';

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

/**
 * Restaurou as chaves neste aparelho: pede o aviso assinado de troca de aparelho para os contatos.
 * O mensageiro assina (com as duas identidades, um aviso por identidade) ao montar.
 */
export const requestDeviceChangeNotice = (reason: DeviceChangeReason) => persistNow(CHANGE, { at: Math.floor(Date.now() / 1000), reason });

/** Para o líder: devolve (uma vez) o pedido de aviso de troca de aparelho. */
export function takeDeviceChangeRequest(): { at: number; reason: DeviceChangeReason } | null {
  const r = readPersisted<{ at: number; reason: DeviceChangeReason }>(CHANGE);
  if (!r || typeof r.at !== 'number' || (r.reason !== 'phrase' && r.reason !== 'file')) return null;
  void persistNow(CHANGE, null).catch(() => {});
  return r;
}

/** Avisos de troca ainda na janela de distribuição (com quem já recebeu). */
export const deviceChangeOutbox = (now: number): DeviceChangeOutbox[] => (readPersisted<DeviceChangeOutbox[]>(CHANGES) ?? []).filter(o => deviceChangeActive(o, now));
export const saveDeviceChangeOutbox = (list: DeviceChangeOutbox[]) => persistNow(CHANGES, list);

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
