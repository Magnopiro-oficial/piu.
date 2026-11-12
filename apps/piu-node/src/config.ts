import { resolve } from 'node:path';
import { parseLunesEndpoints } from './lunes/reader.js';
import { parseSerialSpec } from './relay/serial.js';
import { piuRadio, type PiuRadio, REGIONS } from './rnode/regions.js';
import { inboxUrlProblem } from './relay/inboxUrl.js';

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
  /**
   * Endereços WebSocket da Lunes Mainnet para ler o saldo da carteira de provider (`PIU_LUNES_ENDPOINTS`).
   * Ausente: os de produção, na ordem confirmada (src/lunes/lunesRpc.ts).
   */
  lunesEndpoints?: string[];
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
  /** Portas seriais (rádio LoRa KISS, cabo USB, rádio Meshtastic ou RNode): `PIU_SERIAL`. */
  serial?: { kind: 'lora' | 'usb' | 'meshtastic' | 'rnode'; path: string; baud: number }[];
  /**
   * Rádio próprio (RNode): canal da região `PIU_RNODE_REGION` (padrão `BR_902`), com `PIU_RNODE_FREQ_HZ`
   * e `PIU_RNODE_TX_DBM` para casos especiais, sempre dentro da faixa e da potência da região.
   */
  rnode?: PiuRadio;
  /** Tempo de rádio no canal Meshtastic: pedaços por minuto (`PIU_MESHTASTIC_PER_MIN`, padrão 6). */
  meshtasticPerMin?: number;
  /**
   * Gateway da carga pela malha (docs/carteira/transacoes-pela-malha.md): `PIU_GATEWAY` (padrão ligado;
   * só age com rota até a Lunes). `inboxUrl`: caixa HTTPS do validador para os pacotes de evidências
   * (`PIU_VALIDATOR_INBOX`, padrão nenhuma: o nó não pega pacotes).
   * São só o padrão: o dono muda os dois pelo painel (`PUT /api/gateway`, com step-up), gravados no
   * estado do nó (`state.json` → `gateway`) e lidos sem reiniciar. `PIU_GATEWAY=0` desliga de vez (o painel não liga).
   */
  gateway?: boolean;
  inboxUrl?: string | null;
  /** Rádio LoRa: parâmetros (para o tempo no ar), ocupação do canal, maior envelope e anúncio. */
  lora?: { sf: number; bwKHz: number; cr: number; dutyPercent: number; maxEnvelope: number; beaconMs: number };
}

const list = (v: string | undefined) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean);
const flag = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : !['0', 'false', 'off', 'nao', 'não'].includes(v.toLowerCase()));

/** Número de variável de ambiente: vazio vale o padrão; valor fora da regra recusa a subida com a mensagem. */
function envNum(env: NodeJS.ProcessEnv, name: string, def: number, ok: (n: number) => boolean) {
  const v = env[name]; if (v === undefined || v === '') return def;
  const n = Number(v); if (!ok(n)) throw new Error(`${name}: valor inválido (${v}).`); return n;
}
/** Porta TCP (0 = aleatória, usada nos testes). */
const isPort = (n: number) => Number.isInteger(n) && n >= 0 && n <= 65535;

