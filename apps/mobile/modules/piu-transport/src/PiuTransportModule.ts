import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';
import type { PiuTransportEvents } from './PiuTransport.types';

declare class PiuTransportNativeModule extends NativeModule<PiuTransportEvents> {
  /** "nearby" no Android (Nearby Connections: BLE + Wi-Fi Direct), "ble" no iPhone (Bluetooth LE). */
  kind(): 'nearby' | 'ble';
  /** Começa a anunciar e procurar vizinhos. `name` é o identificador curto do nó; `serviceId` separa redes. */
  start(name: string, serviceId: string): Promise<void>;
  stop(): Promise<void>;
  /** Envia um envelope (já cifrado) para um vizinho conectado. `data` em base64. */
  send(peerId: string, data: string): Promise<void>;
}

/**
 * `null` onde o módulo nativo não existe (web, Expo Go): o app usa o transporte simulado.
 * Precisa de um development build (`npx expo run:android|ios` ou EAS) para existir.
 */
export default requireOptionalNativeModule<PiuTransportNativeModule>('PiuTransport');
