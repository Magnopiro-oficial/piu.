import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type MeshtasticState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type MeshtasticDevice = { id: string; name: string; rssi: number };

type PiuMeshtasticEvents = {
  onDevice: (e: MeshtasticDevice) => void;
  /** Uma leitura de FromRadio (um `FromRadio` protobuf inteiro), bytes crus. */
  onFromRadio: (e: { data: Uint8Array }) => void;
  /** `reason` ex.: 'timeout', 'bond', 'no_service', 'connect:133', 'link:8', 'scan:2'. */
  onState: (e: { state: MeshtasticState; reason?: string }) => void;
};

declare class PiuMeshtasticNativeModule extends NativeModule<PiuMeshtasticEvents> {
  isAvailable(): boolean;
  scan(seconds: number): Promise<void>;
  connect(id: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  drain(): Promise<void>;
  disconnect(): void;
}

/** `null` fora do Android com o app instalado (iPhone, web, Expo Go). */
const native = requireOptionalNativeModule<PiuMeshtasticNativeModule>('PiuMeshtastic');

const unavailable = () =>
  Promise.reject(Object.assign(new Error('Rádio Meshtastic indisponível.'), { code: 'UNAVAILABLE' }));
const noop = { remove() {} };

/**
 * Cliente Bluetooth LE de um rádio Meshtastic (API de cliente: ToRadio/FromRadio/FromNum). Só bytes
 * crus; o protobuf fica em src/transport/meshtastic. Erros têm `code`: PERMISSION (falta
 * BLUETOOTH_SCAN/CONNECT, pedidas pelo piu-transport), BT_OFF, NOT_CONNECTED, TIMEOUT, ERR_CONNECT,
 * ERR_GATT, DISCONNECTED, UNAVAILABLE. Reconexão não é automática.
 */
export const PiuMeshtastic = {
  isAvailable(): boolean {
    return !!native && native.isAvailable();
  },
  /** Busca rádios Meshtastic (filtro pelo serviço) por `seconds` (1–60); resolve ao fim. */
  scan(seconds: number): Promise<void> {
    return native ? native.scan(seconds) : unavailable();
  },
  /** Conecta, MTU 512, descobre o serviço, liga FromNum (pareamento com PIN fica com o Android) e drena. */
  connect(id: string): Promise<void> {
    return native ? native.connect(id) : unavailable();
  },
  /** Escreve um `ToRadio` em protobuf (escrita com resposta). */
  write(bytes: Uint8Array): Promise<void> {
    return native ? native.write(bytes) : unavailable();
  },
  /** Lê FromRadio até vir vazio (cada leitura sai em onFromRadio). */
  drain(): Promise<void> {
    return native ? native.drain() : unavailable();
  },
  disconnect(): void {
    native?.disconnect();
  },
  addDeviceListener(fn: (d: MeshtasticDevice) => void): { remove(): void } {
    return native ? native.addListener('onDevice', fn) : noop;
  },
  addFromRadioListener(fn: (data: Uint8Array) => void): { remove(): void } {
    return native ? native.addListener('onFromRadio', e => fn(e.data)) : noop;
  },
  addStateListener(fn: (state: MeshtasticState, reason?: string) => void): { remove(): void } {
    return native ? native.addListener('onState', e => fn(e.state, e.reason)) : noop;
  },
};

export default PiuMeshtastic;
