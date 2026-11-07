import { PiuLan } from '../../../modules/piu-lan';
import { fromBase64, toBase64 } from '../base64';
import type { LanSocketApi, LanSocketEvent } from './types';

/** Soquetes da rede local pelo módulo nativo (modules/piu-lan), ou `null` sem ele. */
export function createNativeLanApi(): LanSocketApi | null {
  const mod = PiuLan;
  if (!mod) return null;
  const listeners = new Set<(e: LanSocketEvent) => void>();
  const emit = (e: LanSocketEvent) => listeners.forEach(fn => { try { fn(e); } catch { /* ouvinte */ } });
  // Um ouvinte nativo por evento, para sempre (o Wi-Fi é observado mesmo com o LAN desligado).
  mod.addListener('onUdp', e => emit({ type: 'udp', host: e.host, port: e.port, data: fromBase64(e.data) }));
  mod.addListener('onAccept', e => emit({ type: 'accept', id: e.id, host: e.host, port: e.port }));
  mod.addListener('onFrame', e => emit({ type: 'frame', id: e.id, data: fromBase64(e.data) }));
  mod.addListener('onClose', e => emit({ type: 'close', id: e.id, reason: e.reason }));
  mod.addListener('onNetwork', e => emit({ type: 'network', info: e }));
  mod.addListener('onMdns', e => emit({ type: 'mdns', name: e.name, host: e.host, port: e.port, tcp: e.tcp ?? null, tag: e.tag ?? null }));
  return {
    start: o => mod.start(o.tcpPort, o.udpPort, o.maxConnections),
    stop: () => mod.stop(),
    udpSend: (host, port, data) => mod.udpSend(host, port, toBase64(data)),
    connect: (host, port, ms) => mod.connect(host, port, ms),
    send: (id, frame) => mod.send(id, toBase64(frame)),
    setFrameLimit: (id, max) => mod.setFrameLimit(id, max),
    close: id => mod.close(id),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    networkInfo: () => mod.networkInfo(),
    probe: (host, port, ms) => mod.probe(host, port, ms),
    mdnsStart: (name, udpPort, txt) => mod.mdnsStart(name, udpPort, txt),
    mdnsStop: () => mod.mdnsStop(),
  };
}
