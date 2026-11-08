/**
 * Mapa da rede com os dados reais do app: vizinhos do transporte (Bluetooth LE, Wi-Fi Direct, Wi-Fi
 * local), Super Nodes e gateways ouvidos pelos rádios LoRa (anúncio "PN") e redes "Piu · …" da
 * varredura de Wi-Fi. Nada inventado: o protocolo não leva posição nem rumo, então o mapa fica sem
 * direção (distância pelo sinal do Wi-Fi, quando há; senão, "até" o alcance do canal).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TxKey } from '../../data/network';
import { fmtDate, useT } from '../../i18n';
import { VIA_TX } from '../../lib/networkCore';
import {
  addLoraStep, gainedCount, isOnline, mapMode, peerPoints, superNodePoints, trackPoints, visiblePoints, wifiPhase, wifiPoints,
  type AddLoraStep, type ConnectPhase, type HeardBy, type MapPoint,
} from '../../lib/networkMap';
import { loraMedia } from '../../lib/piuLora';
import { useNetwork } from '../../state/network';
import { usePoint } from '../../state/point';
import { useLanTransport, useTransport } from '../../state/transport';
import type { Peer } from '../../transport';
import { useLora } from '../lora/useLora';
import { usePiuLora } from '../lora/usePiuLora';
import type { MapBanner, MapViewProps } from './MapView';

/** Varredura de Wi-Fi com a tela aberta (o sistema limita; usa o resultado que houver). */
const SCAN_MS = 30_000;
/** Resultado de varredura mais velho que isto não conta como "no alcance". */
const SCAN_FRESH_MS = 90_000;

// Vistos nesta sessão do app (o mapa offline mostra "vistos antes"). Só na memória: nada vai para o disco.
let memory: Record<string, MapPoint> = {};

