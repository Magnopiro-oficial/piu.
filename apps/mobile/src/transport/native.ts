import { MAX_ENVELOPE_BYTES, PiuTransport } from '../../modules/piu-transport';
import { fromBase64, toBase64 } from './base64';
import type { Transport, TransportEvent } from './types';

/** Transporte nativo (Nearby Connections no Android, Bluetooth LE no iPhone), ou `null` sem o módulo. */
export function createNativeTransport(): Transport | null {
  const mod = PiuTransport;
  if (!mod) return null;
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach(fn => fn(e));
  const subs = [
    mod.addListener('onState', e => emit({ type: 'state', state: e.state, reason: e.reason })),
    mod.addListener('onPeerFound', e => emit({ type: 'peerFound', peer: { id: e.id, name: e.name, via: e.via } })),
    mod.addListener('onPeerLost', e => emit({ type: 'peerLost', id: e.id })),
    mod.addListener('onConnected', e => emit({ type: 'connected', id: e.id, name: e.name })),
    mod.addListener('onDisconnected', e => emit({ type: 'disconnected', id: e.id })),
    mod.addListener('onEnvelope', e => emit({ type: 'envelope', from: e.from, data: fromBase64(e.data) })),
  ];
  void subs; // vivem enquanto o app estiver aberto
  return {
    kind: mod.kind(),
    start: (name, serviceId) => mod.start(name, serviceId),
    stop: () => mod.stop(),
    send: async (peerId, data) => {
      if (data.length > MAX_ENVELOPE_BYTES) throw new Error('Envelope maior que 32 KB.');
      await mod.send(peerId, toBase64(data));
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
