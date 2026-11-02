import { router } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
import { getTransport, requestTransportPermissions, SERVICE_ID, type Peer, type TransportKind, type TransportState } from '../transport';
import { useBattery } from '../lib/battery';
import { useNetwork } from './network';
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

const randomNodeName = () => 'piu-' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');

/**
 * Liga o transporte P2P depois do onboarding, enquanto Bluetooth LE ou Wi-Fi Direct estiverem ativos
 * na aba Rede. Mantém a lista de vizinhos descobertos e conectados.
 */
export function TransportProvider({ children }: { children: ReactNode }) {
  const { onboarded, showToast } = useStore();
  const { tx, relay, relayPaused, battery } = useNetwork();
  const { bat } = useSettings();
  const [nodeName] = usePersisted('transport.nodeName', randomNodeName);
  const transport = useMemo(getTransport, []);
  const [state, setState] = useState<TransportState>('off');
  const [reason, setReason] = useState<string>();
  const [permission, setPermission] = useState<TransportCtx['permission']>('unknown');
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const enabled = onboarded && (tx.ble || tx.direct);

  // Meios ligados na aba Rede (BLE e Wi-Fi Direct/Nearby).
  useEffect(() => { transport.setMediaEnabled?.({ ble: tx.ble, nearby: tx.direct }); }, [transport, tx.ble, tx.direct]);
  // Retransmissão em segundo plano (Android, aviso fixo): Modo nó ligado, não pausado, transporte rodando
  // e "Retransmitir em segundo plano" ligado. No iPhone não tem efeito (só com o app aberto).
  useEffect(() => {
    void transport.setBackgroundRelay?.(relay && !relayPaused && bat.bg && state === 'running').catch(() => {});
  }, [transport, relay, relayPaused, bat.bg, state]);
  // Bateria abaixo do limite do usuário: prefere o meio que gasta menos (BLE).
  const { level, charging } = useBattery();
  useEffect(() => {
    transport.setPowerHint?.(level < 0 || charging === null ? null : !charging && level * 100 <= battery);
  }, [transport, level, charging, battery]);

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
        toastRef.current({ kind: 'network', icon: 'settings_input_antenna', title: 'Novo nó alcançável', body: `${p.name} · ${p.via === 'ble' ? 'Bluetooth LE' : p.via === 'nearby' ? 'Wi-Fi Direct' : 'por perto'}`, go: goNetwork });
      }
    }
    if (connected.length) hadPeers.current = true;
    else if (hadPeers.current && state === 'running') {
      hadPeers.current = false;
      toastRef.current({ kind: 'network', icon: 'portable_wifi_off', title: 'Você saiu da malha', body: 'Nenhum nó por perto. Mensagens ficam na fila até reencontrar um.', go: goNetwork });
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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTransport(): TransportCtx {
  const t = useContext(Ctx);
  if (!t) throw new Error('useTransport fora de TransportProvider');
  return t;
}
