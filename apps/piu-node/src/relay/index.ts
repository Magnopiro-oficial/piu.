import type { LnnpConfig } from '../config.js';
import type { KeyPair } from '../protocol/keys.js';
import type { Settings } from '../store.js';
import { type EngineOptions, RelayEngine } from './engine.js';
import { LanAdapter, type LanOptions } from './lan.js';
import { type Modem, openSerialModem, SerialAdapter, type SerialStats } from './serial.js';

export { inWindow, type LinkPort, RelayEngine, type RelayStats } from './engine.js';
export { loadNodeKey } from './identity.js';
export { LanAdapter } from './lan.js';
export { type Modem, SerialAdapter } from './serial.js';
export { RadioSim } from './radio-sim.js';

/** O que a API precisa do motor: estatísticas e aplicar os limites do operador. */
export interface RelayHandle {
  engine: RelayEngine;
  lan: LanAdapter;
  /** Rádios LoRa e cabos USB (`PIU_SERIAL`). */
  serial: SerialAdapter[];
  /** Porta TCP do enlace e UDP da descoberta (reais, úteis com porta 0). */
  port: number;
  discoveryPort: number | null;
  applySettings(s: Settings): void;
  stats(): ReturnType<RelayEngine['stats']> & { lan: { port: number; discoveryPort: number | null }; serial: SerialStats[] };
  close(): Promise<void>;
}

/** Sobe o motor de retransmissão com o adapter LAN. */
export async function startRelay(
  node: KeyPair, c: LnnpConfig, settings: Settings,
  extra: Partial<Pick<EngineOptions, 'identities' | 'now' | 'log'>> & Partial<Pick<LanOptions, 'tickMs' | 'handshakeTimeoutMs'>> & {
    /** Abre a porta serial (testes: rádio simulado). Padrão: a porta de verdade, por `stty`. */
    openModem?: (path: string, baud: number) => Promise<Modem>;
  } = {},
): Promise<RelayHandle> {
  const engine = new RelayEngine({ node, relay: c.relay, memoryBytes: c.memoryMB * 1024 ** 2, allow: c.allow, identities: extra.identities, now: extra.now, log: extra.log });
  engine.applySettings(settings);
  const lan = new LanAdapter(engine, {
    listen: c.listen, port: c.port, discoveryPort: c.discoveryPort, broadcast: c.broadcast, peers: c.peers, beaconMs: c.beaconMs,
    tickMs: extra.tickMs, handshakeTimeoutMs: extra.handshakeTimeoutMs,
  });
  const { port, discoveryPort } = await lan.start();
  const serial: SerialAdapter[] = [];
  for (const s of c.serial ?? []) {
    try {
      const modem = await (extra.openModem ?? openSerialModem)(s.path, s.baud);
      const l = c.lora;
      const a = new SerialAdapter(engine, s.kind === 'lora' && l
        ? { kind: 'lora', modem, radio: { sf: l.sf, bwKHz: l.bwKHz, cr: l.cr }, dutyPercent: l.dutyPercent, maxEnvelope: l.maxEnvelope, beaconMs: l.beaconMs }
        : { kind: s.kind, modem });
      a.start();
      serial.push(a);
      extra.log?.(`LNNP: ${s.kind === 'lora' ? 'rádio LoRa' : 'cabo USB'} em ${s.path} (${s.baud} bps)`);
    } catch (e) {
      // Porta ausente (rádio desligado do USB) não derruba o nó: o LAN continua.
      extra.log?.(`LNNP: não abriu ${s.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return {
    engine, lan, serial, port, discoveryPort,
    applySettings: s => engine.applySettings(s),
    stats: () => ({ ...engine.stats(), lan: { port, discoveryPort }, serial: serial.map(a => a.stats()) }),
    close: async () => { await Promise.all(serial.map(a => a.stop())); await lan.stop(); },
  };
}
