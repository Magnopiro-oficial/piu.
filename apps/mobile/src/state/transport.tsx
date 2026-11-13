import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getCore, nodeNameSecret } from '../core';
import { screenLan } from '../core/node';
import { loraMedia } from '../lib/piuLora';
import type { MediaGrants } from '../transport/grants';
import { askTransportPermissionsAgain, DISCOVERY_INTERVAL_SEC, requestTransportPermissions, type Peer, type TransportKind, type TransportState } from '../transport';
import type { LanStatus } from '../transport/lan/controller';
import type { LanCheckResult } from '../transport/lan/lanCheck';
import { lanLowPower, lanWanted, type LanOffReason } from '../transport/lan/policy';
import type { WifiInfo } from '../transport/lan/types';
import { useT } from '../i18n';
import { useBattery } from '../lib/battery';
import { usePointRuntime } from '../lib/pointBridge';
import { screenListening, shouldBackground } from './background';
import { useKeys } from './keys';
import { useNetwork } from './network';
import { useRelayBattery } from './phoneNodeEffects';
import { useSettings } from './settings';
import { useStore } from './store';

interface TransportCtx {
  kind: TransportKind;
  state: TransportState;
  reason?: string;
  /** `partial`: só parte dos meios liberada (ex.: Bluetooth sim, Wi-Fi Direct não). */
  permission: 'unknown' | 'granted' | 'partial' | 'denied';
  /** Meios que as permissões do sistema liberam agora (a aba Rede mostra "Sem permissão" na linha). */
  granted: MediaGrants;
  /** Pede as permissões de novo (ou abre os ajustes do app) e religa o transporte com o que vier. */
  askPermission(): Promise<void>;
  peers: Peer[];
  /** Identificador curto deste nó, anunciado aos vizinhos (não é a identidade pública). Troca a cada dia UTC. */
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

/**
 * Ajustes do transporte P2P e da rede local para o núcleo (core/node.ts), que liga depois do onboarding,
 * enquanto Bluetooth LE ou Wi-Fi Direct estiverem ativos na aba Rede, e guarda os vizinhos.
 * Desmontar (deslizar o app dos recentes) não para nada: o núcleo segue recebendo sem a tela.
 * As permissões continuam aqui: o pedido do sistema só aparece com a Activity.
 */
export function TransportProvider({ children }: { children: ReactNode }) {
  const { onboarded, showToast } = useStore();
  const { tx, toggleTx, relay, relayPaused, battery: userBattery, loraMode, piuRegion, receiveClosed } = useNetwork();
  const t = useT();
  const { nodeKeyFor } = useKeys();
  const battery = useRelayBattery(userBattery); // modo nó do celular: pausa em 30% no mínimo
  const { bat } = useSettings();
  const core = useMemo(getCore, []);
  const transport = core.transport;
  // Um dono só configura o núcleo; uma segunda árvore viva só lê (o erro vai para o log).
  const owns = useRef(false);
  useEffect(() => { const release = core.claimRuntime('TransportProvider'); owns.current = !!release; return () => { owns.current = false; release?.(); }; }, [core]);
  // Nome anunciado em claro (BLE/Nearby): não é mais fixo. Sai de um segredo local e do dia UTC
  // (lib/nodeName.ts), como a chave do nó; o segredo fica só no aparelho. Virou o dia, o núcleo religa.
  // O dono do segredo é o núcleo (core/index.ts): depois do onboarding, a tela lê o salvo (ou o cria) por ele.
  useEffect(() => {
    if (!owns.current || !onboarded) return;
    let alive = true;
    void nodeNameSecret().then(nameSecret => { if (alive && owns.current) core.configure({ nameSecret }); });
    return () => { alive = false; };
  }, [core, onboarded]);
  // Estado, motivo, vizinhos e nome do dia vêm do núcleo (sobrevivem ao desmonte da tela).
  const { state, reason, peers, nodeName } = useSyncExternalStore(core.subscribe, core.status);
  const [permission, setPermission] = useState<TransportCtx['permission']>('unknown');
  const enabled = onboarded && (tx.ble || tx.direct);
  /** Meios que as permissões do sistema liberam (cada um à parte: negar o Wi-Fi não desliga o Bluetooth). */
  const [granted, setGranted] = useState<MediaGrants>({ ble: true, nearby: true });
  /** Muda quando a pessoa libera a permissão pela aba Rede: o transporte religa. */
  const [permEpoch, setPermEpoch] = useState(0);

  // "Procurar vizinhos" (Bateria e limites → DESCOBERTA): intervalo de varredura no transporte (NFR-004).
  useEffect(() => { transport.setDiscoveryInterval?.(DISCOVERY_INTERVAL_SEC[bat.disc]); }, [transport, bat.disc]);
  // Meios ligados na aba Rede (BLE e Wi-Fi Direct/Nearby).
  useEffect(() => { transport.setMediaEnabled?.({ ble: tx.ble && granted.ble, nearby: tx.direct && granted.nearby, ...loraMedia(loraMode, tx.lora) }); }, [transport, tx.ble, tx.direct, tx.lora, loraMode, granted]);
  // Região do rádio do Piu escolhida pela pessoa (sem escolha, o rádio não transmite: native.ts).
  useEffect(() => { if (piuRegion && transport.piulora?.link.status().region !== piuRegion) transport.piulora?.link.setRegion(piuRegion).catch(() => {}); }, [transport, piuRegion]);
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
  // Serviço em primeiro plano (Android, aviso fixo; state/background.ts): Modo nó em segundo plano, Ponto Piu
  // ativo (state/point.tsx) ou "Receber com o app fechado". No iPhone não tem efeito (só com o app aberto).
  // Só para "Receber com o app fechado", o aviso diz isso no idioma da pessoa (o do Modo nó segue o de sempre).
  const pointRt = usePointRuntime();
  const relayBg = relay && !relayPaused && bat.bg && state === 'running';
  const listening = screenListening({ p2p: enabled && permission !== 'denied', hasLan: !!lan, lanOn: lanWant.on, wifi });
  const background = shouldBackground({ relay, relayPaused, bg: bat.bg, state, point: pointRt.background, receiveClosed, listening });
  const noticeTitle = relayBg || pointRt.background ? null : t('network.receiveClosed.notice.title');
  const noticeText = t('network.receiveClosed.notice.text');
  useEffect(() => {
    if (background === undefined) return; // sem opinião ainda (Wi-Fi não lido): fica como o núcleo deixou
    void transport.setBackgroundRelay?.(background, noticeTitle ? { title: noticeTitle, text: noticeText } : undefined).catch(() => {});
  }, [transport, background, noticeTitle, noticeText]);
  // Desmontar (deslizar o app dos recentes): sem a tela só o Ponto retransmite (`detach` em messaging.tsx),
  // então a rede local deixa de anunciar "retransmito" e o aviso do Modo nó passa ao de receber com o app fechado.
  const detachNotice = useRef<{ title: string; text: string } | null>(null);
  detachNotice.current = background === true && relayBg && !pointRt.background ? { title: t('network.receiveClosed.notice.title'), text: noticeText } : null;
  const pointRelay = useRef(pointRt.relay); pointRelay.current = pointRt.relay;
  useEffect(() => () => {
    transport.lan?.setRelay(pointRelay.current);
    const n = detachNotice.current;
    if (n) void transport.setBackgroundRelay?.(true, n).catch(() => {});
  }, [transport]);
  const relayNow = relay && !relayPaused;
  const relayRef = useRef(relayNow); relayRef.current = relayNow;
  const wifiIp = wifi?.ip ?? null;
  const wifiKnown = wifi !== null;
  // Outro Wi-Fi (IP novo) religa: os soquetes ficam presos à rede em que foram abertos (core/node.ts).
  // Ao montar, até o primeiro `networkInfo()` a tela não opina (não derruba a LAN que o núcleo mantinha).
  useEffect(() => {
    if (!owns.current) return;
    const lanCfg = screenLan({ hasLan: !!lan, want: lanWant.on, wifi, nodeKeyFor, relay: relayRef.current });
    if (lanCfg !== undefined) core.configure({ lan: lanCfg });
  }, [core, lan, lanWant.on, nodeKeyFor, wifiIp, wifiKnown]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Permissão pedida de novo pela aba Rede: religa mesmo com o mesmo nome (o que mudou foi o sistema).
  const seenEpoch = useRef(permEpoch);
  useEffect(() => {
    if (!owns.current) return;
    if (!enabled) { core.configure({ p2p: false }); return; }
    let cancelled = false;
    (async () => {
      const g = await requestTransportPermissions();
      if (cancelled) return;
      setGranted(g);
      // Liga o que foi liberado e está ligado na aba Rede; só fica indisponível se nenhum dos dois puder.
      const usable = (tx.ble && g.ble) || (tx.direct && g.nearby);
      setPermission(g.ble && g.nearby ? 'granted' : g.ble || g.nearby ? 'partial' : 'denied');
      if (!usable) { core.configure({ p2p: false }); core.markUnavailable(g.ble ? 'Permissão de dispositivos Wi-Fi por perto negada (Wi-Fi Direct). Ligue o Bluetooth LE na aba Rede.' : 'Permissões de Bluetooth negadas.'); return; }
      transport.setMediaEnabled?.({ ble: tx.ble && g.ble, nearby: tx.direct && g.nearby, ...loraMedia(loraMode, tx.lora) });
      const restartP2p = seenEpoch.current !== permEpoch;
      seenEpoch.current = permEpoch;
      core.configure({ p2p: true }, { restartP2p });
    })();
    return () => { cancelled = true; };
  }, [enabled, core, transport, permEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
  const askPermission = useCallback(async () => {
    const g = await askTransportPermissionsAgain();
    setGranted(g);
    setPermEpoch(e => e + 1);
  }, []);

  const value = useMemo<TransportCtx>(() => ({ kind: transport.kind, state, reason, permission, granted, askPermission, peers: Object.values(peers), nodeName }),
    [transport.kind, state, reason, permission, granted, askPermission, peers, nodeName]);
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
