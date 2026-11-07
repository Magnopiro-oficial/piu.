import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
import { DISCOVERY_INTERVAL_SEC, getTransport, requestTransportPermissions, SERVICE_ID, type Peer, type TransportKind, type TransportState } from '../transport';
import type { LanStatus } from '../transport/lan/controller';
import type { LanCheckResult } from '../transport/lan/lanCheck';
import { lanLowPower, lanWanted, type LanOffReason } from '../transport/lan/policy';
import type { WifiInfo } from '../transport/lan/types';
import { useBattery } from '../lib/battery';
import { usePointRuntime } from '../lib/pointBridge';
import { nodeDayOf, useKeys } from './keys';
import { useNetwork } from './network';
import { useRelayBattery } from './phoneNodeEffects';
import { useSettings } from './settings';
import { useStore } from './store';

interface TransportCtx {
  kind: TransportKind;
  state: TransportState;
  reason?: string;
  permission: 'unknown' | 'granted' | 'denied';
  peers: Peer[];
  /** Identificador curto deste nó, anunciado aos vizinhos (não é a identidade pública). */
  nodeName: string;
}

const Ctx = createContext<TransportCtx | null>(null);

/**
 * Rede local (LNNP pelo Wi-Fi conectado; docs/rede/pontos-piu-roteadores.md, fase 1). Sem tela própria
 * ainda: a linha "Wi-Fi Mesh" da aba Rede liga/desliga (`enabled`), o resto é para as telas futuras
 * (estado, vizinhos, QR do ponto e o teste do assistente "Criar ponto Piu").
 */
export interface LanCtx extends LanStatus {
  /** Chave da aba Rede (de fábrica: ligada). */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Ligada agora (chave + Wi-Fi + chaves carregadas). */
  active: boolean;
  /** Por que não está ligada (`null` = ligada). */
  offReason: LanOffReason | null;
  /** Modo econômico (bateria abaixo do limite fora da tomada): anúncio devagar, sem varredura. */
  lowPower: boolean;
  /** Vizinho manual `IP:porta` (QR do ponto). Lança com endereço inválido. */
  addPeer: (raw: string) => string;
  removePeer: (address: string) => boolean;
  /** Teste de compatibilidade da rede (assistente "Criar ponto Piu"). */
  runLanCheck: (o?: { knownPeer?: string; scan?: boolean; listenMs?: number }) => Promise<LanCheckResult>;
}

const LanContext = createContext<LanCtx | null>(null);

const randomNodeName = () => 'piu-' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');

/**
 * Liga o transporte P2P depois do onboarding, enquanto Bluetooth LE ou Wi-Fi Direct estiverem ativos
 * na aba Rede. Mantém a lista de vizinhos descobertos e conectados.
 */
