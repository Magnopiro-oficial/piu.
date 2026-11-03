import type { LnnpConfig } from '../config.js';
import type { KeyPair } from '../protocol/keys.js';
import type { Settings } from '../store.js';
import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../fsutil.js';
import { toHex } from '../protocol/bytes.js';
import { type DeviceLimits, type EngineOptions, type OperatorTrust, type OperatorTrustState, RelayEngine } from './engine.js';
import { type CertJson, certFromJson, certToJson, type ListJson, listFromJson, listToJson, type PolicyJson, policyFromJson, policyToJson, unhex } from './operator-frames.js';
import { RelayHistory, SAMPLE_MS } from './history.js';
import { LanAdapter, type LanOptions, type PeerStatus } from './lan.js';
import { loadSnapshot, saveSnapshot, storeKey } from './persist.js';
import { type Modem, openSerialModem, SerialAdapter, type SerialStats } from './serial.js';

export { type DeviceLimits, inWindow, type LinkPort, RelayEngine, type RelayStats } from './engine.js';
export { loadNodeKey } from './identity.js';
export { LanAdapter, MAX_RUNTIME_PEERS, parsePeerAddress, type PeerStatus } from './lan.js';
export { confirmCode } from './confirm.js';
export { type Modem, SerialAdapter } from './serial.js';
export { RadioSim } from './radio-sim.js';
export { dayKey, RelayHistory } from './history.js';

/** O que a API precisa do motor: estatísticas e aplicar os limites do operador. */
export interface RelayHandle {
  engine: RelayEngine;
  lan: LanAdapter;
  /** Rádios LoRa e cabos USB (`PIU_SERIAL`). */
  serial: SerialAdapter[];
  /** Porta TCP do enlace e UDP da descoberta (reais, úteis com porta 0). */
  port: number;
  discoveryPort: number | null;
  /** Limites globais do dono e, se houver, as regras do próprio equipamento (`Device.limits`). */
  applySettings(s: Settings, device?: DeviceLimits | null): void;
  /** Pausar retransmissão (o equipamento que serve o painel, em Equipamentos). */
  setPaused(paused: boolean): void;
  /** Operador dono do nó: linhagem de chaves, certificados e lista de revogação (aplica e sincroniza). */
  setOperator(t: Partial<OperatorTrust>): void;
  /** Histórico das estatísticas (amostras de 24 h e totais por dia), guardado no `data/`. */
  history(): ReturnType<RelayHistory['view']>;
  /** Recibos guardados para o validador (só horário e se são deste nó). */
  receipts(): ReturnType<RelayEngine['receiptsView']>;
  /** Fecha uma rodada do histórico agora (também roda sozinho a cada `sampleMs`). */
  sample(): void;
  /** Grava agora o armazenamento de mensagens, se mudou (também roda sozinho e ao desligar). */
  persist(): void;
  /** Vizinhos fixos (configuração e painel) e o estado de cada um. */
  peers(): PeerStatus[];
  /** Vizinho fixo adicionado pelo painel (endereço já validado por `parsePeerAddress`): conecta sem reiniciar. */
  addPeer(address: string): void;
  /** Tira um vizinho adicionado pelo painel (`false` se não era um deles). */
  removePeer(address: string): boolean;
  /** Espera o handshake com o vizinho fixo terminar (ou falhar), até `ms`. */
  waitPeer(address: string, ms: number, from?: number): Promise<PeerStatus | null>;
  /** O endereço veio de `PIU_LNNP_PEERS` (não sai pelo painel)? */
  isConfigPeer(address: string): boolean;
  stats(): ReturnType<RelayEngine['stats']> & { lan: { port: number; discoveryPort: number | null; peers: PeerStatus[] }; serial: SerialStats[] };
  close(): Promise<void>;
}

