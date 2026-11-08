import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';
import type { MeshtasticDevice, MeshtasticState } from './index';

type PiuRNodeEvents = {
  onDevice: (e: MeshtasticDevice) => void;
  /** Uma notificação do serviço Nordic UART: bytes KISS crus (um quadro pode vir partido). */
  onData: (e: { data: Uint8Array }) => void;
  /** `reason` ex.: 'timeout', 'bond', 'no_service', 'connect:133', 'link:8', 'scan:2'. */
  onState: (e: { state: MeshtasticState; reason?: string }) => void;
};

declare class PiuRNodeNativeModule extends NativeModule<PiuRNodeEvents> {
  isAvailable(): boolean;
  scan(seconds: number): Promise<void>;
  connect(id: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  disconnect(): void;
}

/** `null` fora do Android com o app instalado (iPhone, web, Expo Go). */
const native = requireOptionalNativeModule<PiuRNodeNativeModule>('PiuRNode');

const unavailable = () =>
  Promise.reject(Object.assign(new Error('Rádio LoRa do Piu indisponível.'), { code: 'UNAVAILABLE' }));
const noop = { remove() {} };

/**
 * Cliente Bluetooth LE do rádio próprio do Piu (firmware RNode, serviço Nordic UART). Só bytes KISS
 * crus; a configuração fica em src/transport/rnode. Mesmos códigos de erro do PiuMeshtastic.
 */
export const PiuRNode = {
  isAvailable(): boolean {
    return !!native && native.isAvailable();
  },
  /** Busca RNodes (pelo serviço ou pelo nome "RNode …") por `seconds` (1–60); resolve ao fim. */
  scan(seconds: number): Promise<void> {
    return native ? native.scan(seconds) : unavailable();
  },
  /** Conecta, MTU 512, descobre o serviço e liga as notificações (o PIN da placa vai no diálogo do Android). */
  connect(id: string): Promise<void> {
    return native ? native.connect(id) : unavailable();
  },
  /** Escreve bytes KISS (em pedaços do MTU, na ordem). */
  write(bytes: Uint8Array): Promise<void> {
    return native ? native.write(bytes) : unavailable();
  },
  disconnect(): void {
    native?.disconnect();
  },
  addDeviceListener(fn: (d: MeshtasticDevice) => void): { remove(): void } {
    return native ? native.addListener('onDevice', fn) : noop;
  },
  addDataListener(fn: (data: Uint8Array) => void): { remove(): void } {
    return native ? native.addListener('onData', e => fn(e.data)) : noop;
  },
  addStateListener(fn: (state: MeshtasticState, reason?: string) => void): { remove(): void } {
    return native ? native.addListener('onState', e => fn(e.state, e.reason)) : noop;
  },
};

export default PiuRNode;
