/**
 * Menções em grupo e a regra "Só menções acima de 20 mensagens/h" (Ajustes → Notificações → Grupos).
 * TypeScript puro, testado no Node.
 *
 * - Quem envia escreve `@Nome`; o mensageiro acha os membros com esse nome e manda os ids junto da
 *   mensagem (campo `m` do conteúdo do grupo, dentro do envelope cifrado).
 * - Quem recebe conta as mensagens de cada grupo na última hora. Até 20, notifica todas; acima
 *   disso, só as que mencionam a pessoa.
 */

/** Acima disto (mensagens na última hora, no grupo), só menções notificam. */
export const GROUP_BUSY_PER_HOUR = 20;
export const MAX_MENTIONS = 20;
const HOUR = 3600;

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');
/** Letra, número ou sublinhado (qualquer alfabeto): o nome mencionado não pode continuar depois. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Ids dos membros mencionados com `@Nome` no texto (sem diferenciar maiúsculas). Nome mais longo
 * primeiro, para "@Ana Paula" não contar também como "@Ana". `self` (eu) fica de fora.
 */
export function mentionIds(text: string, members: { id: string; name: string }[], self?: string): string[] {
  if (!text.includes('@')) return [];
  const t = norm(text);
  const list = members.filter(m => m.id !== self && m.name.trim()).map(m => ({ id: m.id, n: norm(m.name.trim()) })).sort((a, b) => b.n.length - a.n.length);
  const taken: [number, number][] = [];
  const out: string[] = [];
  for (const m of list) {
    let from = 0;
    for (;;) {
      const i = t.indexOf('@' + m.n, from);
      if (i < 0) break;
      const end = i + 1 + m.n.length;
      from = i + 1;
      const before = i > 0 ? t[i - 1]! : '';
      if ((before && WORD.test(before)) || (end < t.length && WORD.test(t[end]!))) continue;
      if (taken.some(([a, b]) => i < b && end > a)) continue;
      taken.push([i, end]);
      if (!out.includes(m.id)) out.push(m.id);
      break;
    }
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/** Ids recebidos no conteúdo do grupo: só textos curtos, sem repetição, no máximo `MAX_MENTIONS`. */
export function cleanMentions(m: unknown): string[] | undefined {
  if (!Array.isArray(m)) return undefined;
  const ids = [...new Set(m.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, MAX_MENTIONS);
  return ids.length ? ids : undefined;
}

/** Mensagens recebidas por grupo na última hora (só na memória). */
export class GroupRate {
  private hits = new Map<string, number[]>();

  /** Conta uma mensagem nova do grupo em `nowSec` e devolve quantas houve na última hora (com esta). */
  hit(gid: string, nowSec: number): number {
    const list = (this.hits.get(gid) ?? []).filter(t => nowSec - t < HOUR);
    list.push(nowSec);
    this.hits.set(gid, list);
    return list.length;
  }
}

/** Regra de Grupos: até 20 mensagens/h no grupo, notifica; acima, só se mencionou a pessoa. */
export const groupShouldNotify = (perHour: number, mentioned: boolean) => perHour <= GROUP_BUSY_PER_HOUR || mentioned;
