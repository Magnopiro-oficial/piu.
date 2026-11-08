/**
 * Ponto Piu neste celular (docs/rede/pontos-piu-roteadores.md, fase 2; telas "Piu 13" P2–P9) e o lado
 * visitante (P8). Lógica pura em lib/pointCore.ts; aqui ficam o estado salvo, os efeitos e o aparelho.
 *
 * Dono: criar (assistente P2→P6) → ativar com um toque → pausar / retomar / encerrar (apaga a chave do
 * ponto e o que ele guarda de terceiros). O que o ponto liga (guardar com limites, gateway, serviço em
 * primeiro plano) vai para o mensageiro e o transporte por lib/pointBridge.ts.
 * Visitante: redes "Piu · …" por perto (varredura do sistema) ou QR → folha ao abrir o app e notificação
 * com o app em segundo plano (uma por ponto por dia) → entrar só para o Piu (WifiNetworkSpecifier).
 */
import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { PiuAppShare } from '../../modules/piu-app-share';
import { PiuLan, type PiuLanHotspot } from '../../modules/piu-lan';
import { getLang, t } from '../i18n';
import { apkShareName } from '../lib/appShare';
import { notify } from '../lib/notifications';
import { readPersisted, usePersisted } from '../lib/persist';
import { pointBridge } from '../lib/pointBridge';
import {
  accumulateStats, DEFAULT_DAYS, DEFAULT_SPACE_MB, emptyStats, isolationOnset, isPiuSsid, looksSeparated, nearbyList, parseWifiQr, pointCheckView, pointHealth, pointName,
  pointRuntime, pointWifiQr, proofsSince, reviveConfig, shouldNotifyPoint, type IsolationSample, type PointCheckView, type PointConfig, type PointHealth, type PointLevel,
  type PointNetwork, type PointStats, type ScannedNet, type WifiSecurity,
} from '../lib/pointCore';
import { derivePointKey, newPointSecret, pointIdOf } from '../lib/pointKey';
import { POINT_PAGE_PORT, pointPageHtml, pointPageUrl } from '../lib/pointPage';
import { deletePointSecret, savePointSecret } from '../lib/pointSecret';
import {
  currentSsid, errCode, hotspotInfo, joinPointNetwork, leavePointNetwork, pointWifiSupport, scanNetworks, startHotspot as nativeStartHotspot, startPointPage, stopHotspot as nativeStopHotspot,
  stopPointPage, watchPointWifi, type PointWifiError,
} from '../lib/pointWifi';
import { loadApkIntegrity } from '../lib/sendApp';
import type { LanCheckResult } from '../transport/lan/lanCheck';
import { useMessaging } from './messaging';
import { useStore } from './store';
import { useLanTransport, useTransport } from './transport';

/** Rascunho do assistente (P3 → P6o). */
export interface PointDraft {
  network: PointNetwork | null;
  level: PointLevel;
  spaceMb: number;
  days: number;
  /** Nome digitado (sem o prefixo "Piu · "). */
  name: string;
}

export interface PointCheckState {
  running: boolean;
  result: LanCheckResult | null;
  view: PointCheckView | null;
  error: string | null;
  /** Rede testada (nome, se conhecido). */
  ssid: string | null;
}

/** Contagens do painel (P7). `null` = ainda sem leitura (nunca um número inventado). */
export interface PointPanelStats {
  peersToday: number;
  delivered: number | null;
  stored: number | null;
  storedBytes: number | null;
  relayed: number;
  /** Bytes de terceiros que passaram por este celular hoje (todas as redes). */
  dataToday: number | null;
}

/** Ponto por perto, oferecido ao visitante (P8). */
export interface PointOffer {
  ssid: string;
  /** Nome mostrado: o da rede ("Piu · …") ou o lido no QR. */
  name: string;
  security: WifiSecurity;
  password: string | null;
  from: 'scan' | 'qr';
}

