import { NEIGHBORS } from '../data/network';
import { MEDIA } from './select';
import type { Transport, TransportEvent } from './types';

/** Aparelho virtual dentro do transporte simulado (ex.: o aparelho de teste do navegador). */
export interface VirtualPeer {
  id: string;
  name: string;
  /** Bytes enviados a ele; `reply` devolve bytes como se viessem dele. */
  receive(data: Uint8Array, reply: (data: Uint8Array) => void): void;
}

const virtuals = new Map<string, VirtualPeer>();
let onAttach: ((p: VirtualPeer) => void) | null = null;

/** Conecta um aparelho virtual (só existe no transporte simulado). */
export function attachVirtualPeer(p: VirtualPeer) {
  virtuals.set(p.id, p);
  onAttach?.(p);
  return () => { virtuals.delete(p.id); };
}

/**
 * Transporte simulado (navegador, Expo Go, testes): os vizinhos do protótipo aparecem aos poucos
 * e se conectam; envelopes enviados a eles voltam como eco (e são descartados como repetidos).
 * Aparelhos virtuais (`attachVirtualPeer`) recebem e respondem de verdade.
 */
export function createSimulatedTransport(): Transport {
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach(fn => fn(e));
  let timers: ReturnType<typeof setTimeout>[] = [];
  let running = false;
  const peers = NEIGHBORS.filter(n => !n.spoof && (n.t === 'ble' || n.t === 'direct'));
  const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
  const announce = (p: VirtualPeer, ms: number) => {
    later(ms, () => emit({ type: 'peerFound', peer: { id: p.id, name: p.name, via: 'sim' } }));
    later(ms + 200, () => emit({ type: 'connected', id: p.id, name: p.name }));
  };
  onAttach = p => { if (running) announce(p, 100); };
  return {
    kind: 'sim',
    media: [MEDIA.sim],
    start: async () => {
      running = true;
      emit({ type: 'state', state: 'starting' });
      later(300, () => emit({ type: 'state', state: 'running' }));
      peers.forEach((n, i) => {
        const id = 'sim-' + i;
        later(600 + i * 450, () => emit({ type: 'peerFound', peer: { id, name: n.name, via: 'sim' } }));
        later(900 + i * 450, () => emit({ type: 'connected', id, name: n.name }));
      });
      [...virtuals.values()].forEach(p => announce(p, 500));
    },
    stop: async () => {
      running = false;
      timers.forEach(clearTimeout); timers = [];
      emit({ type: 'state', state: 'off' });
    },
    send: async (peerId, data) => {
      const v = virtuals.get(peerId);
      if (v) { later(250, () => v.receive(data, out => later(250, () => { if (running) emit({ type: 'envelope', from: peerId, data: out }); }))); return; }
      later(400, () => emit({ type: 'envelope', from: peerId, data }));
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
