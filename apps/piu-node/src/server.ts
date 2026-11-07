import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { generate } from 'selfsigned';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { LunesSigner } from './lunes/signing.js';
import { loadPackages, type Manifest, releaseKey } from './packages.js';
import { loadNodeKey, type RelayHandle, startRelay } from './relay/index.js';
import { Pairing } from './security/pairing.js';
import { OperatorVault } from './operator.js';
import { Store } from './store.js';

export interface NodeServer {
  app: FastifyInstance;
  /** Endereço do painel (https://host:porta). */
  url: string;
  /** Porta real (útil com `port: 0`). */
  port: number;
  /** PEM e impressão digital SHA-256 do certificado TLS do nó (para conferir ou fixar). */
  cert: string;
  fingerprint: string;
  packages: Manifest[];
  /** Gera um código de pareamento novo (10 min, uso único). Só para a tela local do equipamento. */
  issueCode: () => string;
  /**
   * Sessão para o navegador embutido do app desktop, sem código (o token vai no cookie
   * `__Host-piu_session`; nunca passa pelo JavaScript da página). Não vale como step-up.
   */
  localSession: (name: string, label: string) => { token: string; csrf: string };
  /** Motor de retransmissão LNNP (`null` se desligado por `PIU_LNNP=0` ou se não conseguiu subir). */
  relay: RelayHandle | null;
  close: () => Promise<void>;
}

export interface StartOptions {
  logger?: boolean;
  /** Mensagens do motor de retransmissão (vizinhos, erros). */
  log?: (msg: string) => void;
  /** Código novo depois que o anterior foi usado ou bloqueado (mostrar só localmente). */
  onCode?: (code: string, reason: 'used' | 'locked') => void;
  /**
   * O dono pediu para reiniciar pelo painel (`POST /api/devices/:id/restart`). Quem sobe o nó decide
   * como: a linha de comando fecha e sai com `RESTART_EXIT_CODE` para o supervisor subir de novo; o
   * app desktop fecha e sobe o nó outra vez no mesmo processo. Ausente: a rota responde 409.
   */
  onRestart?: () => void;
}

/** Código de saída do reinício pedido pelo painel (EX_TEMPFAIL): procd e systemd (`Restart=on-failure`) sobem de novo. */
export const RESTART_EXIT_CODE = 75;

/** TLS na rede local: certificado próprio do nó (P-256), gerado na primeira execução; chave com 0600. */
async function tls(config: Config) {
  const dir = join(config.dataDir, 'tls');
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const names = config.allowedHosts.filter(h => !h.includes(':'));
    const pems = await generate([{ name: 'commonName', value: names[0] ?? 'piu-node.local' }], {
      keyType: 'ec',
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 397 * 86400_000),
      extensions: [{ name: 'subjectAltName', altNames: names.map(n => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) }],
    });
    writeFileSync(keyPath, pems.private, { mode: 0o600 });
    writeFileSync(certPath, pems.cert, { mode: 0o644 });
  }
  const cert = readFileSync(certPath, 'utf8');
  return { key: readFileSync(keyPath, 'utf8'), cert, fingerprint: new X509Certificate(cert).fingerprint256 };
}

/**
 * Sobe o nó: pasta de dados (0700), TLS, pacotes assinados, API e painel.
 * Usado pela linha de comando (main.ts) e pelo app desktop (apps/provider-desktop).
 */
export async function startNode(config: Config, o: StartOptions = {}): Promise<NodeServer> {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  // Mesmo que a pasta já exista com permissão frouxa: só o usuário do serviço lê estado, certificado e pacotes.
  chmodSync(config.dataDir, 0o700);
  const t = await tls(config);
  const key = config.releasePubKey ? releaseKey(config.releasePubKey) : null;
  const packagesDir = join(config.dataDir, 'packages');
  const packages = loadPackages(packagesDir, key);
  const pairing = new Pairing();
  const issueCode = () => pairing.issue(Date.now());
  const store = new Store(config.dataDir);
  const vault = new OperatorVault(config.dataDir);
  if (vault.setAside) o.log?.(`Chaves de operador ilegíveis: arquivo guardado em ${vault.setAside}. Restaure o backup cifrado em Configurações (API /api/operator/restore).`);

  // Retransmissão: um erro aqui (porta ocupada, por exemplo) não derruba o painel; o operador vê no log.
  let relay: RelayHandle | null = null;
  const gatewayDefault = { enabled: config.lnnp?.gateway !== false, inboxUrl: config.lnnp?.inboxUrl ?? null };
  if (config.lnnp?.enabled) {
    try {
      relay = await startRelay(loadNodeKey(config.dataDir), config.lnnp, store.nodeSettings(), {
        log: o.log, historyFile: join(config.dataDir, 'lnnp', 'relay-history.json'), storeFile: join(config.dataDir, 'lnnp', 'relay-store.bin'),
        trustFile: join(config.dataDir, 'lnnp', 'operator-trust.json'),
        // Gateway da carga pela malha (PIU_GATEWAY): usa os mesmos endereços da Lunes do painel. Ligado e a
        // caixa do validador são lidos do estado do nó a cada uso: o dono muda pelo painel sem reiniciar
        // (sem ajuste salvo, valem PIU_GATEWAY e PIU_VALIDATOR_INBOX).
        gateway: {
          ...(config.lunesEndpoints ? { endpoints: config.lunesEndpoints } : {}),
          enabled: () => store.gatewaySettings(gatewayDefault).enabled,
          inboxUrl: () => store.gatewaySettings(gatewayDefault).inboxUrl,
        },
      });
    } catch (e) {
      o.log?.(`LNNP: motor de retransmissão não subiu (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // O próprio nó é um equipamento do dono: com rádio ou cabo serial ligado, é um Gateway Local.
  const selfDevice = { name: (hostname().trim() || 'piu-node').slice(0, 40), cls: config.lnnp?.serial?.length ? 'Gateway Local' : 'Home Node' };
  store.ensureSelfDevice(selfDevice, Date.now());
  // Pausado no painel antes de reiniciar: continua pausado.
  if (store.selfDevice()?.status === 'paused') relay?.setPaused(true);

  // Transferências assinadas no celular: o nó acompanha os pedidos enviados a cada bloco (6 s).
  const lunesSigner = new LunesSigner({ store, ...(config.lunesEndpoints ? { endpoints: config.lunesEndpoints } : {}), log: o.log });
  const app = await buildApp({
    config, store, pairing, packages, packagesDir, relay, selfDevice, vault, restart: o.onRestart, lunesSigner,
    https: { key: t.key, cert: t.cert }, logger: o.logger ?? false,
    onCodeSpent: reason => {
      // Bloqueado: espera 60 s antes de gerar outro (freia quem tenta adivinhar pela rede).
      if (reason === 'locked') setTimeout(() => o.onCode?.(issueCode(), 'locked'), 60_000).unref();
      else o.onCode?.(issueCode(), 'used');
    },
  });
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (e) {
    await relay?.close();
    throw e;
  }
  lunesSigner.start();
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const host = config.allowedHosts.find(h => !h.includes(':')) ?? 'localhost';
  return { app, url: `https://${host}:${port}`, port, cert: t.cert, fingerprint: t.fingerprint, packages, issueCode, relay,
    localSession: (name, label) => { const { token, csrf } = app.piuLocalSession(name, label); return { token, csrf }; },
    close: async () => { lunesSigner.stop(); await relay?.close(); await app.close(); } };
}
