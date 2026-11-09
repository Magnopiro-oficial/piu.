import { displayMedium, MEDIA, rankLinks, type LinkInfo } from './select';
import type { Medium, MediumCaps, SentVia, Transport, TransportEvent, TransportKind, TransportState } from './types';

/**
 * Eventos de enlace (um meio com um vizinho), como o módulo nativo os entrega.
 * `id` só é único dentro do meio (endpoint do Nearby, endereço/UUID do Bluetooth LE).
 */
export type LinkEvent =
  | { type: 'state'; state: TransportState; reason?: string }
  /** Enlace visto na descoberta (ou o nome dele ficou conhecido). */
  | { type: 'found'; medium: Medium; id: string; name?: string }
  /** Enlace conectado e pronto para enviar. */
  | { type: 'up'; medium: Medium; id: string; name?: string }
  | { type: 'down'; medium: Medium; id: string }
  /** Enlace sumiu da descoberta. */
  | { type: 'lost'; medium: Medium; id: string }
  | { type: 'data'; medium: Medium; id: string; data: Uint8Array };

/** Fonte de enlaces: o módulo nativo (ou um falso, nos testes). */
export interface LinkSource {
  kind: TransportKind;
  media: readonly MediumCaps[];
  start(name: string, serviceId: string): Promise<void>;
  stop(): Promise<void>;
  sendVia(medium: Medium, id: string, data: Uint8Array): Promise<void>;
  subscribe(fn: (e: LinkEvent) => void): () => void;
  /** Intervalo de descoberta (s), repassado ao módulo nativo. */
  setDiscoveryInterval?(seconds: number): void;
  /** Meios ligados na aba Rede: o desligado nem anuncia nem procura (o Nearby liga o Wi-Fi sozinho). */
  setMediaEnabled?(enabled: Partial<Record<Medium, boolean>>): void;
}

export interface MultiOptions {
  /** Leitura automática de bateria baixa (padrão: nunca). `setPowerHint` tem prioridade. */
  lowBattery?: () => boolean;
  now?: () => number;
}

interface Link extends LinkInfo {
  key: string;
  id: string;
  name?: string;
  /** Visto na descoberta (ainda não perdido). */
  seen: boolean;
  /** Vizinho lógico a que pertence. */
  owner?: string;
}

interface Neighbor {
  id: string;
  name: string;
  links: Set<string>;
  /** Meios que este vizinho já teve (o rádio do Piu fora do alcance some de `links`, mas fica aqui). */
  had: Set<Medium>;
  announced: boolean;
  via?: Medium;
  /** Meios anunciados no último `peerFound` (lista, na ordem dos enlaces). */
  media?: string;
  connected: boolean;
}

const linkKey = (m: Medium, id: string) => m + '|' + id;

/**
 * Junta os enlaces de vários meios em vizinhos lógicos e escolhe, a cada envio, por onde sair
 * (FUN-013), trocando de meio se o envio falhar (FUN-014).
 *
 * Um vizinho lógico é identificado pelo nome curto do nó (`piu-xxxxxx`), que viaja no anúncio do
 * Nearby, no anúncio BLE e no bloco de apresentação (`hello`) do BLE. Enlace ainda sem nome vira
 * um vizinho próprio; quando o nome chega, o enlace migra (o vizinho antigo some e o novo conecta).
 * O nome não é identidade: quem confirma quem é quem são as chaves do Piu, na camada de cima.
 */
