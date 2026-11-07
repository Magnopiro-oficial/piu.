import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/** Wi-Fi conectado agora (IPv4). Igual a `WifiInfo` (src/transport/lan/types.ts); `hotspot` = rede do hotspot deste celular. */
export interface PiuLanWifi { connected: boolean; internet: boolean; ip: string | null; prefix: number | null; gateway: string | null; hotspot?: boolean }

/** Hotspot local (LocalOnlyHotspot): nome e senha gerados pelo sistema. */
export interface PiuLanHotspot { ssid: string | null; passphrase: string | null; ip: string; prefix: number }

/** Eventos dos soquetes da rede local. Bytes em base64 pela ponte nativa. */
export type PiuLanEvents = {
  onUdp: (e: { host: string; port: number; data: string }) => void;
  onAccept: (e: { id: number; host: string; port: number }) => void;
  onFrame: (e: { id: number; data: string }) => void;
  onClose: (e: { id: number; reason?: string }) => void;
  onNetwork: (e: PiuLanWifi) => void;
  onMdns: (e: { name: string; host: string; port: number; tcp: number | null; tag: string | null }) => void;
  /** Hotspot ligou (`PiuLanHotspot`) ou o sistema o desligou (`{ stopped: true }`). */
  onHotspot: (e: PiuLanHotspot | { stopped: true }) => void;
  /** Rede do ponto como visitante: entrou ou caiu. */
  onJoin: (e: { state: 'joined' | 'lost'; ssid: string }) => void;
};

declare class PiuLanNativeModule extends NativeModule<PiuLanEvents> {
  networkInfo(): Promise<PiuLanWifi>;
  /** UDP + servidor TCP presos ao Wi-Fi e MulticastLock. Devolve as portas reais. */
  start(tcpPort: number, udpPort: number, maxConnections: number): Promise<{ tcpPort: number; udpPort: number }>;
  stop(): Promise<void>;
  udpSend(host: string, port: number, data: string): void;
  /** Conexão TCP pelo Wi-Fi; resolve com o id. */
  connect(host: string, port: number, timeoutMs: number): Promise<number>;
  /** Quadro (o módulo põe o prefixo u32). */
  send(id: number, data: string): void;
  setFrameLimit(id: number, max: number): void;
  close(id: number): void;
  /** Conexão de teste: abre e fecha, sem mandar nada. */
  probe(host: string, port: number, timeoutMs: number): Promise<'open' | 'refused' | 'timeout' | 'unreachable' | 'error'>;
  mdnsStart(name: string, udpPort: number, txt: Record<string, string>): void;
  mdnsStop(): void;
  // ── Pontos Piu (fase 2). Opcionais: ausentes num build antigo do módulo. ──
  /** Redes por perto (nome, dBm, com senha). Erro `ERR_NO_PERMISSION`. */
  wifiScan?(): Promise<{ ssid: string; level: number; secure: boolean }[]>;
  /** Nome do Wi-Fi atual, se o sistema mostrar (`null` sem localização). */
  currentSsid?(): Promise<string | null>;
  startHotspot?(): Promise<PiuLanHotspot>;
  stopHotspot?(): Promise<void>;
  hotspotInfo?(): Promise<PiuLanHotspot | null>;
  /** Visitante: entra na rede do ponto só para o Piu (Android 10+; o sistema pergunta). */
  joinNetwork?(ssid: string, password: string | null): Promise<void>;
  leaveNetwork?(): Promise<void>;
}

/** `null` fora do Android com o app instalado (iPhone, web, Expo Go): o app segue só com Bluetooth/Nearby. */
export const PiuLan = requireOptionalNativeModule<PiuLanNativeModule>('PiuLan');
