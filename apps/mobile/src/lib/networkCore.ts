/**
 * Números da aba Rede a partir do transporte e do mensageiro reais (TypeScript puro, testado).
 * - Vizinhos: os que o transporte descobriu (nativo; no Expo Go e na web, o simulado, que só tem o
 *   aparelho de teste). A posição no radar sai do id (estável), não de uma distância medida:
 *   o transporte não informa distância.
 * - Modo nó: pacotes retransmitidos hoje, taxa de entrega dos últimos 7 dias e espaço de terceiros.
 */
import type { IconName } from '../ui/Icon';

export type TxKey = 'ble' | 'direct' | 'mesh' | 'lora' | 'eth';
export type PeerVia = 'ble' | 'nearby' | 'sim';

export const VIA_LABEL: Record<PeerVia, string> = { ble: 'Bluetooth LE', nearby: 'Wi-Fi Direct', sim: 'Simulado' };
export const VIA_ICON: Record<PeerVia, IconName> = { ble: 'bluetooth', nearby: 'wifi_tethering', sim: 'smartphone' };
/** Transporte da aba Rede que corresponde ao meio do vizinho (o simulado não tem chave). */
export const VIA_TX: Record<PeerVia, TxKey | null> = { ble: 'ble', nearby: 'direct', sim: null };

/** Posição estável no radar (% da largura e da altura), entre os anéis, longe do centro e das bordas. */
export function radarPos(id: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  // Mistura final (murmur3): ids parecidos ("sim-0", "sim-1") caem em pontos distantes.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  const r = 22 + ((h >>> 16) % 1000) / 1000 * 16; // 22–38% do centro
  return { x: Math.round(50 + Math.cos(angle) * r * 1.1), y: Math.round(50 + Math.sin(angle) * r) };
}

export function fmtBytes(b: number): string {
  if (b === 0) return '0 MB';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(Math.round((b / 1048576) * 10) / 10).toLocaleString('pt-BR')} MB`;
  return `${(Math.round((b / 1024 ** 3) * 10) / 10).toLocaleString('pt-BR')} GB`;
}

export interface NodeMetrics { relayedToday: number; sent: number; delivered: number; thirdPartyBytes: number }

/** Os três números do cartão Modo nó. Sem métricas (antes das chaves), traços. */
export function relayCard(m: NodeMetrics | null, relay: boolean): [string, string][] {
  if (!m) return [['—', 'pacotes hoje'], ['—', 'entregues'], ['0 MB', 'em uso']];
  const rate = m.sent ? `${(Math.round((m.delivered / m.sent) * 1000) / 10).toLocaleString('pt-BR')}%` : '—';
  return [[relay ? m.relayedToday.toLocaleString('pt-BR') : '—', 'pacotes hoje'], [rate, 'entregues'], [fmtBytes(m.thirdPartyBytes), 'em uso']];
}

/** Linha de status do topo da aba Rede. */
export function meshStatus(state: 'off' | 'starting' | 'running' | 'unavailable', connected: number): string {
  if (state === 'running') return connected ? `Sem internet · malha local ativa · ${connected} ${connected === 1 ? 'vizinho' : 'vizinhos'}` : 'Sem internet · procurando vizinhos';
  if (state === 'starting') return 'Ligando a malha local…';
  if (state === 'unavailable') return 'Malha local indisponível neste aparelho';
  return 'Malha local desligada';
}
