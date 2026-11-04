import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

declare class PiuAppShareNativeModule extends NativeModule<Record<string, never>> {
  /**
   * Copia o instalador deste app (o APK instalado) e abre o compartilhamento do Android com ele
   * (Bluetooth, Quick Share…). Resolve quando a escolha abre; erros: `ERR_SPLIT_APK` (instalado
   * em partes pela loja), `ERR_NO_SHARE_TARGET` (nenhum app para receber o arquivo).
   */
  shareApk(fileName: string, chooserTitle: string): Promise<void>;
}

/** `null` fora do Android nativo (iPhone, navegador, Expo Go). */
export const PiuAppShare = requireOptionalNativeModule<PiuAppShareNativeModule>('PiuAppShare');
