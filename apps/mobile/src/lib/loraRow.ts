/**
 * Linha "LoRa (Meshtastic)" da aba Rede (desenho Piu 16, 1a–1f) a partir do rádio e do enlace reais.
 * TypeScript puro, testado em __tests__/loraRow.test.ts.
 */
import type { LoraStatus } from '../transport/meshtastic/link';
import { regionLabel } from '../transport/meshtastic/link';
import type { RadioStatus } from '../transport/meshtastic/radio';

export type LoraRowKind = 'none' | 'searching' | 'connected' | 'away' | 'noPerm';
export type LoraRowView = {
  kind: LoraRowKind;
  /** Nome do rádio (conectado ou o último, fora de alcance). */
  radio?: string;
  battery?: number;
  nodes?: number;
  region?: string | null;
  /** Segundos até a próxima janela de rádio, quando há mensagem esperando a vez. */
  busySec?: number;
  /** Super Nodes do Piu no canal (anúncio "PN" assinado), e se algum é gateway. */
  superNodes?: { count: number; gateway: boolean };
};

export function loraRowState(radio: RadioStatus, link: LoraStatus, o: { granted: boolean; now: number }): LoraRowView {
  if (!o.granted) return { kind: 'noPerm' };
  const name = radio.device?.name;
  if (radio.phase === 'scanning' || radio.phase === 'connecting' || radio.phase === 'pairing') return { kind: 'searching' };
  if (radio.phase === 'connected') {
    const busy = link.busyUntil !== undefined && link.busyUntil > o.now ? Math.ceil((link.busyUntil - o.now) / 1000) : undefined;
    return {
      kind: 'connected', radio: name, nodes: link.nodesHeard, region: regionLabel(link.region),
      ...(link.battery !== undefined ? { battery: Math.min(100, link.battery) } : {}),
      ...(busy ? { busySec: busy } : {}),
      ...(link.superNodes ? { superNodes: { count: link.superNodes, gateway: (link.gateways ?? 0) > 0 } } : {}),
    };
  }
  if ((radio.phase === 'away' || radio.phase === 'error') && name) return { kind: 'away', radio: name };
  return { kind: 'none' };
}

/** Sinal em 4 barras e a palavra do desenho (2a). RSSI do Bluetooth em dBm. */
export function signalOf(rssi: number): { bars: 1 | 2 | 3 | 4; word: 'strong' | 'medium' | 'weak' } {
  if (rssi >= -60) return { bars: 4, word: 'strong' };
  if (rssi >= -72) return { bars: 3, word: 'medium' };
  if (rssi >= -84) return { bars: 2, word: 'medium' };
  return { bars: 1, word: 'weak' };
}

/** Motivo do erro de conexão (2d) a partir do código do módulo nativo. */
export function radioErrorKind(code: string | undefined): 'pin' | 'timeout' | 'perm' | 'btOff' | 'other' {
  if (code === 'PIN' || code === 'BOND') return 'pin';
  if (code === 'TIMEOUT') return 'timeout';
  if (code === 'PERMISSION') return 'perm';
  if (code === 'BT_OFF') return 'btOff';
  return 'other';
}
