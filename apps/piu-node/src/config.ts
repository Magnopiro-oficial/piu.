import { resolve } from 'node:path';
import { DEFAULT_ALERT_FEEDS, DEFAULT_ALERT_POLL_MS } from './alerts/collector.js';
import { parseSerialSpec } from './relay/serial.js';

/** Configuração por variáveis de ambiente (nada de segredo no código). */
export interface Config {
  port: number;
  /** Endereço de escuta. Padrão: todas as interfaces da rede local. */
  host: string;
  /** Nomes/endereços pelos quais o painel pode ser acessado (proteção contra DNS rebinding). */
  allowedHosts: string[];
  /** Pasta de dados: estado, certificado TLS e pacotes (criada com permissão 0700). */
  dataDir: string;
  /** Build do painel (apps/provider-panel/dist). */
  panelDir: string;
  /** Chave pública de release da Lunes (SPKI DER em base64), fixada para conferir pacotes. */
  releasePubKey: string | null;
  /** Motor de retransmissão LNNP (adapter LAN). Ausente: o nó sobe sem retransmitir. */
  lnnp?: LnnpConfig;
  /** Alertas oficiais em CAP 1.2 (feeds RSS/Atom). Ausente ou sem feeds: desligado. */
  alerts?: AlertsConfig;
}

export interface AlertsConfig {
  /** `PIU_ALERT_FEEDS`: URLs separadas por vírgula. Padrão: o feed CAP do INMET; vazio desliga. */
  feeds: string[];
  /** `PIU_ALERT_POLL_MS`: intervalo entre as leituras (padrão 10 min). */
  pollMs: number;
}

export interface LnnpConfig {
  /** Liga o motor (descoberta, enlaces e roteador). */
  enabled: boolean;
  /** Modo nó: retransmite envelopes de terceiros (desligado, o nó só fala o protocolo). */
  relay: boolean;
  listen: string;
  /** Porta TCP do enlace LNNP. */
  port: number;
  /** Porta UDP da descoberta (`null` desliga a descoberta; ficam só os vizinhos fixos). */
  discoveryPort: number | null;
  /** Destinos do anúncio de descoberta (broadcast da rede local, ou `endereço:porta`). */
  broadcast: string[];
  /** Vizinhos fixos (`host:porta`). */
  peers: string[];
  /** Teto de memória para envelopes guardados (MiB). O armazenamento do painel não passa disto. */
  memoryMB: number;
  /** Só aceita estes nós (chave do nó em hex, 64 caracteres). `null`: qualquer nó LNNP. */
  allow: string[] | null;
  beaconMs: number;
  /** Intervalo das amostras do histórico de retransmissão (ms): `PIU_RELAY_SAMPLE_MS`. */
  sampleMs?: number;
  /** Intervalo para gravar as mensagens guardadas quando mudam (ms): `PIU_RELAY_PERSIST_MS`. */
  persistMs?: number;
  /** Portas seriais (rádio LoRa ou cabo USB): `PIU_SERIAL`. */
  serial?: { kind: 'lora' | 'usb'; path: string; baud: number }[];
  /** Rádio LoRa: parâmetros (para o tempo no ar), ocupação do canal, maior envelope e anúncio. */
  lora?: { sf: number; bwKHz: number; cr: number; dutyPercent: number; maxEnvelope: number; beaconMs: number };
}

const list = (v: string | undefined) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean);
const flag = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : !['0', 'false', 'off', 'nao', 'não'].includes(v.toLowerCase()));

