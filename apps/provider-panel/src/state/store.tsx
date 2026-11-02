import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PENDING, START_BALANCE, seedDevices, seedTxs } from '../data/seed';
import { ApiError, NeedsReauth, type ApiDevice, type ApiPackage, type ApiSession, type ApiSettings } from '../lib/api';
import type { DeviceFilter, HoursPolicy, NodeClass, PageId, Policies, RelayNode, Theme, ToastData, WalletTx } from '../types';
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
  recordTransfer: (amount: number, tx: WalletTx, to?: string) => Promise<'ok' | 'reauth' | 'error'>;
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
}

const Ctx = createContext<Store | null>(null);

/** Equipamento da API no formato do painel (detalhes de exibição vêm do modelo da mesma classe). */
function fromApi(d: ApiDevice, templates: RelayNode[]): RelayNode {
  const t = templates.find(x => x.cls === d.cls) ?? templates[0]!;
  return { ...t, id: d.id, name: d.name, cls: (d.cls as NodeClass) ?? t.cls, status: d.status, today: d.today, fresh: false };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const node = useNode();
  const api = node.mode.kind === 'node' ? node.mode.api : null;
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const { route, navigate } = useHashRoute();
  const [devices, setDevices] = useState<RelayNode[]>(seedDevices);
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
  const settingsLoaded = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const toastSeq = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.piuTheme = theme;
  }, [theme]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Servido por um piu-node: equipamentos e saldo vêm do servidor (só os do operador da sessão).
  useEffect(() => {
    if (!api) return;
    const templates = seedDevices();
    node.guard(api.devices()).then(ds => setDevices(ds.map(d => fromApi(d, templates)))).catch(() => {});
    node.guard(api.wallet()).then(w => setBalance(w.balance)).catch(() => {});
    node.guard(api.packages()).then(setPackages).catch(() => {});
    node.guard(api.sessions()).then(setSessions).catch(() => {});
    node.guard(api.settings()).then(s => { setLimitsState(s.limits); setPolicies(s.policies); settingsLoaded.current = true; }).catch(() => {});
  }, [api]);

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
        let id = d.id;
        if (api) {
          try {
            const r = await node.guard(api.createDevice({ name: d.name, cls: d.cls, family, ...(d.pub ? { pub: d.pub } : {}) }));
            id = r.id;
          } catch (e) {
            showToast({ icon: 'error', title: 'Não foi possível ativar', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return null;
          }
        }
        setDevices(ds => [...ds, { ...d, id }]); setDevFilter('all'); setDevQuery('');
        return id;
      },
      togglePause: id => {
        const flip = () => setDevices(ds => ds.map(d => (d.id !== id ? d : { ...d, status: d.status === 'paused' ? 'active' : 'paused' })));
        flip();
        if (api) node.guard(api.togglePause(id)).catch(e => { flip(); showToast({ icon: 'error', title: 'Não foi possível alterar', body: e instanceof ApiError ? e.message : 'Tente de novo.' }); });
      },
      revokeDevice: async id => {
        if (api) {
          try { await node.guard(api.revoke(id)); } catch (e) {
            showToast({ icon: 'error', title: 'Não foi possível revogar', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return false;
          }
        }
        setDevices(ds => ds.filter(d => d.id !== id));
        return true;
      },
      devFilter, setDevFilter, devQuery, setDevQuery,
      balance, txs,
      recordTransfer: async (amount, tx, to) => {
        if (api) {
          try { await node.guard(api.transfer(amount, to)); } catch (e) {
            if (e instanceof NeedsReauth) return 'reauth';
            showToast({ icon: 'error', title: 'Transferência não feita', body: e instanceof ApiError ? e.message : 'Tente de novo.' });
            return 'error';
          }
        }
        setBalance(b => Math.round((b - amount) * 100) / 100); setTxs(t => [tx, ...t]);
        return 'ok';
      },
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
      totals: { month, today, active: devices.filter(d => d.status === 'active').length, validated: month - PENDING },
    };
  }, [theme, setTheme, route, navigate, devices, devFilter, devQuery, balance, txs, limits, policies, wizardOpen, toast, showToast, api, node, packages, sessions]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora de StoreProvider');
  return s;
}