export function TransportProvider({ children }: { children: ReactNode }) {
  const { onboarded, showToast } = useStore();
  const { tx, toggleTx, relay, relayPaused, battery: userBattery } = useNetwork();
  const { nodeKeyFor } = useKeys();
  const battery = useRelayBattery(userBattery); // modo nó do celular: pausa em 30% no mínimo
  const { bat } = useSettings();
  const [nodeName] = usePersisted('transport.nodeName', randomNodeName);
  const transport = useMemo(getTransport, []);
  const [state, setState] = useState<TransportState>('off');
  const [reason, setReason] = useState<string>();
  const [permission, setPermission] = useState<TransportCtx['permission']>('unknown');
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const enabled = onboarded && (tx.ble || tx.direct);

  // "Procurar vizinhos" (Bateria e limites → DESCOBERTA): intervalo de varredura no transporte (NFR-004).
  useEffect(() => { transport.setDiscoveryInterval?.(DISCOVERY_INTERVAL_SEC[bat.disc]); }, [transport, bat.disc]);
  // Meios ligados na aba Rede (BLE e Wi-Fi Direct/Nearby).
  useEffect(() => { transport.setMediaEnabled?.({ ble: tx.ble, nearby: tx.direct }); }, [transport, tx.ble, tx.direct]);
  // Retransmissão em segundo plano (Android, aviso fixo): Modo nó ligado, não pausado, transporte rodando
  // e "Retransmitir em segundo plano" ligado. No iPhone não tem efeito (só com o app aberto).
  // Ponto Piu ativo (state/point.tsx): o serviço fica ligado mesmo só com o Wi-Fi local (sem Bluetooth).
  const pointRt = usePointRuntime();
  useEffect(() => {
    void transport.setBackgroundRelay?.((relay && !relayPaused && bat.bg && state === 'running') || pointRt.background).catch(() => {});
  }, [transport, relay, relayPaused, bat.bg, state, pointRt.background]);
  // Bateria abaixo do limite do usuário: prefere o meio que gasta menos (BLE).
  const { level, charging } = useBattery();
  useEffect(() => {
    transport.setPowerHint?.(level < 0 || charging === null ? null : !charging && level * 100 <= battery);
  }, [transport, level, charging, battery]);

  // ── Rede local (Wi-Fi) ─────────────────────────────────────
  const lan = transport.lan ?? null;
  const [lanStatus, setLanStatus] = useState<LanStatus | null>(() => lan?.status() ?? null);
  const [wifi, setWifi] = useState<WifiInfo | null>(null);
  useEffect(() => {
    if (!lan) return;
    let alive = true;
    void lan.networkInfo().then(w => { if (alive) { setWifi(w); setLanStatus(lan.status()); } });
    const off = lan.onChange(() => { const st = lan.status(); setLanStatus(st); setWifi(st.wifi); });
    return () => { alive = false; off(); };
  }, [lan]);
  const lanWant = lanWanted({ available: !!lan?.available, onboarded, hasNode: !!nodeKeyFor, pref: tx.mesh, wifi });
  const relayNow = relay && !relayPaused;
  const relayRef = useRef(relayNow); relayRef.current = relayNow;
  const wifiIp = wifi?.ip ?? null;
  useEffect(() => {
    if (!lan || !lanWant.on || !nodeKeyFor) return;
    // Chave técnica do nó do dia (gira à meia-noite UTC, como a do mensageiro): conferida de hora em hora.
    void lan.start({ node: nodeKeyFor(nodeDayOf(Date.now())), name: nodeName, relay: relayRef.current }).catch(() => {});
    const t = setInterval(() => lan.setNode(nodeKeyFor(nodeDayOf(Date.now()))), 3_600_000);
    // Outro Wi-Fi (IP novo) religa: os soquetes ficam presos à rede em que foram abertos.
    return () => { clearInterval(t); void lan.stop(); };
  }, [lan, lanWant.on, nodeKeyFor, nodeName, wifiIp]);
  // Modo nó pausado (bateria/tomada): anúncio e handshake dizem "não retransmito".
  useEffect(() => { lan?.setRelay(relayNow); }, [lan, relayNow]);
  const lanLow = lanLowPower({ level, charging, limitPct: battery });
  useEffect(() => { lan?.setLowPower(lanLow); }, [lan, lanLow]);
  const setLanEnabled = useCallback((on: boolean) => { if (on !== tx.mesh) toggleTx('mesh'); }, [tx.mesh, toggleTx]);

  // Banners de rede (Ajustes → Notificações → Rede e nós): novo nó e saída da malha.
  const startedAt = useRef(0);
  const known = useRef(new Set<string>());
  const lastNodeBanner = useRef(0);
  const hadPeers = useRef(false);
  const toastRef = useRef(showToast); toastRef.current = showToast;
  const goNetwork = () => router.push('/(tabs)/network');
  useEffect(() => {
    if (state === 'running') startedAt.current = Date.now();
    else { known.current.clear(); hadPeers.current = false; }
  }, [state]);
  useEffect(() => {
    const connected = Object.values(peers).filter(p => p.connected);
    for (const p of Object.values(peers)) {
      if (known.current.has(p.id)) continue;
      known.current.add(p.id);
      // Os vizinhos da primeira busca não viram banner; depois, no máximo um por minuto.
      const now = Date.now();
      if (state === 'running' && now - startedAt.current > 10_000 && now - lastNodeBanner.current > 60_000) {
        lastNodeBanner.current = now;
        toastRef.current({ kind: 'network', href: '/(tabs)/network', icon: 'settings_input_antenna', title: 'Novo nó alcançável', body: `${p.name} · ${p.via === 'ble' ? 'Bluetooth LE' : p.via === 'nearby' ? 'Wi-Fi Direct' : p.via === 'lan' ? 'Wi-Fi local' : 'por perto'}`, go: goNetwork });
      }
    }
    if (connected.length) hadPeers.current = true;
    else if (hadPeers.current && state === 'running') {
      hadPeers.current = false;
      toastRef.current({ kind: 'network', href: '/(tabs)/network', icon: 'portable_wifi_off', title: 'Você saiu da malha', body: 'Nenhum nó por perto. Mensagens ficam na fila até reencontrar um.', go: goNetwork });
    }
  }, [peers, state]);

  useEffect(() => transport.subscribe(e => {
    switch (e.type) {
      case 'state': setState(e.state); setReason(e.reason); if (e.state === 'off') setPeers({}); break;
      case 'peerFound': setPeers(p => ({ ...p, [e.peer.id]: { ...e.peer, connected: p[e.peer.id]?.connected ?? false } })); break;
      case 'peerLost': setPeers(p => { const { [e.id]: _gone, ...rest } = p; return rest; }); break;
      case 'connected': setPeers(p => ({ ...p, [e.id]: { id: e.id, name: e.name ?? p[e.id]?.name ?? e.id, via: p[e.id]?.via ?? transport.kind, connected: true } })); break;
      case 'disconnected': setPeers(p => (p[e.id] ? { ...p, [e.id]: { ...p[e.id], connected: false } } : p)); break;
      case 'envelope': break; // a camada de mensagens (LNNP) consome isto quando a criptografia entrar
    }
  }), [transport]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const perm = await requestTransportPermissions();
      if (cancelled) return;
      setPermission(perm);
      if (perm !== 'granted') { setState('unavailable'); setReason('Permissões de Bluetooth e Wi-Fi negadas.'); return; }
      await transport.start(nodeName, SERVICE_ID).catch((err: unknown) => { setState('unavailable'); setReason(String((err as Error)?.message ?? err)); });
    })();
    return () => { cancelled = true; void transport.stop(); };
  }, [enabled, nodeName, transport]);

  const value = useMemo<TransportCtx>(() => ({ kind: transport.kind, state, reason, permission, peers: Object.values(peers), nodeName }),
    [transport.kind, state, reason, permission, peers, nodeName]);
  const lanValue = useMemo<LanCtx>(() => {
    const st: LanStatus = lanStatus ?? { available: false, state: 'unavailable', wifi: wifi ?? { connected: false, internet: false, ip: null, prefix: null, gateway: null }, port: 0, peers: [], manual: [], stats: { broadcast: 0, mdns: 0, scan: 0, links: 0, scanning: false, lastScanAt: null } };
    return {
      ...st,
      enabled: tx.mesh, setEnabled: setLanEnabled, active: lanWant.on, offReason: lanWant.reason, lowPower: lanLow,
      addPeer: raw => { if (!lan) throw new Error('Rede local indisponível neste aparelho.'); return lan.addPeer(raw); },
      removePeer: a => lan?.removePeer(a) ?? false,
      runLanCheck: o => { if (!lan) return Promise.reject(new Error('Rede local indisponível neste aparelho.')); return lan.runLanCheck(o); },
    };
  }, [lan, lanStatus, wifi, tx.mesh, setLanEnabled, lanWant.on, lanWant.reason, lanLow]);
  return <Ctx.Provider value={value}><LanContext.Provider value={lanValue}>{children}</LanContext.Provider></Ctx.Provider>;
}

/** Rede local (Wi-Fi): estado, vizinhos, chave e teste de compatibilidade. Ver `LanCtx`. */
export function useLanTransport(): LanCtx {
  const l = useContext(LanContext);
  if (!l) throw new Error('useLanTransport fora de TransportProvider');
  return l;
}

export function useTransport(): TransportCtx {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTransport fora de TransportProvider');
  return t;
}
