/**
 * Uso de armazenamento do Piu neste aparelho (TypeScript puro, testado).
 * Entrada: cada campo salvo, com o tamanho no disco (cifrado) e o valor aberto. Saída: total no
 * disco e a divisão por tipo. Mídia = fotos embutidas (data: URI) nas conversas e no perfil;
 * de terceiros e recibos = o que o mensageiro informa, dentro do estado dele (`msg.state`).
 */

export interface StoredEntry { key: string; diskBytes: number; value: unknown }
export interface StorageUse { total: number; parts: [string, number][] }

const te = new TextEncoder();
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

const utf8Len = (s: string) => te.encode(s).length;

/** Bytes de fotos embutidas (data: URI) em qualquer lugar do valor. */
export function mediaBytes(v: unknown): number {
  if (typeof v === 'string') { let n = 0; for (const m of v.matchAll(DATA_URI)) n += m[0].length; return n; }
  if (Array.isArray(v)) return v.reduce((a: number, x) => a + mediaBytes(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce((a: number, x) => a + mediaBytes(x), 0);
  return 0;
}

/** Campos de conversa (o resto, como ajustes e registros, vai para "Ajustes e registros"). */
const CHAT_KEYS = new Set(['chats', 'group', 'blocked', 'profile', 'verified', 'msg.state', 'msg.testDevice', 'identity']);

/**
 * `thirdPartyBytes` e `creditsBytes` (tamanho aberto) ficam dentro de `msg.state`: são convertidos
 * para o tamanho no disco pela mesma proporção e limitados ao que `msg.state` ocupa.
 */
export function storageBreakdown(entries: StoredEntry[], o: { thirdPartyBytes?: number; creditsBytes?: number } = {}): StorageUse {
  let chats = 0, media = 0, other = 0, third = 0, credits = 0;
  for (const e of entries) {
    const plain = Math.max(1, utf8Len(typeof e.value === 'string' ? e.value : JSON.stringify(e.value ?? null)));
    const ratio = e.diskBytes / plain;
    const m = Math.min(e.diskBytes, Math.round(mediaBytes(e.value) * ratio));
    let rest = e.diskBytes - m;
    media += m;
    if (e.key === 'msg.state') {
      // Envelopes de terceiros são binários e vão em base64 no estado (×4/3).
      third = Math.min(rest, Math.round((o.thirdPartyBytes ?? 0) * (4 / 3) * ratio)); rest -= third;
      credits = Math.min(rest, Math.round((o.creditsBytes ?? 0) * ratio)); rest -= credits;
    }
    if (CHAT_KEYS.has(e.key)) chats += rest; else other += rest;
  }
  const parts: [string, number][] = [['Conversas', chats], ['Mídia', media], ['De terceiros', third], ['Recibos e créditos', credits], ['Ajustes e registros', other]];
  return { total: chats + media + third + credits + other, parts };
}