export function loadLnnpConfig(env = process.env): LnnpConfig {
  const discovery = env.PIU_LNNP_DISCOVERY_PORT ?? '8423';
  const allow = list(env.PIU_LNNP_ALLOW).map(x => x.toLowerCase());
  if (allow.some(x => !/^[0-9a-f]{64}$/.test(x))) throw new Error('PIU_LNNP_ALLOW: use chaves de nó em hex (64 caracteres), separadas por vírgula.');
  const serial = list(env.PIU_SERIAL).map(parseSerialSpec);
  const inboxUrl = env.PIU_VALIDATOR_INBOX?.trim() || null;
  // As mesmas regras do painel (https://, host público, sem credenciais): auditoria final, B-N1.
  const inboxErr = inboxUrl ? inboxUrlProblem(inboxUrl) : null;
  if (inboxErr) throw new Error(`PIU_VALIDATOR_INBOX: ${inboxErr} (use um endereço https://).`);
  const num = (name: string, def: number, ok: (n: number) => boolean) => envNum(env, name, def, ok);
  const lora = {
    sf: num('PIU_LORA_SF', 9, n => Number.isInteger(n) && n >= 7 && n <= 12),
    bwKHz: num('PIU_LORA_BW_KHZ', 125, n => [62.5, 125, 250, 500].includes(n)),
    cr: num('PIU_LORA_CR', 5, n => Number.isInteger(n) && n >= 5 && n <= 8),
    dutyPercent: num('PIU_LORA_DUTY', 10, n => n > 0 && n <= 100),
    maxEnvelope: num('PIU_LORA_MAX_ENVELOPE', 1536, n => Number.isInteger(n) && n >= 256 && n <= 16384),
    beaconMs: num('PIU_LORA_BEACON_MS', 30_000, n => n >= 1000),
  };
  const meshtasticPerMin = num('PIU_MESHTASTIC_PER_MIN', 6, n => n > 0 && n <= 60);
  const regionId = (env.PIU_RNODE_REGION?.trim() || 'BR_902').toUpperCase();
  const region = REGIONS.find(r => r.id === regionId);
  if (!region) throw new Error(`PIU_RNODE_REGION: região desconhecida (${regionId}). Use uma de: ${REGIONS.map(r => r.id).join(', ')}.`);
  const base = piuRadio(region.id), half = base.bwHz / 2;
  const rnode: PiuRadio = {
    ...base,
    freqHz: num('PIU_RNODE_FREQ_HZ', base.freqHz, n => Number.isInteger(n) && n - half >= region.startMHz * 1e6 && n + half <= region.endMHz * 1e6),
    txDbm: num('PIU_RNODE_TX_DBM', base.txDbm, n => Number.isInteger(n) && n >= 0 && n <= region.maxDbm),
  };
  return {
    serial, lora, meshtasticPerMin, rnode,
    gateway: flag(env.PIU_GATEWAY, true), inboxUrl,
    enabled: flag(env.PIU_LNNP, true),
    relay: flag(env.PIU_LNNP_RELAY, true),
    listen: env.PIU_LNNP_LISTEN ?? '0.0.0.0',
    port: num('PIU_LNNP_PORT', 8422, isPort),
    discoveryPort: ['off', '0', 'false'].includes(discovery) ? null : Number(discovery),
    broadcast: list(env.PIU_LNNP_BROADCAST ?? '255.255.255.255'),
    peers: list(env.PIU_LNNP_PEERS),
    memoryMB: num('PIU_LNNP_MEMORY_MB', 256, n => Number.isInteger(n) && n >= 1),
    allow: allow.length ? allow : null,
    beaconMs: num('PIU_LNNP_BEACON_MS', 5000, n => Number.isInteger(n) && n >= 1000),
    sampleMs: num('PIU_RELAY_SAMPLE_MS', 300_000, n => Number.isInteger(n) && n >= 1000 && n <= 3_600_000),
    persistMs: num('PIU_RELAY_PERSIST_MS', 30_000, n => Number.isInteger(n) && n >= 1000 && n <= 3_600_000),
  };
}

export function loadConfig(env = process.env): Config {
  const port = envNum(env, 'PIU_NODE_PORT', 8420, isPort);
  const hosts = (env.PIU_NODE_HOSTS ?? 'piu-node.local,localhost,127.0.0.1').split(',').map(h => h.trim()).filter(Boolean);
  return {
    port,
    host: env.PIU_NODE_LISTEN ?? '0.0.0.0',
    allowedHosts: hosts.flatMap(h => (h.includes(':') && !h.startsWith('[') ? [h] : [h, `${h}:${port}`])),
    dataDir: resolve(env.PIU_NODE_DATA ?? 'data'),
    panelDir: resolve(env.PIU_NODE_PANEL ?? '../provider-panel/dist'),
    releasePubKey: env.PIU_RELEASE_PUBKEY?.trim() || null,
    lnnp: loadLnnpConfig(env),
    lunesEndpoints: parseLunesEndpoints(env.PIU_LUNES_ENDPOINTS),
  };
}
