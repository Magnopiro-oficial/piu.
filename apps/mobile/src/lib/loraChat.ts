/**
 * Conversa quando o LoRa (Meshtastic) é o único caminho (desenho Piu 16, 4a e 4c). TypeScript puro,
 * testado em __tests__/loraChat.test.ts.
 *
 * O LoRa só leva envelopes do primeiro tamanho de preenchimento (256 bytes por dentro, ~593 no ar,
 * 3 pedaços). Medido no mensageiro: texto de até ~160 bytes cabe; acima disso o envelope pula para
 * ~1,4 KB e não cabe (LORA_MAX_ENVELOPE). O limite tem folga para o nome que vai na 1ª mensagem.
 */
import { isLora } from '../transport/select';
import type { Msg } from '../data/types';
import type { Medium } from '../transport/types';

/** Texto (bytes UTF-8) que ainda sai pelo LoRa. */
export const LORA_TEXT_BYTES = 150;
/** A partir de quantos bytes o contador aparece (cinza). */
export const LORA_COUNT_FROM = 120;

const enc = new TextEncoder();
const bytesOf = (s: string) => enc.encode(s).length;

/** Os vizinhos de agora são só a malha LoRa (nenhum Bluetooth, Wi-Fi ou rede local). */
export const onlyLora = (media: readonly Medium[]) => media.length > 0 && media.every(isLora);

export type LoraComposer = { icon: 'arrow_upward' | 'schedule_send'; hint: boolean; count?: { n: number; max: number; over: boolean } };

/** Contador e botão do campo de mensagem (4c): passou do limite, a mensagem não é bloqueada, só espera outro caminho. */
export function loraComposer(text: string, only: boolean): LoraComposer {
  const n = bytesOf(text.trim());
  if (!only || n < LORA_COUNT_FROM) return { icon: 'arrow_upward', hint: false };
  const over = n > LORA_TEXT_BYTES;
  return { icon: over ? 'schedule_send' : 'arrow_upward', hint: over, count: { n, max: LORA_TEXT_BYTES, over } };
}

export type LoraMsgState = { kind: 'turn'; sec: number } | { kind: 'other' } | null;

/**
 * Estado de uma mensagem minha ainda na fila (4a): "na vez do rádio · ~N s" quando cabe e o rádio está
 * sem tempo de ar; "espera outro caminho" para arquivo, foto ou texto longo demais.
 */
export function loraMsgState(m: Msg, only: boolean, busySec: number | undefined): LoraMsgState {
  if (!only || m.from !== 'me' || (m.status !== 'criada' && m.status !== 'aguardando')) return null;
  if (m.file || bytesOf(m.text) > LORA_TEXT_BYTES) return { kind: 'other' };
  return busySec ? { kind: 'turn', sec: busySec } : null;
}
