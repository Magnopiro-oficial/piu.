/**
 * Controle da rede local para o app (state/transport.tsx): liga/desliga o `LnnpLanEngine` com a chave
 * do nó do dia, repassa os enlaces para `composite.ts` e expõe estado, vizinhos, vizinho manual (QR) e
 * o teste de compatibilidade. Sem módulo nativo (iPhone, web, Expo Go): `available = false`.
 */
import type { KeyPair } from '../../protocol/keys';
import type { LinkEvent } from '../multi';
import { parseLanPeer } from './addr';
import { LnnpLanEngine, type DiscoveryStats, type LanEngineOptions, type LanPeerInfo, type LanState, type ManualPeerInfo } from './engine';
import { runLanCheck, type LanCheckResult } from './lanCheck';
import { NO_WIFI, type LanSocketApi, type WifiInfo } from './types';

export interface LanStatus {
  available: boolean;
  state: LanState;
  reason?: string;
  wifi: WifiInfo;
  port: number;
  peers: LanPeerInfo[];
  manual: ManualPeerInfo[];
  stats: DiscoveryStats;
}

export interface LanController {
  readonly available: boolean;
  /** Enlaces (meio `lan`) para `composite.ts`. */
  subscribe(fn: (e: LinkEvent) => void): () => void;
  send(id: string, data: Uint8Array): Promise<void>;
  start(o: { node: KeyPair; name: string; relay: boolean }): Promise<void>;
  stop(): Promise<void>;
  status(): LanStatus;
  /** Qualquer mudança de estado, vizinhos ou Wi-Fi (para a tela). */
  onChange(fn: () => void): () => void;
  networkInfo(): Promise<WifiInfo>;
  setNode(node: KeyPair): void;
  setRelay(relay: boolean): void;
  setLowPower(low: boolean): void;
  /** Vizinho manual (QR do ponto): valida e devolve a forma canônica; lança se inválido. */
  addPeer(raw: string): string;
  removePeer(address: string): boolean;
  runLanCheck(o?: { knownPeer?: string; scan?: boolean; listenMs?: number }): Promise<LanCheckResult>;
}

const EMPTY_STATS: DiscoveryStats = { broadcast: 0, mdns: 0, scan: 0, links: 0, scanning: false, lastScanAt: null };

export function createLanController(api: LanSocketApi | null, opts: Partial<LanEngineOptions> = {}): LanController {
  const links = new Set<(e: LinkEvent) => void>();
  const changes = new Set<() => void>();
  const changed = () => changes.forEach(fn => { try { fn(); } catch { /* ouvinte */ } });
  let engine: LnnpLanEngine | null = null;
  let wifi: WifiInfo = NO_WIFI;
  let relay = false, lowPower = false;
  const manual: string[] = [];

  // O Wi-Fi é observado sempre (mesmo com o LAN desligado): é o que decide ligar.
  api?.subscribe(e => { if (e.type === 'network') { wifi = e.info; changed(); } });

  const ensure = (node: KeyPair, name: string) => {
    if (!api) throw new Error('Rede local indisponível neste aparelho.');
    if (!engine) {
      engine = new LnnpLanEngine({ ...opts, api, node, name, relay });
      engine.subscribe(e => { links.forEach(fn => fn(e)); if (e.type !== 'data') changed(); }); // envelope não muda a tela
      for (const a of manual) engine.addPeer(a);
    } else { engine.setNode(node); engine.setName(name); }
    engine.setRelay(relay);
    engine.setLowPower(lowPower);
    return engine;
  };

  return {
    available: !!api,
    subscribe: fn => { links.add(fn); return () => { links.delete(fn); }; },
    send: async (id, data) => { if (!engine) throw new Error('Rede local desligada.'); await engine.send(id, data); },
    start: async ({ node, name, relay: r }) => {
      relay = r;
      const e = ensure(node, name);
      await e.start();
      wifi = e.wifi;
      changed();
    },
    stop: async () => { await engine?.stop(); changed(); },
    status: () => ({
      available: !!api,
      state: engine?.state ?? (api ? 'off' : 'unavailable'),
      reason: engine?.reason ?? (api ? undefined : 'Rede local só no Android com o app instalado (não no Expo Go nem no iPhone).'),
      wifi,
      port: engine?.port ?? 0,
      peers: engine?.peers() ?? [],
      manual: engine?.manualPeers() ?? manual.map(address => ({ address, state: 'connecting' as const, error: null, nodeId: null, attempts: 0 })),
      stats: engine?.discoveryStats() ?? EMPTY_STATS,
    }),
    onChange: fn => { changes.add(fn); return () => { changes.delete(fn); }; },
    networkInfo: async () => {
      if (!api) return NO_WIFI;
      wifi = await api.networkInfo().catch(() => NO_WIFI);
      return wifi;
    },
    setNode: node => engine?.setNode(node),
    setRelay: r => { relay = r; engine?.setRelay(r); },
    setLowPower: low => { lowPower = low; engine?.setLowPower(low); },
    addPeer: raw => {
      const a = parseLanPeer(raw);
      if (!a) throw new Error('Endereço inválido: use IP:porta de rede local (ex.: 192.168.1.20:8422).');
      if (engine) engine.addPeer(a);
      else if (!manual.includes(a)) manual.push(a);
      changed();
      return a;
    },
    removePeer: address => {
      const i = manual.indexOf(address);
      if (i >= 0) manual.splice(i, 1);
      const ok = (engine?.removePeer(address) ?? false) || i >= 0;
      changed();
      return ok;
    },
    runLanCheck: async (o = {}) => {
      if (!api) throw new Error('Rede local indisponível neste aparelho.');
      return runLanCheck({ api, engine, ...o });
    },
  };
}
