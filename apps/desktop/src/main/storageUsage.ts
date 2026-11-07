/**
 * Espaço usado pelo Piu neste computador (Ajustes → Conversas e mídia), medido de verdade na pasta de dados.
 * - `total`: a pasta inteira (inclui caches do próprio Chromium/Electron).
 * - `messages`: `state.bin` (conversas, contatos, sessões e a fila da malha, cifrados) + `payments.bin`,
 *   descontada a fila de retransmissão.
 * - `relay`: bytes dos envelopes guardados no roteador agora (a fila da malha, incluindo as suas mensagens
 *   que ainda aguardam rota). Estimativa: no disco eles ficam em base64 dentro do `state.bin` cifrado.
 * - `media`: o computador ainda não recebe nem guarda arquivos.
 * Links simbólicos não são seguidos.
 * Detalhe (Conversas → Armazenamento): espaço livre no disco (`statfs`) e o tamanho do histórico de cada
 * conversa, medido como ele vai para o `state.bin` (JSON antes da cifra; AES-GCM não muda o tamanho).
 */
import { existsSync, lstatSync, readdirSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConversationsState } from '../shared/conversations';
import type { StorageUsage } from '../shared/types';

/** Abaixo disso, a tela de armazenamento avisa (D4e). */
export const LOW_DISK_BYTES = 1_000_000_000;
export const lowDisk = (free: number | null) => free !== null && free < LOW_DISK_BYTES;

/** Bytes livres para o usuário no disco da pasta (a mais próxima que existe). `null` se o sistema não disser. */
export function freeBytes(path: string, statfs: (p: string) => { bavail: number | bigint; bsize: number | bigint } = statfsSync): number | null {
  let p = path;
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  try { const s = statfs(p); const n = Number(s.bavail) * Number(s.bsize); return Number.isFinite(n) && n >= 0 ? n : null; }
  catch { return null; }
}

/** Histórico de cada conversa (bytes no estado gravado e quantidade), maior primeiro; vazias ficam de fora. */
export function conversationSizes(s: ConversationsState): { id: string; bytes: number; count: number }[] {
  return Object.entries(s.byContact).filter(([, l]) => l.length > 0)
    .map(([id, l]) => ({ id, bytes: Buffer.byteLength(JSON.stringify(l)), count: l.length }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function dirSize(path: string): number {
  let st;
  try { st = lstatSync(path); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  let names: string[] = [];
  try { names = readdirSync(path); } catch { return 0; }
  for (const n of names) sum += dirSize(join(path, n));
  return sum;
}

export function measureStorage(userData: string, relayBytes: number | null): StorageUsage {
  const state = dirSize(join(userData, 'state.bin')) + dirSize(join(userData, 'payments.bin'));
  const relay = relayBytes === null ? null : Math.max(0, Math.floor(relayBytes));
  return { total: dirSize(userData), messages: Math.max(0, state - (relay ?? 0)), relay, media: 0 };
}
