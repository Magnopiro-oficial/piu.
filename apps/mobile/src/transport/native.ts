import { MAX_ENVELOPE_BYTES, PiuTransport, RELAY_NOTIFICATION, type PiuMedium } from '../../modules/piu-transport';
import { fromBase64, toBase64 } from './base64';
import PiuMeshtastic from '../../modules/piu-meshtastic';
import PiuRNode from '../../modules/piu-meshtastic/rnode';
import { combineSources } from './composite';
import { LoraRadio } from './meshtastic/radio';
import { PiuLoraLink } from './rnode/link';
import { PiuLoraRadio } from './rnode/radio';
import { createLanController } from './lan/controller';
import { createNativeLanApi } from './lan/native';
import { createMultiTransport, type LinkEvent, type LinkSource } from './multi';
import { requestRelayNotificationPermission } from './permissions';
import { watchLowBattery } from './power';
import { MEDIA } from './select';
import type { Transport } from './types';

/**
 * Transporte nativo, ou `null` sem o módulo.
 * Android: Nearby Connections + Bluetooth LE ao mesmo tempo (fala com Android e com iPhone).
 * iPhone: Bluetooth LE. A escolha do meio por vizinho e a troca em caso de falha ficam em `multi.ts`.
 * Android com o módulo piu-lan: mais a rede local (LNNP pelo Wi-Fi), como uma fonte a mais
 * (`composite.ts`), ligada e desligada à parte (`transport.lan`, state/transport.tsx).
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

  const lanApi = createNativeLanApi();
  const lan = createLanController(lanApi);
  const source: LinkSource = {
    kind,
    media,
    start: (name, serviceId) => mod.start(name, serviceId),
    // O serviço em primeiro plano não cai junto: quem decide é state/background.ts (pela tela). Parar aqui
    // (virada do dia, outro nome) derrubaria a tarefa sem tela com o app fechado, e ninguém religaria.
    stop: () => mod.stop(),
    sendVia: async (medium, id, data) => {
      if (data.length > MAX_ENVELOPE_BYTES) throw new Error('Envelope maior que 32 KB.');
      if (medium === 'sim') throw new Error('Meio simulado no transporte nativo.');
      if (medium === 'lan' || medium === 'lora' || medium === 'piulora') throw new Error('Rede local e LoRa vão por fontes próprias (composite.ts).');
      if (mod.sendVia) await mod.sendVia(medium, id, toBase64(data));
      else await mod.send(id, toBase64(data));
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    setDiscoveryInterval: sec => { mod.setDiscoveryInterval?.(sec); },
    setMediaEnabled: m => {
      for (const k of ['nearby', 'ble'] as const) if (m[k] !== undefined && media.some(c => c.medium === k)) mod.setMediumEnabled?.(k, m[k]);
    },
  };
  // Rádio Meshtastic: o enlace LoRa é mais uma fonte; só existe com o módulo piu-meshtastic (Android).
  const radio = PiuMeshtastic.isAvailable() ? new LoraRadio(PiuMeshtastic) : null;
  const lora = radio ? { subscribe: radio.link.subscribe.bind(radio.link), send: radio.link.send.bind(radio.link) } : undefined;
  // Rádio próprio do Piu (RNode): a mesma malha LoRa, preferida ao Meshtastic. Sem região até a pessoa
  // escolher ou confirmar a sugerida pelo país (RegionPicker; a escolha salva chega por state/transport.tsx):
  // o idioma do aparelho não diz onde ele está, e transmitir na faixa de outro país é ilegal.
  const rnode = PiuRNode.isAvailable() ? new PiuLoraRadio(PiuRNode, new PiuLoraLink()) : null;
  const piu = rnode ? { subscribe: rnode.link.subscribe.bind(rnode.link), send: rnode.link.send.bind(rnode.link) } : undefined;
  const transport = createMultiTransport(lanApi || lora || piu ? combineSources(source, lan, lora, piu) : source, { lowBattery: watchLowBattery() });
  transport.lan = lan;
  if (radio) transport.lora = radio;
  if (rnode) transport.piulora = rnode;
  // `notice`: texto do aviso fixo no idioma da pessoa (sem ele, o do Modo nó). O nativo guarda o texto
  // para religar sozinho (processo morto, reinício do aparelho).
  transport.setBackgroundRelay = async (on, notice) => {
    if (!mod.setBackground) return;
    if (on) await requestRelayNotificationPermission();
    const n = notice ?? RELAY_NOTIFICATION;
    await mod.setBackground(on, n.title, n.text);
  };
  // Pulso do PiuRelayService (só enquanto ele está ligado; binários antigos não emitem).
  transport.onHeartbeat = fn => { const s = mod.addListener('onHeartbeat', fn); return () => s.remove(); };
  return transport;
}
