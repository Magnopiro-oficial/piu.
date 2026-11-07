import type { LinkEvent, LinkSource } from './multi';
import { MEDIA } from './select';
import type { Medium, TransportState } from './types';

/** Enlaces da rede local (lan/controller.ts), vistos como uma fonte a mais. */
export interface LanLinks {
  subscribe(fn: (e: LinkEvent) => void): () => void;
  send(id: string, data: Uint8Array): Promise<void>;
}

const key = (m: Medium, id: string) => m + '|' + id;

/**
 * Junta a fonte nativa (Bluetooth LE + Nearby, como hoje) e a rede local numa fonte só para `multi.ts`,
 * que escolhe o meio por vizinho e faz a ponte entre eles (o roteador do mensageiro repassa o que
 * chega por um meio aos vizinhos dos outros).
 *
 * - `start`/`stop`/intervalo de descoberta vão só para a fonte nativa: o LAN liga e desliga sozinho
 *   (Wi-Fi conectado e chave na aba Rede), sem mudar quando o Bluetooth/Nearby liga.
 * - Estado: "rodando" se qualquer um roda. Quando uma das fontes para, os enlaces DELA caem (down +
 *   lost) e os da outra seguem: desligar o Bluetooth não derruba os vizinhos da rede local.
 */
export function combineSources(primary: LinkSource, lan: LanLinks): LinkSource {
  const listeners = new Set<(e: LinkEvent) => void>();
  const emit = (e: LinkEvent) => listeners.forEach(fn => fn(e));
  const st: Record<'p' | 'l', { state: TransportState; reason?: string }> = { p: { state: 'off' }, l: { state: 'off' } };
  const owned: Record<'p' | 'l', Map<string, { medium: Medium; id: string }>> = { p: new Map(), l: new Map() };
  let last: { state: TransportState; reason?: string } = { state: 'off' };

  function combined(): { state: TransportState; reason?: string } {
    const p = st.p, l = st.l;
    if (p.state === 'running' || l.state === 'running') return { state: 'running', reason: p.state === 'running' ? p.reason : undefined };
    if (p.state === 'starting' || l.state === 'starting') return { state: 'starting' };
    if (p.state === 'off') return { state: 'off' };
    return { state: p.state, reason: p.reason };
  }

  function onEvent(src: 'p' | 'l', e: LinkEvent) {
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

  return {
    kind: primary.kind,
    media: [...primary.media.filter(m => m.medium !== 'lan'), MEDIA.lan],
    start: (name, serviceId) => primary.start(name, serviceId),
    stop: () => primary.stop(),
    sendVia: (medium, id, data) => (medium === 'lan' ? lan.send(id, data) : primary.sendVia(medium, id, data)),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    setDiscoveryInterval: sec => primary.setDiscoveryInterval?.(sec),
  };
}
