import { NEIGHBORS } from '../data/network';
import type { Transport, TransportEvent } from './types';

/**
 * Transporte simulado (navegador, Expo Go, testes): os vizinhos do protótipo aparecem aos poucos
 * e se conectam; envelopes enviados voltam como eco depois de um instante.
 */
export function createSimulatedTransport(): Transport {
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach(fn => fn(e));
  let timers: ReturnType<typeof setTimeout>[] = [];
  const peers = NEIGHBORS.filter(n => !n.spoof && (n.t === 'ble' || n.t === 'direct'));
  const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
  return {
    kind: 'sim',
    start: async () => {
      emit({ type: 'state', state: 'starting' });
      later(300, () => emit({ type: 'state', state: 'running' }));
      peers.forEach((n, i) => {
        const id = 'sim-' + i;
        later(600 + i * 450, () => emit({ type: 'peerFound', peer: { id, name: n.name, via: 'sim' } }));
        later(900 + i * 450, () => emit({ type: 'connected', id, name: n.name }));
      });
    },
    stop: async () => {
      timers.forEach(clearTimeout); timers = [];
      emit({ type: 'state', state: 'off' });
    },
    send: async (peerId, data) => { later(400, () => emit({ type: 'envelope', from: peerId, data })); },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