export function useNetworkMap(): MapViewProps & { addLora: { step: AddLoraStep | null; setStep: (s: AddLoraStep | null) => void; loraOn: boolean; turnOnLora: () => void; askPermission: () => void } } {
  const t = useT();
  const n = useNetwork();
  const { state, peers, granted, askPermission } = useTransport();
  const lan = useLanTransport();
  const point = usePoint();
  const mesh = useLora(), piu = usePiuLora();

  // Relógio: de 5 em 5 s com a tela aberta (de segundo em segundo enquanto conecta); parado fora dela.
  const [focused, setFocused] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [conn, setConn] = useState<{ id: string; ssid: string; before: string[]; pending: boolean } | null>(null);
  useFocusEffect(useCallback(() => { setFocused(true); setNow(Date.now()); return () => setFocused(false); }, []));

  // Redes "Piu · …" por perto: só com a permissão já dada (a tela não pede nada sozinha).
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const canScan = point.support.scan && granted.nearby;
  const refresh = useRef(point.refreshNearby);
  refresh.current = point.refreshNearby;
  useEffect(() => {
    if (!focused || !canScan) return;
    let alive = true;
    const scan = async () => { await refresh.current(); if (alive) setScannedAt(Date.now()); };
    void scan();
    const id = setInterval(() => { void scan(); }, SCAN_MS);
    return () => { alive = false; clearInterval(id); };
  }, [focused, canScan]);

  // O que o app conhece agora.
  // Alcançável se algum dos meios dele está ligado na aba Rede.
  const live = (p: Peer) => (p.media ?? [p.via]).some(m => { const k = VIA_TX[m]; return k ? n.tx[k] : true; });
  const media = loraMedia(n.loraMode, n.tx.lora);
  const meshUp = media.lora && mesh?.status.phase === 'connected';
  const piuUp = media.piulora && piu?.status.phase === 'connected';
  const heard: HeardBy[] = [
    ...(meshUp && mesh ? [{ medium: 'lora' as const, nodes: mesh.radio.link.heard() }] : []),
    ...(piuUp && piu ? [{ medium: 'piulora' as const, nodes: piu.radio.link.heard() }] : []),
  ];
  const joined = point.visitor.joined;
  const freshScan = scannedAt !== null && now - scannedAt < SCAN_FRESH_MS && !point.nearbyError;
  const current: MapPoint[] = [
    ...peerPoints(peers, { live, now }),
    ...superNodePoints(heard),
    ...wifiPoints(freshScan ? point.nearby : [], { joinedSsid: joined?.ssid ?? null, scannedAt: scannedAt ?? now, canJoin: point.support.join }),
  ];
  const online = isOnline({ transport: state, lan: lan.active, lora: !!(meshUp || piuUp) });
  // Guarda o último sinal de cada um (idempotente: a mesma entrada dá a mesma memória).
  if (online) memory = trackPoints(memory, current, now);
  const points = visiblePoints(memory, online ? current : [], now, { offline: !online });
  const mode = mapMode({ online, count: points.length });
  const lastSeenAt = Object.values(memory).reduce<number | null>((m, p) => (m === null || p.lastSeen > m ? p.lastSeen : m), null);
  const banner: MapBanner | null = mode === 'offline' ? 'offline' : points.length && points.every(p => p.bearing === null) ? 'noDir' : null;

  // Conectar (só o Wi-Fi de um ponto Piu tem como; o resto o transporte conecta sozinho).
  const phase: ConnectPhase = !conn ? 'idle' : conn.pending ? 'link'
    : wifiPhase({ ssid: conn.ssid, joining: point.visitor.joining, joinedSsid: joined?.ssid ?? null, error: !!point.visitor.error, lanPeers: lan.peers.length, joinedAt: joined?.ssid === conn.ssid ? joined.at : null, now });
  const fast = !!conn && phase !== 'failed';
  useEffect(() => {
    if (!focused) return;
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 5000);
    return () => clearInterval(id);
  }, [focused, fast]);
  const [gained, setGained] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    if (!conn || conn.pending) return;
    if (phase === 'done') {
      const count = gainedCount(new Set(conn.before), pointsRef.current.filter(p => p.id !== conn.id));
      setGained(g => ({ ...g, [conn.id]: count }));
      setToast(t('map.toast', { name: conn.ssid, count }));
      setConn(null);
    } else if (phase === 'idle') setConn(null); // saiu do Wi-Fi por fora do app
  }, [conn, phase, t]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const onConnect = (id: string) => {
    const p = points.find(x => x.id === id);
    if (!p || p.kind !== 'wifi' || !p.connectable) return;
    const net = point.nearby.find(x => x.ssid === p.name);
    setConn({ id, ssid: p.name, before: points.filter(x => x.inRange).map(x => x.id), pending: true });
    void point.joinNet({ ssid: p.name, secure: net?.secure ?? true }).finally(() => setConn(c => (c && c.id === id ? { ...c, pending: false } : c)));
  };
  const onCancel = () => { setConn(null); void point.leave(); };
  const onDisconnect = (id: string) => { setGained(g => { const { [id]: _, ...rest } = g; return rest; }); void point.leave(); };
  const canDisconnect = (p: MapPoint) => p.kind === 'wifi' && joined?.ssid === p.name;
  const extraRows = (p: MapPoint): [string, string][] =>
    (p.kind === 'wifi' && joined?.ssid === p.name ? [[t('map.row.since'), fmtDate(joined.at, { hour: '2-digit', minute: '2-digit' })]] : []);

  // "Ligar" (offline): Bluetooth, Wi-Fi Direct e Wi-Fi local; sem permissão, pede de novo.
  const turnOn = () => {
    (['ble', 'direct', 'mesh'] as TxKey[]).forEach(k => { if (!n.tx[k]) n.toggleTx(k); });
    if (!granted.ble || !granted.nearby) void askPermission();
  };
  const [addStep, setAddStep] = useState<AddLoraStep | null>(null);
  const first = addLoraStep({ piu: !!piu, mesh: !!mesh, region: !!piu?.link.region });

  return {
    points, mode, located: false, lora: !!(meshUp || piuUp), loraMode: n.loraMode, now, banner,
    onBanner: mode === 'offline' ? turnOn : undefined, lastSeenAt,
    connect: conn ? { id: conn.id, phase } : null, onConnect, onCancel, onDisconnect, canDisconnect, gained, extraRows,
    radioName: piuUp ? piu?.status.device?.name ?? null : null, toast,
    onAddLora: first ? () => setAddStep(first) : undefined,
    paused: !focused,
    addLora: { step: addStep, setStep: setAddStep, loraOn: n.tx.lora, turnOnLora: () => { if (!n.tx.lora) n.toggleTx('lora'); }, askPermission: () => { void askPermission(); } },
  };
}
