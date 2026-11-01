import { resolve } from 'node:path';

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
  };
}