export function createMultiTransport(source: LinkSource, opts: MultiOptions = {}): Transport {
  const now = opts.now ?? Date.now;
  const listeners = new Set<(e: TransportEvent) => void>();
  const emit = (e: TransportEvent) => listeners.forEach(fn => fn(e));
  const links = new Map<string, Link>();
  const neighbors = new Map<string, Neighbor>();
  const disabled = new Set<Medium>();
  let powerHint: boolean | null = null;

  const ownerOf = (l: Link) => (l.name ? 'n:' + l.name : 'l:' + l.medium + ':' + l.id);
  const linksOf = (n: Neighbor) => [...n.links].map(k => links.get(k)).filter((l): l is Link => !!l);

  /** LoRa Automático: saiu pelo Meshtastic com o rádio do Piu ligado na escolha da pessoa? Então diz por quê. */
  function sentVia(n: Neighbor, medium: Medium): SentVia {
    if (medium !== 'lora' || !n.had.has('piulora') || disabled.has('piulora')) return { medium };
    const piu = linksOf(n).find(l => l.medium === 'piulora');
    if (!piu?.up) return { medium, fallback: 'away' };
    return piu.failures > 0 ? { medium, fallback: 'failed' } : { medium };
  }

  function sync(n: Neighbor) {
    const ls = linksOf(n);
    if (!ls.length) {
      neighbors.delete(n.id);
      if (n.connected) emit({ type: 'disconnected', id: n.id });
      if (n.announced) emit({ type: 'peerLost', id: n.id });
      return;
    }
    const via = displayMedium(ls)!;
    const media = [...new Set(ls.map(l => l.medium))];
    if (!n.announced || via !== n.via || media.join() !== n.media) {
      n.announced = true; n.via = via; n.media = media.join();
      emit({ type: 'peerFound', peer: { id: n.id, name: n.name, via, media } });
    }
    const up = ls.find(l => l.up);
    if (up && !n.connected) { n.connected = true; emit({ type: 'connected', id: n.id, name: n.name, via: up.medium }); }
    else if (!up && n.connected) { n.connected = false; emit({ type: 'disconnected', id: n.id }); }
  }

  /** Põe o enlace no vizinho certo (migra se o nome mudou) e atualiza os dois. */
  function place(l: Link) {
    const nid = ownerOf(l);
    if (l.owner && l.owner !== nid) {
      const old = neighbors.get(l.owner);
      l.owner = undefined;
      if (old) { old.links.delete(l.key); sync(old); }
    }
    let n = neighbors.get(nid);
    if (!n) { n = { id: nid, name: l.name ?? l.id, links: new Set(), had: new Set(), announced: false, connected: false }; neighbors.set(nid, n); }
    n.links.add(l.key);
    n.had.add(l.medium);
    l.owner = nid;
    sync(n);
  }

  function remove(l: Link) {
    links.delete(l.key);
    const n = l.owner ? neighbors.get(l.owner) : undefined;
    if (n) { n.links.delete(l.key); sync(n); }
  }

  function link(medium: Medium, id: string): Link {
    const key = linkKey(medium, id);
    let l = links.get(key);
    if (!l) { l = { key, medium, id, up: false, seen: false, failures: 0 }; links.set(key, l); }
    return l;
  }

  source.subscribe(e => {
    switch (e.type) {
      case 'state':
        if (e.state === 'off' || e.state === 'unavailable') { links.clear(); neighbors.clear(); }
        emit(e);
        break;
      case 'found': case 'up': {
        const l = link(e.medium, e.id);
        l.seen = true;
        if (e.type === 'up') l.up = true;
        if (e.name) l.name = e.name;
        place(l);
        break;
      }
      case 'down': {
        const l = links.get(linkKey(e.medium, e.id));
        if (!l) break;
        l.up = false;
        if (!l.seen) remove(l); else if (l.owner) { const n = neighbors.get(l.owner); if (n) sync(n); }
        break;
      }
      case 'lost': {
        const l = links.get(linkKey(e.medium, e.id));
        if (!l) break;
        l.seen = false;
        if (!l.up) remove(l);
        break;
      }
      case 'data': {
        let l = links.get(linkKey(e.medium, e.id));
        if (!l) { l = link(e.medium, e.id); l.up = true; l.seen = true; place(l); }
        emit({ type: 'envelope', from: l.owner!, data: e.data, via: e.medium });
        break;
      }
    }
  });

  const maxEnvelope = Math.max(...source.media.map(m => m.maxEnvelopeBytes));
  const caps = Object.fromEntries(source.media.map(m => [m.medium, m])) as Partial<Record<Medium, MediumCaps>>;

  return {
    kind: source.kind,
    media: source.media,
    start: (name, serviceId) => source.start(name, serviceId),
    stop: () => source.stop(),
    send: async (peerId, data) => {
      if (data.length > maxEnvelope) throw new Error(`Envelope maior que ${Math.round(maxEnvelope / 1024)} KB.`);
      const n = neighbors.get(peerId);
      if (!n) throw new Error(`Vizinho ${peerId} não está conectado.`);
      const lowBattery = powerHint ?? opts.lowBattery?.() ?? false;
      const ranked = rankLinks(linksOf(n), { size: data.length, lowBattery, now: now(), caps, disabled });
      if (!ranked.length) throw new Error(`Nenhum meio disponível para ${n.name}.`);
      let last: unknown;
      for (const l of ranked) {
        try {
          await source.sendVia(l.medium, l.id, data);
          l.failures = 0; l.lastFailureAt = undefined;
          return sentVia(n, l.medium);
        } catch (err) {
          l.failures++; l.lastFailureAt = now();
          last = err;
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    setPowerHint: low => { powerHint = low; },
    setDiscoveryInterval: sec => { if (Number.isFinite(sec) && sec > 0) source.setDiscoveryInterval?.(sec); },
    setMediaEnabled: m => {
      for (const [k, on] of Object.entries(m) as [Medium, boolean | undefined][]) {
        if (on === false) disabled.add(k); else if (on === true) disabled.delete(k);
      }
      source.setMediaEnabled?.(m);
    },
  };
}

export { MEDIA };
