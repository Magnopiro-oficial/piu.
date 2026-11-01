import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
import { getTransport, requestTransportPermissions, SERVICE_ID, type Peer, type TransportKind, type TransportState } from '../transport';
import { useNetwork } from './network';
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
  const { onboarded } = useStore();
  const { tx } = useNetwork();
  const [nodeName] = usePersisted('transport.nodeName', randomNodeName);
  const transport = useMemo(getTransport, []);
  const [state, setState] = useState<TransportState>('off');
  const [reason, setReason] = useState<string>();
  const [permission, setPermission] = useState<TransportCtx['permission']>('unknown');
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const enabled = onboarded && (tx.ble || tx.direct);

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