export function loadLnnpConfig(env = process.env): LnnpConfig {
  const discovery = env.PIU_LNNP_DISCOVERY_PORT ?? '8423';
  const allow = list(env.PIU_LNNP_ALLOW).map(x => x.toLowerCase());
  if (allow.some(x => !/^[0-9a-f]{64}$/.test(x))) throw new Error('PIU_LNNP_ALLOW: use chaves de nó em hex (64 caracteres), separadas por vírgula.');
  const serial = list(env.PIU_SERIAL).map(parseSerialSpec);
  const num = (name: string, def: number, ok: (n: number) => boolean) => {
    const v = env[name]; if (v === undefined || v === '') return def;
    const n = Number(v); if (!ok(n)) throw new Error(`${name}: valor inválido (${v}).`); return n;
  };
  const lora = {
    sf: num('PIU_LORA_SF', 9, n => Number.isInteger(n) && n >= 7 && n <= 12),
    bwKHz: num('PIU_LORA_BW_KHZ', 125, n => [62.5, 125, 250, 500].includes(n)),
    cr: num('PIU_LORA_CR', 5, n => Number.isInteger(n) && n >= 5 && n <= 8),
    dutyPercent: num('PIU_LORA_DUTY', 10, n => n > 0 && n <= 100),
    maxEnvelope: num('PIU_LORA_MAX_ENVELOPE', 1536, n => Number.isInteger(n) && n >= 256 && n <= 16384),
    beaconMs: num('PIU_LORA_BEACON_MS', 30_000, n => n >= 1000),
  };
  return {
    serial, lora,
    enabled: flag(env.PIU_LNNP, true),
    relay: flag(env.PIU_LNNP_RELAY, true),
    listen: env.PIU_LNNP_LISTEN ?? '0.0.0.0',
    port: Number(env.PIU_LNNP_PORT ?? 8422),
    discoveryPort: ['off', '0', 'false'].includes(discovery) ? null : Number(discovery),
    broadcast: list(env.PIU_LNNP_BROADCAST ?? '255.255.255.255'),
    peers: list(env.PIU_LNNP_PEERS),
    memoryMB: Number(env.PIU_LNNP_MEMORY_MB ?? 256),
    allow: allow.length ? allow : null,
    beaconMs: Number(env.PIU_LNNP_BEACON_MS ?? 5000),
    sampleMs: num('PIU_RELAY_SAMPLE_MS', 300_000, n => Number.isInteger(n) && n >= 1000 && n <= 3_600_000),
    persistMs: num('PIU_RELAY_PERSIST_MS', 30_000, n => Number.isInteger(n) && n >= 1000 && n <= 3_600_000),
  };
}

export function loadAlertsConfig(env = process.env): AlertsConfig {
  const feeds = env.PIU_ALERT_FEEDS === undefined ? DEFAULT_ALERT_FEEDS : list(env.PIU_ALERT_FEEDS);
  for (const f of feeds) {
    let ok = false;
    try { const u = new URL(f); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* inválida */ }
    if (!ok) throw new Error(`PIU_ALERT_FEEDS: URL inválida (${f}). Use http(s)://…, separadas por vírgula.`);
  }
  const raw = env.PIU_ALERT_POLL_MS;
  const pollMs = raw === undefined || raw === '' ? DEFAULT_ALERT_POLL_MS : Number(raw);
  if (!Number.isInteger(pollMs) || pollMs < 60_000 || pollMs > 24 * 3600_000) throw new Error(`PIU_ALERT_POLL_MS: valor inválido (${raw}). Entre 60000 (1 min) e 86400000 (24 h).`);
  return { feeds, pollMs };
}

export function loadConfig(env = process.env): Config {
  const port = Number(env.PIU_NODE_PORT ?? 8420);
  const hosts = (env.PIU_NODE_HOSTS ?? 'piu-node.local,localhost,127.0.0.1').split(',').map(h => h.trim()).filter(Boolean);
  return {
    port,
    host: env.PIU_NODE_LISTEN ?? '0.0.0.0',
    allowedHosts: hosts.flatMap(h => (h.includes(':') && !h.startsWith('[') ? [h] : [h, `${h}:${port}`])),
    dataDir: resolve(env.PIU_NODE_DATA ?? 'data'),
    panelDir: resolve(env.PIU_NODE_PANEL ?? '../provider-panel/dist'),
    releasePubKey: env.PIU_RELEASE_PUBKEY?.trim() || null,
    lnnp: loadLnnpConfig(env),
    alerts: loadAlertsConfig(env),
  };
}
