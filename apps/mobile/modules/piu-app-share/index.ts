import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export interface WifiShareInfo { ssid: string; passphrase: string; ip: string; port: number }

declare class PiuAppShareNativeModule extends NativeModule<Record<string, never>> {
  /**
   * Copia o instalador deste app (o APK instalado) e abre o compartilhamento do Android com ele
   * (Bluetooth, Quick Share…). Resolve quando a escolha abre; erros: `ERR_SPLIT_APK` (instalado
   * em partes pela loja), `ERR_NO_SHARE_TARGET` (nenhum app para receber o arquivo).
   */
  shareApk(fileName: string, chooserTitle: string): Promise<void>;
  /**
   * Abre uma rede Wi-Fi Direct com senha e serve `pageHtml` em `/` e o instalador em `/<fileName>`,
   * só no IP dessa rede, por `windowMs`. Erros: `ERR_SPLIT_APK`, `ERR_WIFI_OFF`, `ERR_NO_PERMISSION`,
   * `ERR_P2P_BUSY`, `ERR_P2P_UNSUPPORTED`, `ERR_PORT`.
   */
  startWifiShare(fileName: string, pageHtml: string, port: number, windowMs: number): Promise<WifiShareInfo>;
  /**
   * SHA-256 (hexa) do instalador que vai para o outro celular e de cada certificado que assina este app
   * (auditoria B-03). Calculado fora da thread principal, em blocos, com cache. Ausente em builds antigos.
   * Erro: `ERR_SPLIT_APK`.
   */
  integrity?(): Promise<{ apkSha256: string; certSha256: string[] }>;
  /**
   * SHA-256 (hexa) do instalador que vai para o outro celular e de cada certificado que assina este app
   * (auditoria B-03). Calculado fora da thread principal, em blocos, com cache. Ausente em builds antigos.
   * Erro: `ERR_SPLIT_APK`.
   */
  integrity?(): Promise<{ apkSha256: string; certSha256: string[] }>;
  /** Tamanho do instalador em bytes. */
  apkSize(): number;
  /** Fecha a rede e a página (também acontece sozinho quando o prazo acaba). */
  stopWifiShare(): Promise<void>;
  /**
   * Página do ponto Piu (P9): a mesma página e instalador, na rede Wi-Fi do ponto, só no IPv4 `ip`, sem
   * Wi-Fi Direct e sem prazo. Independente de `startWifiShare`. Ausente em builds antigos.
   * Erros: `ERR_SPLIT_APK`, `ERR_PORT`.
   */
  startLanShare?(fileName: string, pageHtml: string, ip: string, port: number): Promise<{ ip: string; port: number }>;
  stopLanShare?(): Promise<void>;
}

/** `null` fora do Android nativo (iPhone, navegador, Expo Go). */
export const PiuAppShare = requireOptionalNativeModule<PiuAppShareNativeModule>('PiuAppShare');
