import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/** Eventos do WebSocket nativo (vínculo com o Piu Desktop). `id` é o devolvido por `wsOpen`. */
export type PiuNodeLinkEvents = {
  onWsOpen: (e: { id: number }) => void;
  onWsMessage: (e: { id: number; data: string }) => void;
  onWsClose: (e: { id: number; code: number; reason: string }) => void;
  onWsError: (e: { id: number; message: string }) => void;
};

declare class PiuNodeLinkNativeModule extends NativeModule<PiuNodeLinkEvents> {
  /**
   * Requisição HTTPS para o piu-node da rede local, aceitando SÓ o certificado cuja impressão digital
   * SHA-256 (do certificado inteiro, em DER) é `pin` (`AA:BB:…`). Qualquer outro certificado, mesmo
   * válido para uma autoridade, é recusado. Sem redirecionamento e sem cookies automáticos.
   */
  request(url: string, method: string, headers: Record<string, string>, body: string | null, pin: string): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /**
   * WebSocket `wss://` com o mesmo pino (só o SHA-256 do certificado; sem conferência de nome, o host é
   * um IP). Resolve com o id da conexão; o resto chega pelos eventos. No iPhone ainda rejeita.
   */
  wsOpen(url: string, pin: string): Promise<number>;
  /** Mensagem de texto. `false` se a conexão não está aberta. */
  wsSend(id: number, text: string): boolean;
  wsClose(id: number, code: number, reason: string): void;
}

/** `null` onde o módulo nativo não existe (navegador, Expo Go). */
export const PiuNodeLink = requireOptionalNativeModule<PiuNodeLinkNativeModule>('PiuNodeLink');
