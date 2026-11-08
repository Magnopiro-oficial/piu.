import type { Medium, MediumCaps } from './types';
import { FRAGMENT_BYTES, LORA_MAX_ENVELOPE } from './meshtastic/fragments';

/**
 * Características de cada meio (INF-005). Números conservadores, só para ordenar meios:
 * - Nearby Connections começa em Bluetooth e sobe para Wi-Fi Direct/hotspot quando pode;
 *   payload de bytes de até 32 KB (ConnectionsClient.MAX_BYTES_DATA_SIZE).
 * - Bluetooth LE GATT: MTU negociado de até 517 (512 úteis por escrita), blocos com cabeçalho
 *   de 8 bytes; vazão real de 5–50 KB/s conforme aparelho.
 * - Rede local (LNNP por TCP no Wi-Fi já conectado): envelope inteiro num quadro, vazão de vários MB/s
 *   em qualquer roteador; o rádio Wi-Fi já está ligado, então gasta menos que subir um Wi-Fi Direct.
 *   Envelope grande sai por aqui; o pequeno segue preferindo BLE (mais barato ainda).
 */
export const MEDIA: Record<Medium, MediumCaps> = {
  nearby: { medium: 'nearby', maxEnvelopeBytes: 32 * 1024, mtuBytes: 32 * 1024, approxBytesPerSec: 500_000, energyCost: 3 },
  ble: { medium: 'ble', maxEnvelopeBytes: 32 * 1024, mtuBytes: 512, approxBytesPerSec: 10_000, energyCost: 1 },
  lan: { medium: 'lan', maxEnvelopeBytes: 32 * 1024, mtuBytes: 32 * 1024, approxBytesPerSec: 2_000_000, energyCost: 2 },
  // LoRa (Meshtastic): ~1 kbps compartilhado por todos; custo 4 o põe atrás de qualquer outro meio.
  lora: { medium: 'lora', maxEnvelopeBytes: LORA_MAX_ENVELOPE, mtuBytes: FRAGMENT_BYTES, approxBytesPerSec: 30, energyCost: 4 },
  // LoRa próprio (RNode): mesma malha e mesmos pedaços, sem o cabeçalho e o canal público do Meshtastic;
  // custo 3 o põe à frente do Meshtastic, que fica de reserva (docs/transporte/super-node-lora.md).
  piulora: { medium: 'piulora', maxEnvelopeBytes: LORA_MAX_ENVELOPE, mtuBytes: FRAGMENT_BYTES, approxBytesPerSec: 30, energyCost: 3 },
  sim: { medium: 'sim', maxEnvelopeBytes: 32 * 1024, mtuBytes: 32 * 1024, approxBytesPerSec: 1_000_000, energyCost: 1 },
};

/** Os dois rádios LoRa (Meshtastic e o próprio): mesma malha, mesmas regras (nunca mídia, envelope pequeno). */
export const isLora = (m: Medium | undefined) => m === 'lora' || m === 'piulora';

/** Até este tamanho o envelope é "pequeno": cabe em poucos blocos BLE (~0,2 s). */
export const SMALL_ENVELOPE_BYTES = 2048;
/** Depois de uma falha, o enlace vai para o fim da fila por este tempo (dobra a cada falha seguida). */
export const FAILURE_COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

/** Um enlace (meio) com um vizinho, do ponto de vista da seleção. */
export interface LinkInfo {
  medium: Medium;
  /** Conectado e pronto para enviar. */
  up: boolean;
  /** Falhas de envio seguidas. */
  failures: number;
  /** Momento da última falha (ms). */
  lastFailureAt?: number;
}

export interface SelectContext {
  /** Tamanho do envelope (bytes). */
  size: number;
  /** Bateria baixa: prefere o meio mais econômico (BLE). */
  lowBattery: boolean;
  now: number;
  /** Características dos meios (padrão: `MEDIA`). */
  caps?: Partial<Record<Medium, MediumCaps>>;
  /** Meios desligados pela pessoa. */
  disabled?: ReadonlySet<Medium>;
}

export function inCooldown(l: LinkInfo, now: number): boolean {
  if (!l.failures || l.lastFailureAt === undefined) return false;
  const wait = Math.min(MAX_COOLDOWN_MS, FAILURE_COOLDOWN_MS * 2 ** (l.failures - 1));
  return now - l.lastFailureAt < wait;
}

/**
 * Ordena os enlaces de um vizinho para um envio (FUN-013). O primeiro é a escolha; os demais são
 * a ordem de troca se o envio falhar (FUN-014).
 *
 * 1. Só enlaces conectados, de meios ligados e que aceitam o tamanho do envelope.
 * 2. Bateria baixa ou envelope pequeno → menor custo de energia primeiro (BLE).
 *    Envelope grande → maior banda primeiro (Nearby/Wi-Fi Direct).
 * 3. Enlaces que falharam há pouco vão para o fim (ainda servem de último recurso).
 */
export function rankLinks<L extends LinkInfo>(links: readonly L[], ctx: SelectContext): L[] {
  const cap = (m: Medium) => ctx.caps?.[m] ?? MEDIA[m];
  const usable = links.filter(l => l.up && !ctx.disabled?.has(l.medium) && ctx.size <= cap(l.medium).maxEnvelopeBytes);
  const frugal = ctx.lowBattery || ctx.size <= SMALL_ENVELOPE_BYTES;
  const byEnergy = (a: L, b: L) => cap(a.medium).energyCost - cap(b.medium).energyCost || cap(b.medium).approxBytesPerSec - cap(a.medium).approxBytesPerSec;
  const bySpeed = (a: L, b: L) => cap(b.medium).approxBytesPerSec - cap(a.medium).approxBytesPerSec || cap(a.medium).energyCost - cap(b.medium).energyCost;
  return usable.sort((a, b) => {
    const ca = inCooldown(a, ctx.now), cb = inCooldown(b, ctx.now);
    if (ca !== cb) return ca ? 1 : -1;
    return frugal ? byEnergy(a, b) : bySpeed(a, b);
  });
}

/** Meio preferido para mostrar ao lado do vizinho (o mais rápido entre os conectados, senão o primeiro visto). */
export function displayMedium(links: readonly { medium: Medium; up: boolean }[]): Medium | undefined {
  const up = links.filter(l => l.up);
  const pool = up.length ? up : links;
  return [...pool].sort((a, b) => MEDIA[b.medium].approxBytesPerSec - MEDIA[a.medium].approxBytesPerSec)[0]?.medium;
}
