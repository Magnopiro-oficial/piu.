import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PENDING, START_BALANCE, seedDevices, seedTxs } from '../data/seed';
import { ApiError, NeedsReauth, type NodeApi, type ApiDevice, type ApiPackage, type ApiPending, type ApiPhone, type ApiSession, type ApiSettings } from '../lib/api';
import { type Live, liveDevice, liveTx } from '../lib/live';
import type { DeviceFilter, HoursPolicy, PageId, Policies, RelayNode, Theme, ToastData, WalletTx } from '../types';
import { useNode } from './node';

// ── rota (hash) ─────────────────────────────────────────
const PAGES: PageId[] = ['overview', 'devices', 'mesh', 'earnings', 'wallet', 'settings'];
type Route = { page: PageId; sel: string | null };

function parseHash(): Route {
  const [, p, id] = window.location.hash.replace(/^#/, '').split('/');
  const page = (PAGES as string[]).includes(p) ? (p as PageId) : 'overview';
  return { page, sel: page === 'devices' && id ? decodeURIComponent(id) : null };
}

function useHashRoute() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((page: PageId, sel: string | null = null) => {
    const h = `#/${page}${sel ? '/' + encodeURIComponent(sel) : ''}`;
    if (window.location.hash !== h) window.location.hash = h;
    else setRoute({ page, sel });
  }, []);
  return { route, navigate };
}

