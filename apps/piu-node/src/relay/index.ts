import type { LnnpConfig } from '../config.js';
import type { KeyPair } from '../protocol/keys.js';
import type { Settings } from '../store.js';
import { type EngineOptions, RelayEngine } from './engine.js';
import { LanAdapter, type LanOptions } from './lan.js';

export { inWindow, type LinkPort, RelayEngine, type RelayStats } from './engine.js';
export { loadNodeKey } from './identity.js';
export { LanAdapter } from './lan.js';

/** O que a API precisa do motor: estatísticas e aplicar os limites do operador. */
export interface RelayHandle {
  engine: RelayEngine;
  lan: LanAdapter;
  /** Porta TCP do enlace e UDP da descoberta (reais, úteis com porta 0). */
  port: number;
  discoveryPort: number | null;
  applySettings(s: Settings): void;
  stats(): ReturnType<RelayEngine['stats']> & { lan: { port: number; discoveryPort: number | null } };
  close(): Promise<void>;
}

/** Sobe o motor de retransmissão com o adapter LAN. */
export async function startRelay(
  node: KeyPair, c: LnnpConfig, settings: Settings,
  extra: Partial<Pick<EngineOptions, 'identities' | 'now' | 'log'>> & Partial<Pick<LanOptions, 'tickMs' | 'handshakeTimeoutMs'>> = {},
): Promise<RelayHandle> {
  const engine = new RelayEngine({ node, relay: c.relay, memoryBytes: c.memoryMB * 1024 ** 2, allow: c.allow, identities: extra.identities, now: extra.now, log: extra.log });
  engine.applySettings(settings);
  const lan = new LanAdapter(engine, {
    listen: c.listen, port: c.port, discoveryPort: c.discoveryPort, broadcast: c.broadcast, peers: c.peers, beaconMs: c.beaconMs,
    tickMs: extra.tickMs, handshakeTimeoutMs: extra.handshakeTimeoutMs,
  });
  const { port, discoveryPort } = await lan.start();
  return {
    engine, lan, port, discoveryPort,
    applySettings: s => engine.applySettings(s),
    stats: () => ({ ...engine.stats(), lan: { port, discoveryPort } }),
    close: () => lan.stop(),
  };
}