/** Sobe o motor de retransmissão com o adapter LAN. */
export async function startRelay(
  node: KeyPair, c: LnnpConfig, settings: Settings,
  extra: Partial<Pick<EngineOptions, 'identities' | 'now' | 'log' | 'reportMs'>> & Partial<Pick<LanOptions, 'tickMs' | 'handshakeTimeoutMs'>> & {
    /** Abre a porta serial (testes: rádio simulado). Padrão: a porta de verdade, por `stty`. */
    openModem?: (path: string, baud: number) => Promise<Modem>;
    /** Arquivo do histórico (`<data>/relay-history.json`). Ausente: só em memória (testes). */
    historyFile?: string | null;
    /** Envelopes guardados, ids vistos e recibos (`<data>/lnnp/relay-store.bin`). Ausente: só em memória. */
    storeFile?: string | null;
    /** Intervalo para salvar o armazenamento quando algo mudou (ms). Padrão: 30 s. */
    persistMs?: number;
    /** O que o nó aprendeu do operador pela malha (`<data>/lnnp/operator-trust.json`). Ausente: só em memória. */
    trustFile?: string | null;
  } = {},
): Promise<RelayHandle> {
  const trustFile = extra.trustFile ?? null;
  const engine = new RelayEngine({
    node, relay: c.relay, memoryBytes: c.memoryMB * 1024 ** 2, allow: c.allow, identities: extra.identities, now: extra.now, log: extra.log, reportMs: extra.reportMs,
    onOperatorChange: st => { if (trustFile) { try { saveTrust(trustFile, st); } catch (e) { extra.log?.(`LNNP: confiança do operador não gravada (${e instanceof Error ? e.message : e})`); } } },
  });
  if (trustFile) { const st = loadTrust(trustFile, extra.log); if (st) engine.loadOperatorState(st); }
  engine.applySettings(settings);
  // Mensagens guardadas antes do reinício voltam antes de o primeiro vizinho conectar.
  const storeFile = extra.storeFile ?? null;
  const key = storeKey(node);
  if (storeFile) {
    const snap = loadSnapshot(storeFile, key, engine.router.limits.maxBytes, extra.log);
    if (snap) {
      const r = engine.importState(snap);
      extra.log?.(`LNNP: ${r.envelopes} mensagens guardadas e ${r.receipts} recibos restaurados do armazenamento local`);
    }
  }
  let savedAt = engine.changes;
  const persist = () => {
    if (!storeFile || engine.changes === savedAt) return;
    try { const c = engine.changes; saveSnapshot(storeFile, engine.exportState(), key, Date.now()); savedAt = c; }
    catch (e) { extra.log?.(`LNNP: armazenamento de mensagens não gravado (${e instanceof Error ? e.message : e})`); }
  };
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
  const sampleMs = c.sampleMs ?? SAMPLE_MS;
  const history = new RelayHistory(extra.historyFile ?? null, extra.now);
  const sample = () => {
    try {
      const st = engine.router.stats();
      history.record(engine.counters, { neighbors: engine.linkCount, storedBytes: st.bytes });
    } catch (e) {
      extra.log?.(`LNNP: histórico não gravado (${e instanceof Error ? e.message : e})`);
    }
  };
  const timer = setInterval(sample, sampleMs);
  timer.unref();
  const persistTimer = setInterval(persist, extra.persistMs ?? c.persistMs ?? 30_000);
  persistTimer.unref();
  return {
    engine, lan, serial, port, discoveryPort,
    applySettings: (s, d) => engine.applySettings(s, d),
    setPaused: p => engine.setPaused(p),
    setOperator: t => { engine.setOperator(t); if (trustFile) { try { saveTrust(trustFile, engine.operatorState()); } catch { /* gravado na próxima mudança */ } } },
    history: () => history.view(sampleMs, engine.counters),
    receipts: () => engine.receiptsView(),
    sample, persist,
    peers: () => lan.peerStatus(),
    addPeer: a => lan.addPeer(a),
    removePeer: a => lan.removePeer(a),
    waitPeer: (a, ms, from) => lan.waitPeer(a, ms, from),
    isConfigPeer: a => lan.isConfigPeer(a),
    stats: () => ({ ...engine.stats(), lan: { port, discoveryPort, peers: lan.peerStatus() }, serial: serial.map(a => a.stats()) }),
    // Última rodada ao desligar: o que aconteceu desde a anterior não se perde.
    // e o armazenamento é gravado de novo (o que chegou depois da última gravação também volta).
    close: async () => { clearInterval(timer); clearInterval(persistTimer); sample(); await Promise.all(serial.map(a => a.stop())); await lan.stop(); persist(); },
  };
}

interface TrustJson { v: 1; learned: { prevPk: string; nextPk: string; at: number; sig: string }[]; cert: CertJson | null; list: ListJson | null; policies?: PolicyJson[] }

function saveTrust(file: string, st: OperatorTrustState) {
  const j: TrustJson = {
    v: 1, cert: st.cert ? certToJson(st.cert) : null, list: st.list ? listToJson(st.list) : null,
    learned: st.learned.map(s => ({ prevPk: toHex(s.prevPk), nextPk: toHex(s.nextPk), at: s.at, sig: toHex(s.sig) })),
    policies: (st.policies ?? []).map(policyToJson),
  };
  writeFileAtomic(file, JSON.stringify(j));
}

/** Ilegível: o nó sobe sem o que aprendeu (a próxima sincronização com o operador traz de novo). */
function loadTrust(file: string, log?: (m: string) => void): OperatorTrustState | null {
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as TrustJson;
    if (j?.v !== 1) throw new Error('versão');
    return {
      cert: j.cert ? certFromJson(j.cert) : null, list: j.list ? listFromJson(j.list) : null,
      learned: (j.learned ?? []).map(s => ({ prevPk: unhex(s.prevPk), nextPk: unhex(s.nextPk), at: s.at, sig: unhex(s.sig) })),
      policies: (j.policies ?? []).map(policyFromJson),
    };
  } catch {
    log?.('LNNP: confiança do operador ilegível; ignorada até a próxima sincronização');
    return null;
  }
}
