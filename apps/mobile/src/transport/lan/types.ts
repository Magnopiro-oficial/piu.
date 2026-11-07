/**
 * Contrato entre o transporte LAN (LNNP em TypeScript, `engine.ts`) e os soquetes do aparelho
 * (módulo nativo modules/piu-lan no Android; falso em memória nos testes; Node no teste com o Desktop).
 *
 * Os soquetes só movem bytes: o enquadramento TCP (u32 de tamanho + quadro) e o teto de tamanho do
 * quadro ficam do lado nativo; handshake, cifra, descoberta e limites ficam no TypeScript.
 */

/** Wi-Fi em que o celular está agora (só IPv4: a varredura e o anúncio são IPv4). */
export interface WifiInfo {
  /** Conectado a uma rede Wi-Fi (mesmo sem internet). */
  connected: boolean;
  /** A rede Wi-Fi tem internet validada pelo sistema. */
  internet: boolean;
  /** IPv4 deste aparelho na rede Wi-Fi. */
  ip: string | null;
  /** Prefixo da sub-rede (24 = 255.255.255.0). */
  prefix: number | null;
  /** IPv4 do roteador (rota padrão da rede Wi-Fi). */
  gateway: string | null;
}

export const NO_WIFI: WifiInfo = { connected: false, internet: false, ip: null, prefix: null, gateway: null };

/** Resultado de uma conexão TCP de teste (só abre e fecha; nada é enviado). */
export type ProbeResult = 'open' | 'refused' | 'timeout' | 'unreachable' | 'error';

export type LanSocketEvent =
  /** Datagrama UDP recebido na porta de descoberta. */
  | { type: 'udp'; host: string; port: number; data: Uint8Array }
  /** Conexão TCP que chegou ao servidor (`id` novo). */
  | { type: 'accept'; id: number; host: string; port: number }
  /** Quadro inteiro (sem o prefixo de tamanho) de uma conexão. */
  | { type: 'frame'; id: number; data: Uint8Array }
  /** Conexão fechada (pelo outro lado, por erro ou por quadro acima do teto). */
  | { type: 'close'; id: number; reason?: string }
  /** O Wi-Fi mudou (entrou, saiu, ganhou ou perdeu internet). */
  | { type: 'network'; info: WifiInfo }
  /** Serviço `_piu._udp` resolvido pelo mDNS (do TXT: `tcp` = porta do enlace, `tag` = etiqueta em hex). */
  | { type: 'mdns'; name: string; host: string; port: number; tcp: number | null; tag: string | null };

export interface LanStartOptions {
  /** Porta TCP do enlace (se ocupada, o lado nativo usa uma livre e devolve qual). */
  tcpPort: number;
  /** Porta UDP da descoberta. */
  udpPort: number;
  /** Teto de conexões TCP abertas ao mesmo tempo (entrando e saindo). */
  maxConnections: number;
}

export interface LanSocketApi {
  /** Liga UDP + servidor TCP presos à rede Wi-Fi (e o MulticastLock, no Android). */
  start(o: LanStartOptions): Promise<{ tcpPort: number; udpPort: number }>;
  stop(): Promise<void>;
  udpSend(host: string, port: number, data: Uint8Array): void;
  /** Abre uma conexão TCP pela rede Wi-Fi. Resolve com o id quando conecta; rejeita com o motivo. */
  connect(host: string, port: number, timeoutMs: number): Promise<number>;
  /** Manda um quadro (o lado nativo põe o prefixo u32). */
  send(id: number, frame: Uint8Array): void;
  /** Maior quadro aceito nesta conexão (acima disso o lado nativo fecha). */
  setFrameLimit(id: number, max: number): void;
  close(id: number): void;
  subscribe(fn: (e: LanSocketEvent) => void): () => void;
  networkInfo(): Promise<WifiInfo>;
  probe(host: string, port: number, timeoutMs: number): Promise<ProbeResult>;
  /** mDNS/DNS-SD: registra `_piu._udp` e procura os outros. Ausente onde não há mDNS. */
  mdnsStart?(name: string, udpPort: number, txt: Record<string, string>): void;
  mdnsStop?(): void;
}
