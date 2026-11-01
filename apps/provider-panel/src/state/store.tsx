import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PENDING, START_BALANCE, seedDevices, seedTxs } from '../data/seed';
import type { DeviceFilter, HoursPolicy, PageId, Policies, RelayNode, Theme, ToastData, WalletTx } from '../types';

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
  addDevice: (d: RelayNode) => void;
  togglePause: (id: string) => void;
  revokeDevice: (id: string) => void;
  devFilter: DeviceFilter; setDevFilter: (f: DeviceFilter) => void;
  devQuery: string; setDevQuery: (q: string) => void;
  balance: number; txs: WalletTx[];
  recordTransfer: (amount: number, tx: WalletTx) => void;
  limits: { bw: number; sto: number; hours: HoursPolicy };
  setLimits: (p: Partial<Store['limits']>) => void;
  policies: Policies; togglePolicy: (k: keyof Policies) => void;
  wizardOpen: boolean; setWizardOpen: (o: boolean) => void;
  toast: (ToastData & { seq: number }) | null; showToast: (t: ToastData) => void;
  totals: { month: number; today: number; active: number; validated: number };
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
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
  const toastTimer = useRef<number | undefined>(undefined);
  const toastSeq = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.piuTheme = theme;
  }, [theme]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

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
      addDevice: d => { setDevices(ds => [...ds, d]); setDevFilter('all'); setDevQuery(''); },
      togglePause: id => setDevices(ds => ds.map(d => (d.id !== id ? d : { ...d, status: d.status === 'paused' ? 'active' : 'paused' }))),
      revokeDevice: id => setDevices(ds => ds.filter(d => d.id !== id)),
      devFilter, setDevFilter, devQuery, setDevQuery,
      balance, txs,
      recordTransfer: (amount, tx) => { setBalance(b => b - amount); setTxs(t => [tx, ...t]); },
      limits, setLimits: p => setLimitsState(l => ({ ...l, ...p })),
      policies, togglePolicy: k => setPolicies(p => ({ ...p, [k]: !p[k] })),
      wizardOpen, setWizardOpen,
      toast, showToast,
      totals: { month, today, active: devices.filter(d => d.status === 'active').length, validated: month - PENDING },
    };
  }, [theme, setTheme, route, navigate, devices, devFilter, devQuery, balance, txs, limits, policies, wizardOpen, toast, showToast]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora de StoreProvider');
  return s;
}
