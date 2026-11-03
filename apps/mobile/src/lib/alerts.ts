/**
 * Alertas oficiais no app: busca nos Piu Nodes pareados (`GET /api/alerts`), guarda os recebidos
 * cifrados (lib/persist.ts), filtra pela região escolhida e avisa os severos e extremos.
 *
 * - Só os nós com sessão aberta neste celular (tela do equipamento → código de 8 dígitos) são
 *   consultados. Sem nó pareado, a lista fica vazia e as telas dizem por quê.
 * - Busca ao abrir o app, ao voltar para ele e a cada 10 min enquanto ele está rodando.
 * - Severo/Extremo novo na região: notificação local crítica (lib/notifications.ts) com o app em
 *   segundo plano; com o app aberto, banner que abre o alerta.
 * A lógica (filtro, vigência, quem notificar) fica em lib/alertsCore.ts, testada no Node.
 */
import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useStore } from '../state/store';
import { alertTitle, areaLine, DEFAULT_REGION, mergeAlerts, type AlertRegion, type OfficialAlert, sanitizeAlert, toNotify } from './alertsCore';
import { listProvNodes } from './approvalNodes';
import { NodeApiError } from './nodeApi';
import { nodeApiFor, saveNodeSession } from './nodeLink';
import { notify } from './notifications';
import { persistNow, readPersisted } from './persist';

const KEY = 'alerts.v1', REGION_KEY = 'alerts.region', NOTIFIED_KEY = 'alerts.notified';
const POLL_MS = 10 * 60_000;

export interface AlertsState {
  alerts: OfficialAlert[];
  region: AlertRegion;
  /** Equipamentos pareados / com sessão aberta neste celular / com alertas ligados (na última busca). */
  nodes: { paired: number; connected: number; enabled: number };
  lastAt: number | null;
  error: string | null;
  loading: boolean;
}

let state: AlertsState = {
  alerts: readPersisted<OfficialAlert[]>(KEY) ?? [],
  region: { ...DEFAULT_REGION, ...readPersisted<AlertRegion>(REGION_KEY) },
  nodes: { paired: 0, connected: 0, enabled: 0 },
  lastAt: null, error: null, loading: false,
};
let hydrated = false;
const listeners = new Set<() => void>();
const set = (p: Partial<AlertsState>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };
/** O módulo pode carregar antes de `loadPersisted` terminar: relê na primeira assinatura. */
const hydrate = () => {
  if (hydrated) return;
  hydrated = true;
  state = { ...state, alerts: readPersisted<OfficialAlert[]>(KEY) ?? state.alerts, region: { ...DEFAULT_REGION, ...readPersisted<AlertRegion>(REGION_KEY) } };
};
const subscribe = (l: () => void) => { hydrate(); listeners.add(l); return () => { listeners.delete(l); }; };

export function useOfficialAlerts(): AlertsState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function setAlertRegion(region: AlertRegion) {
  set({ region });
  void persistNow(REGION_KEY, region).catch(() => {});
}

export const findAlert = (id: string) => state.alerts.find(a => a.id === id) ?? null;

let running: Promise<OfficialAlert[]> | null = null;

/** Busca em todos os nós com sessão. Devolve os alertas novos que merecem aviso. */
export function refreshAlerts(): Promise<OfficialAlert[]> {
  running ??= doRefresh().finally(() => { running = null; });
  return running;
}

async function doRefresh(): Promise<OfficialAlert[]> {
  hydrate();
  set({ loading: true });
  const now = Date.now();
  const incoming: OfficialAlert[] = [];
  const refreshed: string[] = [];
  let connected = 0, enabled = 0;
  const errors: string[] = [];
  const nodes = await listProvNodes().catch(() => []);
  for (const n of nodes) {
    const api = nodeApiFor(n);
    if (!api?.session) continue;
    connected++;
    try {
      const r = await api.alerts();
      refreshed.push(n.node);
      if (!r.enabled) continue;
      enabled++;
      for (const raw of r.alerts ?? []) { const a = sanitizeAlert(raw, n.node, now); if (a) incoming.push(a); }
    } catch (e) {
      if (e instanceof NodeApiError && e.status === 401) await saveNodeSession(n.phoneId, null).catch(() => {});
      errors.push(`${n.node}: ${(e as Error).message}`);
    }
  }
  const alerts = mergeAlerts(state.alerts, incoming, now, refreshed);
  const fresh = toNotify(alerts, readPersisted<string[]>(NOTIFIED_KEY) ?? [], state.region, now);
  set({ alerts, nodes: { paired: nodes.length, connected, enabled }, lastAt: now, error: errors[0] ?? null, loading: false });
  await persistNow(KEY, alerts).catch(() => {});
  if (fresh.length) {
    const kept = new Set(alerts.map(a => a.id));
    const notified = [...(readPersisted<string[]>(NOTIFIED_KEY) ?? []).filter(id => kept.has(id)), ...fresh.map(a => a.id)];
    await persistNow(NOTIFIED_KEY, notified.slice(-500)).catch(() => {});
  }
  return fresh;
}

const alertHref = (id: string) => `/alert?id=${encodeURIComponent(id)}`;

/** Busca periódica e avisos. Monte uma vez, dentro de StoreProvider (em `_layout.tsx`). */
export function AlertsBridge() {
  const { onboarded, showToast } = useStore();
  useEffect(() => {
    if (!onboarded) return;
    const run = () => {
      void refreshAlerts().then(fresh => {
        for (const a of fresh) {
          const title = alertTitle(a), body = areaLine(a) || a.info.description.slice(0, 140);
          void notify({ kind: 'alert', critical: true, title, body, data: { href: alertHref(a.id) } }).then(sent => {
            if (!sent && AppState.currentState === 'active') {
              showToast({ icon: 'warning', title, body, action: 'Ver', go: () => router.push({ pathname: '/alert', params: { id: a.id } }) });
            }
          });
        }
      }).catch(() => {});
    };
    run();
    const t = setInterval(run, POLL_MS);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') run(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [onboarded]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
