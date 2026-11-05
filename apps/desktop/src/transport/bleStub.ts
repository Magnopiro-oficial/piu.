/**
 * Bluetooth LE no computador: ainda não implementado. A interface `Transport` já está pronta para
 * plugar uma implementação (ex.: noble/WebBluetooth no processo principal) sem mexer na camada de
 * mensagens. Até lá, o estado é `unavailable` com o motivo, e a tela Rede mostra "em breve".
 */
import type { PeerInfo, TransportState } from '../shared/types';
import type { Transport, TransportEvent } from './types';

export class BleTransportStub implements Transport {
  readonly kind = 'ble' as const;
  readonly state: TransportState = 'unavailable';
  readonly reason = 'Bluetooth LE no computador chega numa próxima versão.';
  readonly linkCount = 0;
  async start() { /* nada a ligar */ }
  async stop() { /* nada a desligar */ }
  async send(): Promise<void> { throw new Error('Bluetooth LE ainda não está disponível no computador.'); }
  subscribe(_fn: (e: TransportEvent) => void) { return () => {}; }
  peerStatus(): PeerInfo[] { return []; }
}
