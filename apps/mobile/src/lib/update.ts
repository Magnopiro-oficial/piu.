import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';
import { persistNow, readPersisted } from './persist';
import { autoCheckDue, checkOutcome, isReleasePage, type UpdateOutcome } from './updateCore';

/**
 * Lado React de "Procurar atualização" (núcleo puro em updateCore.ts). Um único resultado compartilhado
 * entre a tela Versão e o aviso automático (ui/UpdateWatch.tsx); uma checagem por vez.
 */

/** Versão deste app (app.json), a mesma do nome do APK enviado (sendApp.ts). Vazia se o build não informar. */
export const appVersion = (): string => Constants.expoConfig?.version ?? '';

/** Procurar versão nova só faz sentido onde o APK instala (Android); no navegador fica para conferir a tela. */
export const canCheckUpdates = Platform.OS === 'android' || Platform.OS === 'web';
/** Aviso automático só no Android. */
export const canAutoCheck = Platform.OS === 'android';

const LAST_CHECK = 'update.lastCheck';

type State = { outcome: UpdateOutcome | null; checking: boolean };
let state: State = { outcome: null, checking: false };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => state;

let inflight: Promise<UpdateOutcome> | null = null;

/** Confere o GitHub agora. Com resposta do GitHub (não "sem internet"), conta como a checagem do dia. */
export function runUpdateCheck(): Promise<UpdateOutcome> {
  if (inflight) return inflight;
  set({ checking: true });
  inflight = checkOutcome(appVersion()).then(outcome => {
    if (outcome.state !== 'offline') void persistNow(LAST_CHECK, Date.now()).catch(() => {});
    set({ outcome, checking: false });
    return outcome;
  }).finally(() => { inflight = null; });
  return inflight;
}

/** Hora da checagem automática do dia? */
export function autoCheckIsDue(now = Date.now()): boolean {
  const last = readPersisted<number>(LAST_CHECK);
  return autoCheckDue(typeof last === 'number' && Number.isFinite(last) ? last : null, now);
}

export function useUpdateCheck() {
  return useSyncExternalStore(subscribe, get, get);
}

/** Abre a página da versão no navegador. Só URLs de release do próprio repositório (updateCore.isReleasePage). */
export async function openRelease(url: string | null | undefined): Promise<boolean> {
  if (!isReleasePage(url)) return false;
  try { await Linking.openURL(url); return true; } catch { return false; }
}