export interface VisitorState {
  offer: PointOffer | null;
  /** No ponto agora (P8a). */
  joined: { ssid: string; name: string; at: number; deliveredAt: number } | null;
  /** Acabou de sair do alcance (P8b, some em 5 s). */
  left: { name: string; at: number } | null;
  joining: boolean;
  error: PointWifiError | null;
}

interface PointCtx {
  config: PointConfig | null;
  health: PointHealth | null;
  stats: PointPanelStats;
  /** Hotspot deste celular (forma B) ligado agora. */
  hotspot: PiuLanHotspot | null;
  /** Página local do app (P9), quando servida. */
  pageUrl: string | null;
  pageError: PointWifiError | null;
  support: ReturnType<typeof pointWifiSupport>;
  /** QR de Wi-Fi do ponto (P6), se houver nome de rede. */
  qr: string | null;
  // ── assistente ──
  draft: PointDraft;
  setDraft: (p: Partial<PointDraft>) => void;
  /** P3: Wi-Fi atual (nome só se o sistema mostrar) e redes por perto. */
  current: { connected: boolean; ssid: string | null; internet: boolean; hotspot: boolean };
  nearby: ScannedNet[];
  nearbyError: PointWifiError | null;
  refreshNearby: () => Promise<void>;
  useCurrentWifi: (o: { ssid: string | null; separated: boolean }) => void;
  startHotspot: () => Promise<PiuLanHotspot>;
  check: PointCheckState;
  runCheck: () => Promise<void>;
  /** P6o: ativar (um toque). `o` completa o rascunho com o que foi digitado na própria tela. */
  activate: (o?: { name?: string; network?: PointNetwork }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** P7d: apaga a chave do ponto e o que ele guarda de terceiros. Devolve quantas mensagens saíram. */
  end: () => Promise<number>;
  setLevel: (level: PointLevel, spaceMb: number, days: number) => void;
  // ── visitante ──
  visitor: VisitorState;
  offerFromQr: (text: string) => boolean;
  dismissOffer: () => void;
  join: () => Promise<void>;
  /** Mapa da rede: entra no Wi-Fi de um ponto "Piu · …" da varredura (o mesmo caminho de `join`, sem a folha). */
  joinNet: (net: { ssid: string; secure: boolean }) => Promise<void>;
  leave: () => Promise<void>;
  clearLeft: () => void;
}

const Ctx = createContext<PointCtx | null>(null);

const EMPTY_CHECK: PointCheckState = { running: false, result: null, view: null, error: null, ssid: null };
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
const DEFAULT_DRAFT: PointDraft = { network: null, level: 'guardian', spaceMb: DEFAULT_SPACE_MB, days: DEFAULT_DAYS, name: '' };

/** Permissão de ver redes Wi-Fi já concedida (a varredura em segundo plano nunca pede). */
async function canScanQuietly(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const v = Number(Platform.Version);
  const p = v >= 33 ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  try { return await PermissionsAndroid.check(p); } catch { return false; }
}

export function PointProvider({ children }: { children: ReactNode }) {
  const { onboarded } = useStore();
  const lan = useLanTransport();
  const { peers } = useTransport();
  const { stats: msgStats, phoneNodeMsg } = useMessaging();
  const support = useMemo(pointWifiSupport, []);

  const [config, setConfig] = usePersisted<PointConfig | null>('point.config', null, c => reviveConfig(c));
  const [pstats, setPstats] = usePersisted<PointStats>('point.stats', () => emptyStats(dayOf(Date.now())));
  const [draft, setDraftState] = useState<PointDraft>(DEFAULT_DRAFT);
  const setDraft = useCallback((p: Partial<PointDraft>) => setDraftState(d => ({ ...d, ...p })), []);
  const [check, setCheck] = useState<PointCheckState>(EMPTY_CHECK);
  const [hotspot, setHotspot] = useState<PiuLanHotspot | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [pageError, setPageError] = useState<PointWifiError | null>(null);
  const [ssidNow, setSsidNow] = useState<string | null>(null);
  const [nearby, setNearby] = useState<ScannedNet[]>([]);
  const [nearbyError, setNearbyError] = useState<PointWifiError | null>(null);
  const [isolating, setIsolating] = useState(false);
  const [live, setLive] = useState<{ stored: number | null; storedBytes: number | null; delivered: number | null; dataToday: number | null }>({ stored: null, storedBytes: null, delivered: null, dataToday: null });

  const runtime = useMemo(() => pointRuntime(config), [config]);
  useEffect(() => { pointBridge.setRuntime(runtime); }, [runtime]);

  // ── aparelho: hotspot e nome do Wi-Fi ──
  useEffect(() => {
    void hotspotInfo().then(h => setHotspot(h));
    return watchPointWifi(e => { if (e.type === 'hotspot') setHotspot(e.info); });
  }, []);
  const wifiIp = lan.wifi.ip;
  useEffect(() => { void currentSsid().then(setSsidNow); }, [wifiIp]);

  // Ponto com hotspot ativo e o processo reiniciou (o sistema fecha o hotspot junto): abre de novo.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !config || config.paused || config.network.kind !== 'hotspot' || hotspot) return;
    reopened.current = true;
    void nativeStartHotspot().then(h => {
      setHotspot(h);
      setConfig(c => (c ? { ...c, network: { ...c.network, ssid: h.ssid, password: h.passphrase, security: h.passphrase ? 'WPA' : 'nopass' } } : c));
    }).catch(() => {});
  }, [config, hotspot, setConfig]);

  // ── P9: página local do app no guardião com distribuição ──
  useEffect(() => {
    if (!runtime.serveApp || !config) { setPageUrl(null); void stopPointPage(); return; }
    const ip = config.network.kind === 'hotspot' ? hotspot?.ip ?? null : lan.wifi.ip;
    if (!ip) { setPageUrl(null); return; }
    let alive = true;
    (async () => {
      try {
        const file = apkShareName(Constants.expoConfig?.version ?? '');
        const size = PiuAppShare?.apkSize() ?? 0;
        const html = pointPageHtml({ pointName: config.name, fileName: file, size, lang: getLang(), integrity: await loadApkIntegrity() });
        const r = await startPointPage(file, html, ip, POINT_PAGE_PORT);
        if (alive) { setPageUrl(pointPageUrl(r.ip, r.port)); setPageError(null); }
      } catch (e) { if (alive) { setPageUrl(null); setPageError(errCode(e)); } }
    })();
    return () => { alive = false; void stopPointPage(); };
  }, [runtime.serveApp, config?.name, config?.network.kind, hotspot?.ip, lan.wifi.ip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── P7: contagens reais, a cada 10 s com o ponto ativo ──
  const peersRef = useRef(peers); peersRef.current = peers;
  useEffect(() => {
    if (!config) return;
    const read = () => {
      const s = msgStats();
      setPstats(p => accumulateStats(p, { day: dayOf(Date.now()), peerIds: runtime.active ? peersRef.current.map(x => x.id) : [], relayedToday: s ? s.metrics.relayedToday : null }));
      const st = pointBridge.handlers?.stored() ?? null;
      setLive({
        stored: st ? st.count : null, storedBytes: st ? st.bytes : null,
        delivered: s ? proofsSince(phoneNodeMsg.credits(), config.createdAt) : null,
        dataToday: s ? s.relay.bytesToday : null,
      });
    };
    read();
    const iv = setInterval(read, 10_000);
    return () => clearInterval(iv);
  }, [config?.createdAt, runtime.active, msgStats, phoneNodeMsg, setPstats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── P7c: começo de isolamento (leitura leve a cada 2 min: roteador + rediscagem dos vizinhos que sumiram) ──
  const lanRef = useRef(lan); lanRef.current = lan;
  useEffect(() => {
    if (!runtime.active || !config || config.network.kind !== 'wifi' || !PiuLan) { setIsolating(false); return; }
    let prev: IsolationSample | null = null;
    let alive = true;
    const tick = async () => {
      const l = lanRef.current;
      const linked = l.peers.map(p => p.address.replace(/:\d+$/, ''));
      const gw = l.wifi.gateway;
      const routerUp = gw ? (await Promise.all([80, 443].map(p => PiuLan!.probe(gw, p, 1500).catch(() => 'error' as const)))).some(r => r === 'open' || r === 'refused') : false;
      const gone = prev ? prev.linked.filter(a => !linked.includes(a)).slice(0, 3) : [];
      const redial = linked.length === 0 && gone.length ? await Promise.all(gone.map(a => PiuLan!.probe(a, l.port || 8422, 1500).catch(() => 'error' as const))) : [];
      const now: IsolationSample = { ip: l.wifi.ip, linked, routerUp, redial };
      if (!alive) return;
      if (isolationOnset(prev, now)) setIsolating(true);
      else if (linked.length > 0 || prev?.ip !== now.ip) setIsolating(false);
      prev = now;
    };
    void tick();
    const iv = setInterval(() => { void tick(); }, 120_000);
    return () => { alive = false; clearInterval(iv); };
  }, [runtime.active, config?.network.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const health = config ? pointHealth(config, { wifiUp: lan.wifi.connected, hotspotUp: !!hotspot, isolating }) : null;

  // ── assistente ──
  const current = { connected: lan.wifi.connected && !hotspot, ssid: hotspot ? null : ssidNow, internet: lan.wifi.internet, hotspot: !!hotspot };

  const refreshNearby = useCallback(async () => {
    try { const l = await scanNetworks(); setNearby(nearbyList(l, ssidNow)); setNearbyError(null); }
    catch (e) { setNearbyError(errCode(e)); }
  }, [ssidNow]);

  const useCurrentWifi = useCallback((o: { ssid: string | null; separated: boolean }) => {
    setDraft({ network: { kind: 'wifi', ssid: o.ssid, security: 'WPA', password: null, separated: o.separated } });
  }, [setDraft]);

  const startHotspot = useCallback(async () => {
    const h = await nativeStartHotspot();
    setHotspot(h);
    setDraft({ network: { kind: 'hotspot', ssid: h.ssid, security: h.passphrase ? 'WPA' : 'nopass', password: h.passphrase, separated: true } });
    return h;
  }, [setDraft]);

  const runCheck = useCallback(async () => {
    const net = draft.network;
    setCheck({ ...EMPTY_CHECK, running: true, ssid: net?.ssid ?? null });
    try {
      const result = await lan.runLanCheck({ listenMs: 8000 });
      setCheck({ running: false, result, view: pointCheckView(result, { separated: !!net?.separated, hotspot: net?.kind === 'hotspot' }), error: null, ssid: net?.ssid ?? null });
    } catch (e) {
      setCheck({ running: false, result: null, view: null, error: String((e as Error)?.message ?? e), ssid: net?.ssid ?? null });
    }
  }, [draft.network, lan]);

  const activate = useCallback(async (o?: { name?: string; network?: PointNetwork }) => {
    const net = o?.network ?? draft.network;
    if (!net) throw new Error('Escolha a rede do ponto.');
    if (check.view?.blocks) throw new Error('A rede de casa ficaria exposta: o ponto não ativa.');
    const secret = newPointSecret();
    await savePointSecret(secret);
    const id = pointIdOf(derivePointKey(secret).pk);
    const level: PointLevel = draft.level === 'gateway' && !check.view?.internet ? 'guardian' : draft.level;
    setPstats(emptyStats(dayOf(Date.now())));
    setConfig({
      v: 1, id, name: pointName(o?.name ?? draft.name, net.ssid ?? t('point.defaultName')), network: net, level, spaceMb: draft.spaceMb, days: draft.days,
      createdAt: Date.now(), paused: false,
    });
  }, [draft, check.view, setConfig, setPstats]);

  const pause = useCallback(async () => {
    setConfig(c => (c ? { ...c, paused: true } : c));
    if (config?.network.kind === 'hotspot') { await nativeStopHotspot(); setHotspot(null); }
  }, [config?.network.kind, setConfig]);

  const resume = useCallback(async () => {
    if (config?.network.kind === 'hotspot') {
      // O sistema pode gerar nome e senha novos: o QR do ponto acompanha.
      const h = await nativeStartHotspot();
      setHotspot(h);
      setConfig(c => (c ? { ...c, paused: false, network: { ...c.network, ssid: h.ssid, password: h.passphrase, security: h.passphrase ? 'WPA' : 'nopass' } } : c));
      return;
    }
    setConfig(c => (c ? { ...c, paused: false } : c));
  }, [config?.network.kind, setConfig]);

  const end = useCallback(async () => {
    const dropped = pointBridge.handlers?.dropThirdParty() ?? 0;
    await stopPointPage();
    if (config?.network.kind === 'hotspot') { await nativeStopHotspot(); setHotspot(null); }
    await deletePointSecret();
    setConfig(null);
    setPstats(emptyStats(dayOf(Date.now())));
    setDraftState(DEFAULT_DRAFT);
    setCheck(EMPTY_CHECK);
    setIsolating(false);
    return dropped;
  }, [config?.network.kind, setConfig, setPstats]);

  const setLevel = useCallback((level: PointLevel, spaceMb: number, days: number) => {
    setConfig(c => (c ? { ...c, level, spaceMb, days } : c));
  }, [setConfig]);

  let qr: string | null = null;
  const qrNet = config?.network ?? draft.network;
  if (qrNet?.ssid) { try { qr = pointWifiQr({ ssid: qrNet.ssid, security: qrNet.security, password: qrNet.password }); } catch { qr = null; } }

  // ── visitante ──
  const [visitor, setVisitor] = useState<VisitorState>({ offer: null, joined: null, left: null, joining: false, error: null });
  const [dismissed, setDismissed] = usePersisted<Record<string, number>>('point.visitor.dismissed', {});
  const [notified, setNotified] = usePersisted<Record<string, number>>('point.visitor.notified', {});
  const visitorRef = useRef(visitor); visitorRef.current = visitor;
  const dismissedRef = useRef(dismissed); dismissedRef.current = dismissed;
  const notifiedRef = useRef(notified); notifiedRef.current = notified;

  const offerFromQr = useCallback((text: string) => {
    const w = parseWifiQr(text);
    if (!w) return false;
    setVisitor(v => ({ ...v, offer: { ssid: w.ssid, name: isPiuSsid(w.ssid) ? w.ssid : `Piu · ${w.ssid}`, security: w.security, password: w.password, from: 'qr' }, error: null }));
    return true;
  }, []);

  const dismissOffer = useCallback(() => {
    const o = visitorRef.current.offer;
    if (o?.from === 'scan') setDismissed(d => shouldNotifyPoint(d, o.ssid, Date.now()).log);
    setVisitor(v => ({ ...v, offer: null, error: null }));
  }, [setDismissed]);

  const joinOffer = useCallback(async (o: PointOffer) => {
    setVisitor(v => ({ ...v, joining: true, error: null }));
    try {
      await joinPointNetwork(o.ssid, o.password);
      const delivered = msgStats()?.metrics.delivered ?? 0;
      setVisitor(v => ({ ...v, joining: false, offer: null, joined: { ssid: o.ssid, name: o.name, at: Date.now(), deliveredAt: delivered }, left: null }));
    } catch (e) {
      setVisitor(v => ({ ...v, joining: false, error: errCode(e) }));
    }
  }, [msgStats]);
  const join = useCallback(async () => {
    const o = visitorRef.current.offer;
    if (o) await joinOffer(o);
  }, [joinOffer]);
  const joinNet = useCallback((n: { ssid: string; secure: boolean }) => joinOffer({ ssid: n.ssid, name: n.ssid, security: n.secure ? 'WPA' : 'nopass', password: null, from: 'scan' }), [joinOffer]);

  const leave = useCallback(async () => {
    await leavePointNetwork();
    setVisitor(v => (v.joined ? { ...v, joined: null, left: { name: v.joined.name, at: Date.now() } } : v));
  }, []);
  const clearLeft = useCallback(() => setVisitor(v => ({ ...v, left: null })), []);

  useEffect(() => watchPointWifi(e => {
    if (e.type === 'join' && e.state === 'lost') setVisitor(v => (v.joined ? { ...v, joined: null, left: { name: v.joined.name, at: Date.now() } } : v));
  }), []);

  // Redes "Piu · …" por perto: a cada minuto (o sistema limita varreduras; usa o resultado que houver).
  // Só com a permissão já dada (nunca pede em segundo plano), sem ponto próprio ativo e fora de um ponto.
  useEffect(() => {
    if (!onboarded || config || !support.scan) return;
    let alive = true;
    const tick = async () => {
      if (visitorRef.current.joined || visitorRef.current.offer || !(await canScanQuietly())) return;
      let list: ScannedNet[] = [];
      try { list = await PiuLan!.wifiScan!(); } catch { return; }
      const now = Date.now();
      const p = nearbyList(list, null).find(n => isPiuSsid(n.ssid) && shouldNotifyPoint(dismissedRef.current, n.ssid, now).notify);
      if (!p || !alive) return;
      const offer: PointOffer = { ssid: p.ssid, name: p.ssid, security: p.secure ? 'WPA' : 'nopass', password: null, from: 'scan' };
      if (AppState.currentState === 'active') setVisitor(v => ({ ...v, offer }));
      else {
        const r = shouldNotifyPoint(notifiedRef.current, p.ssid, now);
        if (!r.notify) return;
        setNotified(r.log);
        setVisitor(v => ({ ...v, offer }));
        void notify({ kind: 'network', title: t('point.notif.title'), body: t('point.notif.body', { name: p.ssid }), data: { href: '/(tabs)' } });
      }
    };
    void tick();
    const iv = setInterval(() => { void tick(); }, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [onboarded, config, support.scan, setNotified]);

  const value = useMemo<PointCtx>(() => ({
    config, health, hotspot, pageUrl, pageError, support, qr,
    stats: { peersToday: pstats.day === dayOf(Date.now()) ? pstats.seenToday.length : 0, relayed: pstats.relayed, ...live },
    draft, setDraft, current, nearby, nearbyError, refreshNearby, useCurrentWifi, startHotspot, check, runCheck, activate, pause, resume, end, setLevel,
    visitor, offerFromQr, dismissOffer, join, joinNet, leave, clearLeft,
  }), [config, health, hotspot, pageUrl, pageError, support, qr, pstats, live, draft, setDraft, current.connected, current.ssid, current.internet, current.hotspot, nearby, nearbyError, refreshNearby, useCurrentWifi, startHotspot, check, runCheck, activate, pause, resume, end, setLevel, visitor, offerFromQr, dismissOffer, join, joinNet, leave, clearLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePoint(): PointCtx {
  const p = useContext(Ctx);
  if (!p) throw new Error('usePoint fora de PointProvider');
  return p;
}

/** Pré-marcar "rede de visitante" pelo nome na P3. */
export { looksSeparated };
/** Lido no QR do scanner (scan.tsx): é um QR de Wi-Fi? */
export const isWifiQr = (text: string) => !!parseWifiQr(text);
export const readPersistedPoint = () => reviveConfig(readPersisted('point.config'));
