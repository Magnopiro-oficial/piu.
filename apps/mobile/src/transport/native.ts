import { MAX_ENVELOPE_BYTES, PiuTransport, RELAY_NOTIFICATION, type PiuMedium } from '../../modules/piu-transport';
import { fromBase64, toBase64 } from './base64';
import { createMultiTransport, type LinkEvent, type LinkSource } from './multi';
import { requestRelayNotificationPermission } from './permissions';
import { watchLowBattery } from './power';
import { MEDIA } from './select';
import type { Transport } from './types';

/**
 * Transporte nativo, ou `null` sem o módulo.
 * Android: Nearby Connections + Bluetooth LE ao mesmo tempo (fala com Android e com iPhone).
 * iPhone: Bluetooth LE. A escolha do meio por vizinho e a troca em caso de falha ficam em `multi.ts`.
 */
export function createNativeTransport(): Transport | null {
  const mod = PiuTransport;
  if (!mod) return null;
  const kind = mod.kind();
  const media = (mod.media?.() ?? [kind]).map(m => MEDIA[m]);
  const via = (v?: PiuMedium): PiuMedium => v ?? kind;
  const listeners = new Set<(e: LinkEvent) => void>();
  const emit = (e: LinkEvent) => listeners.forEach(fn => fn(e));
  const subs = [
    mod.addListener('onState', e => emit({ type: 'state', state: e.state, reason: e.reason })),
    mod.addListener('onPeerFound', e => emit({ type: 'found', medium: via(e.via), id: e.id, name: e.name })),
    mod.addListener('onPeerLost', e => emit({ type: 'lost', medium: via(e.via), id: e.id })),
    mod.addListener('onConnected', e => emit({ type: 'up', medium: via(e.via), id: e.id, name: e.name })),
    mod.addListener('onDisconnected', e => emit({ type: 'down', medium: via(e.via), id: e.id })),
    mod.addListener('onEnvelope', e => emit({ type: 'data', medium: via(e.via), id: e.from, data: fromBase64(e.data) })),
  ];
  void subs; // vivem enquanto o app estiver aberto

  const source: LinkSource = {
    kind,
    media,
    start: (name, serviceId) => mod.start(name, serviceId),
    stop: async () => { await mod.setBackground?.(false, '', ''); await mod.stop(); },
    sendVia: async (medium, id, data) => {
      if (data.length > MAX_ENVELOPE_BYTES) throw new Error('Envelope maior que 32 KB.');
      if (medium === 'sim') throw new Error('Meio simulado no transporte nativo.');
      if (mod.sendVia) await mod.sendVia(medium, id, toBase64(data));
      else await mod.send(id, toBase64(data));
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  const transport = createMultiTransport(source, { lowBattery: watchLowBattery() });
  transport.setBackgroundRelay = async on => {
    if (!mod.setBackground) return;
    if (on) await requestRelayNotificationPermission();
    await mod.setBackground(on, RELAY_NOTIFICATION.title, RELAY_NOTIFICATION.text);
  };
  return transport;
}
