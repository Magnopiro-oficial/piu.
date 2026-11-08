import type { LinkEvent, LinkSource } from './multi';
import { isLora, MEDIA } from './select';
import type { Medium, TransportState } from './types';

/** Enlaces da rede local (lan/controller.ts), vistos como uma fonte a mais. */
export interface LanLinks {
  subscribe(fn: (e: LinkEvent) => void): () => void;
  send(id: string, data: Uint8Array): Promise<void>;
}

const key = (m: Medium, id: string) => m + '|' + id;

/**
 * Junta a fonte nativa (Bluetooth LE + Nearby, como hoje), a rede local e, se houver, os rádios LoRa
 * (Meshtastic, meshtastic/link.ts, e o próprio do Piu, rnode/link.ts) numa fonte só para `multi.ts`,
 * que escolhe o meio por vizinho e faz a ponte entre eles (o roteador do mensageiro repassa o que
 * chega por um meio aos vizinhos dos outros).
 *
 * - `start`/`stop`/intervalo de descoberta vão só para a fonte nativa: o LAN liga e desliga sozinho
 *   (Wi-Fi conectado e chave na aba Rede), sem mudar quando o Bluetooth/Nearby liga.
 * - Estado: "rodando" se qualquer um roda. Quando uma das fontes para, os enlaces DELA caem (down +
 *   lost) e os da outra seguem: desligar o Bluetooth não derruba os vizinhos da rede local.
 */
export function combineSources(primary: LinkSource, lan: LanLinks, lora?: LanLinks, piu?: LanLinks): LinkSource {
  const listeners = new Set<(e: LinkEvent) => void>();
  const emit = (e: LinkEvent) => listeners.forEach(fn => fn(e));
  type Src = 'p' | 'l' | 'r' | 'q';
  const st: Record<Src, { state: TransportState; reason?: string }> = { p: { state: 'off' }, l: { state: 'off' }, r: { state: 'off' }, q: { state: 'off' } };
  const owned: Record<Src, Map<string, { medium: Medium; id: string }>> = { p: new Map(), l: new Map(), r: new Map(), q: new Map() };
  let last: { state: TransportState; reason?: string } = { state: 'off' };

  function combined(): { state: TransportState; reason?: string } {
    const p = st.p, rest = [st.l, st.r, st.q];
    if (p.state === 'running' || rest.some(x => x.state === 'running')) return { state: 'running', reason: p.state === 'running' ? p.reason : undefined };
    if (p.state === 'starting' || rest.some(x => x.state === 'starting')) return { state: 'starting' };
    if (p.state === 'off') return { state: 'off' };
    return { state: p.state, reason: p.reason };
  }

  function onEvent(src: Src, e: LinkEvent) {
    if (e.type === 'state') {
      st[src] = { state: e.state, reason: e.reason };
      const now = combined();
      if (e.state === 'off' || e.state === 'unavailable') {
        // Os enlaces desta fonte somem; se a outra segue rodando, `multi` precisa saber um a um.
        if (now.state !== 'off' && now.state !== 'unavailable') for (const l of owned[src].values()) { emit({ type: 'down', medium: l.medium, id: l.id }); emit({ type: 'lost', medium: l.medium, id: l.id }); }
        owned[src].clear();
      }
      if (now.state !== last.state || now.reason !== last.reason) { last = now; emit({ type: 'state', ...now }); }
      return;
    }
    if (e.type === 'found' || e.type === 'up' || e.type === 'data') owned[src].set(key(e.medium, e.id), { medium: e.medium, id: e.id });
    else if (e.type === 'lost') owned[src].delete(key(e.medium, e.id));
    emit(e);
  }
  primary.subscribe(e => onEvent('p', e));
  lan.subscribe(e => onEvent('l', e));
  lora?.subscribe(e => onEvent('r', e));
  piu?.subscribe(e => onEvent('q', e));

  return {
    kind: primary.kind,
    media: [...primary.media.filter(m => m.medium !== 'lan' && !isLora(m.medium)), MEDIA.lan, ...(lora ? [MEDIA.lora] : []), ...(piu ? [MEDIA.piulora] : [])],
    start: (name, serviceId) => primary.start(name, serviceId),
    stop: () => primary.stop(),
    sendVia: (medium, id, data) => (medium === 'lan' ? lan.send(id, data)
      : medium === 'lora' ? (lora ? lora.send(id, data) : Promise.reject(new Error('Sem rádio LoRa.')))
      : medium === 'piulora' ? (piu ? piu.send(id, data) : Promise.reject(new Error('Sem rádio LoRa do Piu.')))
      : primary.sendVia(medium, id, data)),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    setDiscoveryInterval: sec => primary.setDiscoveryInterval?.(sec),
  };
}
