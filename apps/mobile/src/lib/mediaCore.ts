/**
 * Ajustes de mídia (design: Armazenamento → MÍDIA), em TypeScript puro e testado com node:test.
 *
 * - "Qualidade das fotos enviadas": Econômica / Normal / Original ("Menor = chega mais rápido pela
 *   malha"). O design não dá números: Econômica e Normal reduzem o lado maior e regravam em JPEG
 *   (o que também tira os metadados do arquivo, como o local); Original manda o arquivo como está.
 * - "Baixar mídia automaticamente": Wi-Fi e cabo / Sempre / Nunca. Num app sem internet, "Wi-Fi e
 *   cabo" é o meio do vizinho: Wi-Fi Direct, Wi-Fi mesh ou cabo baixam sozinhos; Bluetooth LE e LoRa
 *   esperam a pessoa tocar em "Baixar".
 */
import type { TransportClass } from '../protocol/router';

export type PhotoQuality = 'eco' | 'normal' | 'orig';
export type AutoDownload = 'wifi' | 'always' | 'never';

/** Lado maior (px) e compressão JPEG de cada qualidade; `null` = original, sem regravar. */
export const PHOTO_PLAN: Record<PhotoQuality, { maxSide: number; compress: number } | null> = {
  eco: { maxSide: 1280, compress: 0.6 },
  normal: { maxSide: 2048, compress: 0.8 },
  orig: null,
};

/** Tamanho final mantendo a proporção (nunca aumenta). */
export function fitSize(w: number, h: number, maxSide: number): { width: number; height: number } {
  const big = Math.max(w, h);
  if (!(big > maxSide)) return { width: w, height: h };
  const k = maxSide / big;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Meios que contam como "Wi-Fi e cabo". */
const WIFI_OR_CABLE: ReadonlySet<TransportClass> = new Set(['direct', 'mesh', 'eth']);

/** Baixa sozinho agora? `links`: meios dos vizinhos conectados neste momento. */
export function shouldAutoDownload(auto: AutoDownload, links: Iterable<TransportClass>): boolean {
  if (auto === 'always') return true;
  if (auto === 'never') return false;
  for (const l of links) if (WIFI_OR_CABLE.has(l)) return true;
  return false;
}
