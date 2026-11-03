import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

declare class PiuNodeLinkNativeModule extends NativeModule<Record<string, never>> {
  /**
   * Requisição HTTPS para o piu-node da rede local, aceitando SÓ o certificado cuja impressão digital
   * SHA-256 (do certificado inteiro, em DER) é `pin` (`AA:BB:…`). Qualquer outro certificado, mesmo
   * válido para uma autoridade, é recusado. Sem redirecionamento e sem cookies automáticos.
   */
  request(url: string, method: string, headers: Record<string, string>, body: string | null, pin: string): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

/** `null` onde o módulo nativo não existe (navegador, Expo Go). */
export const PiuNodeLink = requireOptionalNativeModule<PiuNodeLinkNativeModule>('PiuNodeLink');
