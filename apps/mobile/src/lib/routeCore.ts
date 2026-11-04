/**
 * Rotas reais das mensagens (TypeScript puro, testado).
 *
 * Cada envio que sai para um vizinho e cada mensagem que chega viram um registro com o meio do
 * enlace (Bluetooth LE, Wi-Fi Direct ou simulado), o tamanho real do envelope, quantos blocos ele
 * ocupa nesse meio, os saltos usados (no recebimento) e a prioridade do cabeçalho. Os nós no caminho
 * não se identificam: o aparelho só sabe do vizinho que entregou ou recebeu.
 *
 * Privacidade → "Não guardar rotas no aparelho": ligado, só a última rota de cada conversa fica, e só
 * na memória (o rodapé da conversa e "Última rota"); desligado, as últimas `ROUTE_HISTORY` de cada
 * conversa são gravadas com o resto dos dados (cifradas).
 */
import { Priority } from '../protocol/envelope';
import { FRAME_HEADER_BYTES } from '../transport/frames';
import { MEDIA } from '../transport/select';
import type { Medium } from '../transport/types';
import type { IconName } from '../ui/Icon';
import { VIA_ICON, VIA_LABEL } from './networkCore';

export interface RouteRec {
  /** Id da mensagem na conversa (o mesmo de `Msg.id`). */
  m: string;
  /** Saiu daqui (`out`) ou chegou (`in`). */
  d: 'out' | 'in';
  /** Meio do enlace com o vizinho. */
  md: Medium;
  /** Saltos usados até aqui (só no recebimento; 1 = direto). */
  h?: number;
  /** Tamanho do envelope (bytes). */
  b: number;
  /** Blocos em que o envelope vai nesse meio. */
  f: number;
  /** Prioridade do cabeçalho. */
  p: Priority;
  /** Quando (ms). */
  at: number;
}
/** Rotas por conversa (id da conversa → registros, do mais antigo ao mais novo). */
export type RouteBook = Record<string, RouteRec[]>;

/** Quantas rotas por conversa ficam gravadas com "Não guardar rotas" desligado. */
export const ROUTE_HISTORY = 20;

/** Rótulos de prioridade (design: "Normal" e "Alta"). */
export const PRIORITY_LABEL: Record<Priority, string> = { [Priority.Low]: 'Baixa', [Priority.Normal]: 'Normal', [Priority.High]: 'Alta', [Priority.Critical]: 'Crítica' };

/** Blocos em que um envelope de `bytes` vai pelo meio (cabeçalho de bloco de transport/frames.ts). */
export function fragmentsFor(bytes: number, medium: Medium): number {
  const size = Math.max(1, MEDIA[medium].mtuBytes - FRAME_HEADER_BYTES);
  return Math.max(1, Math.ceil(bytes / size));
}

/** Registro a partir do que o mensageiro informou (meio já resolvido pelo transporte). */
export function makeRoute(o: { msgId: string; dir: 'out' | 'in'; medium: Medium; bytes: number; hops?: number; priority: Priority; at: number }): RouteRec {
  return { m: o.msgId, d: o.dir, md: o.medium, ...(o.dir === 'in' && o.hops ? { h: o.hops } : {}), b: o.bytes, f: fragmentsFor(o.bytes, o.medium), p: o.priority, at: o.at };
}

const hopsText = (h: number) => (h <= 1 ? 'direto' : `${h} saltos`);

/** Texto do meio, como no design ("Bluetooth LE · direto", "Wi-Fi Direct · 3 saltos"). */
export function routeLabel(r: RouteRec): string {
  const base = VIA_LABEL[r.md];
  return r.d === 'in' && r.h ? `${base} · ${hopsText(r.h)}` : base;
}
export const routeIcon = (r: RouteRec): IconName => VIA_ICON[r.md];

/** Acrescenta (ou troca, se a mesma mensagem já tinha) a rota de uma conversa. `keep`: guardar histórico. */
export function addRoute(book: RouteBook, chatId: string, r: RouteRec, keep: boolean): RouteBook {
  const list = (book[chatId] ?? []).filter(x => !(x.m === r.m && x.d === r.d));
  list.push(r);
  return { ...book, [chatId]: list.slice(-(keep ? ROUTE_HISTORY : 1)) };
}

export const lastRoute = (book: RouteBook, chatId: string): RouteRec | undefined => book[chatId]?.at(-1);
export const routeOf = (book: RouteBook, chatId: string, msgId: string): RouteRec | undefined => book[chatId]?.find(x => x.m === msgId);

/** Sem histórico: fica só a última de cada conversa. */
export function trimBook(book: RouteBook, keep: boolean): RouteBook {
  if (keep) return book;
  const out: RouteBook = {};
  for (const [k, l] of Object.entries(book)) if (l.length) out[k] = l.slice(-1);
  return out;
}

export function dropChatRoutes(book: RouteBook, chatId: string): RouteBook {
  if (!(chatId in book)) return book;
  const { [chatId]: _x, ...rest } = book;
  return rest;
}

/**
 * Tira rotas de conversas que não existem mais e de mensagens que sumiram (temporárias vencidas,
 * apagadas). A última de cada conversa fica: é o "por onde a conversa anda" do rodapé.
 * Devolve o mesmo objeto se nada mudou.
 */
export function pruneRoutes(book: RouteBook, aliveMsgs: Set<string>, chatIds: Set<string>): RouteBook {
  let changed = false;
  const out: RouteBook = {};
  for (const [k, l] of Object.entries(book)) {
    if (!chatIds.has(k)) { changed = true; continue; }
    const keep = l.filter((r, i) => i === l.length - 1 || aliveMsgs.has(r.m));
    if (keep.length !== l.length) changed = true;
    out[k] = keep;
  }
  return changed ? out : book;
}

const MEDIUMS: readonly Medium[] = ['nearby', 'ble', 'sim'];
/** Lê o que foi gravado (descarta o que não tiver a forma esperada). */
export function cleanBook(v: unknown): RouteBook {
  const out: RouteBook = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, l] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(l)) continue;
    const ok = l.filter((r): r is RouteRec => !!r && typeof r === 'object' && typeof r.m === 'string' && (r.d === 'out' || r.d === 'in')
      && MEDIUMS.includes(r.md) && Number.isFinite(r.b) && Number.isFinite(r.f) && Number.isInteger(r.p) && r.p >= 0 && r.p <= 3 && Number.isFinite(r.at));
    if (ok.length) out[k] = ok.slice(-ROUTE_HISTORY);
  }
  return out;
}