// ── tema ────────────────────────────────────────────────
function initialTheme(): Theme {
  const saved = localStorage.getItem('piu-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── store ───────────────────────────────────────────────
interface Store {
  theme: Theme; setTheme: (t: Theme) => void;
  page: PageId; sel: string | null; navigate: (page: PageId, sel?: string | null) => void;
  devices: RelayNode[];
  /** No piu-node: cria no servidor e devolve o id definitivo (ou null se falhou). */
  addDevice: (d: RelayNode, family: string) => Promise<string | null>;
  togglePause: (id: string) => void;
  /** No piu-node: revoga no servidor; `false` se não foi possível. */
  revokeDevice: (id: string) => Promise<boolean>;
  devFilter: DeviceFilter; setDevFilter: (f: DeviceFilter) => void;
  devQuery: string; setDevQuery: (q: string) => void;
  balance: number; txs: WalletTx[];
  /** No piu-node: `reauth` quando o servidor pede confirmação recente (step-up). */
  recordTransfer: (amount: number, tx: WalletTx, to?: string) => Promise<'ok' | 'reauth' | 'error' | { pending: ApiPending }>;
  /** Conclui uma transferência pendente com o código de aprovação do celular. Devolve o erro, ou null. */
  approveTransfer: (pending: ApiPending, approval: string, amount: number, tx: WalletTx) => Promise<string | null>;
  /** Celulares que aprovam (só com piu-node). */
  phones: ApiPhone[] | null;
  refreshPhones: () => void;
  /** Cliente da API do nó (null na demonstração). */
  api: NodeApi | null;
  /** Acessos abertos (só com piu-node). */
  sessions: ApiSession[] | null;
  revokeOtherSessions: () => Promise<'ok' | 'reauth' | 'error'>;
  /** Confirma com um código novo do equipamento; devolve a mensagem de erro, ou null. */
  stepUp: (code: string) => Promise<string | null>;
  /** 'node' quando servido por um piu-node com sessão; 'demo' quando estático (site, prévia). */
  nodeMode: 'node' | 'demo';
  operatorName: string | null;
  logout: () => void;
  /** Pacotes do instalador com manifesto assinado (só com piu-node). */
  packages: ApiPackage[];
  limits: { bw: number; sto: number; hours: HoursPolicy };
  setLimits: (p: Partial<Store['limits']>) => void;
  policies: Policies; togglePolicy: (k: keyof Policies) => void;
  wizardOpen: boolean; setWizardOpen: (o: boolean) => void;
  toast: (ToastData & { seq: number }) | null; showToast: (t: ToastData) => void;
  totals: { month: number; today: number; active: number; validated: number };
  /** Estatísticas reais do nó (retransmissão, histórico, recibos); null na demonstração. */
  live: Live | null;
}

const Ctx = createContext<Store | null>(null);

/** Intervalo da leitura das estatísticas do nó (vizinhos, contadores, recibos). */
const LIVE_MS = 10_000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const node = useNode();
  const api = node.mode.kind === 'node' ? node.mode.api : null;
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const { route, navigate } = useHashRoute();
  const [demoDevices, setDevices] = useState<RelayNode[]>(seedDevices);
  /** Com piu-node: os equipamentos do operador, como o servidor devolveu. */
  const [apiDevices, setApiDevices] = useState<ApiDevice[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [devFilter, setDevFilter] = useState<DeviceFilter>('all');
  const [devQuery, setDevQuery] = useState('');
  const [balance, setBalance] = useState(START_BALANCE);
  const [txs, setTxs] = useState<WalletTx[]>(seedTxs);
  const [limits, setLimitsState] = useState<Store['limits']>({ bw: 50, sto: 8, hours: 'always' });
  const [policies, setPolicies] = useState<Policies>({ media: true, unknown: true, community: false });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<Store['toast']>(null);
  const [packages, setPackages] = useState<ApiPackage[]>([]);
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [phones, setPhones] = useState<ApiPhone[] | null>(null);
  const settingsLoaded = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastSeq = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.piuTheme = theme;
  }, [theme]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const refreshWallet = useCallback(() => {
    if (!api) return;
    node.guard(api.wallet()).then(w => { setBalance(w.balance); setTxs(w.txs.map(liveTx)); }).catch(() => {});
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // Servido por um piu-node: equipamentos, saldo e movimentações vêm do servidor (só os do operador da sessão).
  useEffect(() => {
    if (!api) return;
    setTxs([]); setBalance(0);
    node.guard(api.devices()).then(setApiDevices).catch(() => {});
    refreshWallet();
    node.guard(api.packages()).then(setPackages).catch(() => {});
    node.guard(api.sessions()).then(setSessions).catch(() => {});
    node.guard(api.phones()).then(setPhones).catch(() => {});
    node.guard(api.settings()).then(s => { setLimitsState(s.limits); setPolicies(s.policies); settingsLoaded.current = true; }).catch(() => {});
    // Estatísticas reais do motor: lidas agora e a cada LIVE_MS (vizinhos entram e saem, contadores sobem).
    let alive = true;
    const read = () => Promise.all([
      node.guard(api.relay()).catch(() => null), node.guard(api.history()).catch(() => null), node.guard(api.receipts()).catch(() => null),
    ]).then(([relay, history, receipts]) => { if (alive) setLive({ relay, history, receipts }); });
    void read();
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void read(); }, LIVE_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const devices = useMemo<RelayNode[]>(
    () => (api ? apiDevices.map(d => ({ ...liveDevice(d, live), fresh: d.id === fresh })) : demoDevices),
    [api, apiDevices, live, demoDevices, fresh],
  );

  // Ajustes salvos no nó (depois de carregados, para não sobrescrever com o padrão).
  useEffect(() => {
    if (!api || !settingsLoaded.current) return;
    const t = window.setTimeout(() => {
      node.guard(api.saveSettings({ limits, policies } as ApiSettings))
        .catch(e => showToast({ icon: 'error', title: 'Ajuste não salvo', body: e instanceof ApiError ? e.message : 'Tente de novo.' }));
    }, 400);
    return () => window.clearTimeout(t);
  }, [limits, policies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Embutido no site (iframe), acompanha o tema escolhido lá: por mensagem ou pela mesma chave salva.
  useEffect(() => {
    const apply = (t: unknown) => { if (t === 'light' || t === 'dark') setThemeState(t); };
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'piu-theme') apply(e.data.theme); };
    const onStorage = (e: StorageEvent) => { if (e.key === 'piu-theme') apply(e.newValue); };
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('storage', onStorage); };
  }, []);

  const setTheme = useCallback((t: Theme) => { setThemeState(t); localStorage.setItem('piu-theme', t); }, []);

  const showToast = useCallback((t: ToastData) => {
    window.clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ ...t, seq: toastSeq.current });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const store = useMemo<Store>(() => {
    const month = devices.reduce((a, d) => a + d.month, 0);
    const today = devices.reduce((a, d) => a + d.today, 0);
    return {
      theme, setTheme,
      page: route.page, sel: route.sel, navigate,
      devices,
      addDevice: async (d, family) => {
        if (api) {
          try {
            const r = await node.guard(api.createDevice({ name: d.name, cls: d.cls, family, ...(d.pub ? { pub: d.pub } : {}) }));
            setApiDevices(ds => [...ds, r]); setFresh(r.id); setDevFilter('all'); setDevQuery('');
            return r.id;
          } catch (e) {
            showToast({ icon: 'error', title: 'Não foi possível ativar', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return null;
          }
        }
        setDevices(ds => [...ds, d]); setDevFilter('all'); setDevQuery('');
        return d.id;
      },
      togglePause: id => {
        if (api) {
          // O servidor decide (e, no próprio nó, pausa o motor): o painel mostra o estado que ele devolver.
          node.guard(api.togglePause(id))
            .then(r => { setApiDevices(ds => ds.map(d => (d.id === r.id ? { ...d, status: r.status } : d))); return node.guard(api.relay()).then(relay => setLive(l => (l ? { ...l, relay } : l))); })
            .catch(e => showToast({ icon: 'error', title: 'Não foi possível alterar', body: e instanceof ApiError ? e.message : 'Tente de novo.' }));
          return;
        }
        setDevices(ds => ds.map(d => (d.id !== id ? d : { ...d, status: d.status === 'paused' ? 'active' : 'paused' })));
      },
      revokeDevice: async id => {
        if (api) {
          try { await node.guard(api.revoke(id)); } catch (e) {
            showToast({ icon: 'error', title: 'Não foi possível revogar', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return false;
          }
          setApiDevices(ds => ds.filter(d => d.id !== id));
          return true;
        }
        setDevices(ds => ds.filter(d => d.id !== id));
        return true;
      },
      devFilter, setDevFilter, devQuery, setDevQuery,
      balance, txs,
      recordTransfer: async (amount, tx, to) => {
        if (api) {
          try {
            const r = await node.guard(api.transfer(amount, to));
            if ('pending' in r) return { pending: r.pending };
          } catch (e) {
            if (e instanceof NeedsReauth) return 'reauth';
            showToast({ icon: 'error', title: 'Transferência não feita', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return 'error';
          }
          refreshWallet();
          return 'ok';
        }
        setBalance(b => Math.round((b - amount) * 100) / 100); setTxs(t => [tx, ...t]);
        return 'ok';
      },
      approveTransfer: async (pending, approval) => {
        if (!api) return 'Sem nó.';
        try { await node.guard(api.approveTransfer(pending.id, approval)); }
        catch (e) { return e instanceof ApiError ? e.message : 'Não foi possível concluir.'; }
        refreshWallet();
        return null;
      },
      phones,
      api,
      refreshPhones: () => { if (api) node.guard(api.phones()).then(setPhones).catch(() => {}); },
      stepUp: async code => {
        if (!api) return null;
        try { await node.guard(api.reauth(code)); return null; } catch (e) { return e instanceof ApiError ? e.message : 'Não foi possível confirmar.'; }
      },
      sessions,
      revokeOtherSessions: async () => {
        if (!api) return 'ok';
        try { await node.guard(api.revokeOtherSessions()); } catch (e) {
          if (e instanceof NeedsReauth) return 'reauth';
          showToast({ icon: 'error', title: 'Não foi possível encerrar', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
          return 'error';
        }
        node.guard(api.sessions()).then(setSessions).catch(() => {});
        return 'ok';
      },
      nodeMode: api ? 'node' : 'demo',
      operatorName: node.mode.kind === 'node' ? node.mode.operator.name : null,
      logout: () => { if (api) void api.logout().catch(() => {}).finally(() => node.lost()); },
      packages,
      limits, setLimits: p => setLimitsState(l => ({ ...l, ...p })),
      policies, togglePolicy: k => setPolicies(p => ({ ...p, [k]: !p[k] })),
      wizardOpen, setWizardOpen,
      toast, showToast,
      totals: { month, today, active: devices.filter(d => d.status === 'active').length, validated: api ? 0 : month - PENDING },
      live,
    };
  }, [theme, setTheme, route, navigate, devices, devFilter, devQuery, balance, txs, limits, policies, wizardOpen, toast, showToast, api, node, packages, sessions, phones, live, refreshWallet]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora de StoreProvider');
  return s;
}
