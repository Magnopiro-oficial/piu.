/**
 * Busca de "Nova conversa" (TypeScript puro, testado no Node): o que a pessoa digitou ou colou.
 * - Cartão de contato (`piu1:…`) ou link de convite (`piu://invite/accept?c=…`, ou uma mensagem com
 *   ele): abre o fluxo de adicionar (o mesmo do link e do QR).
 * - Convite de grupo/canal/comunidade (`piug:…`): pede para entrar, como no Escanear código.
 * - `piu:…` (id da chave, também com `@`) ou a impressão digital em blocos (`7F3A 91C2 …`): procura
 *   nos contatos pelo id.
 * - O resto: procura nos contatos pelo nome.
 * Não existe diretório: ninguém é encontrado fora dos seus contatos.
 */
import { cardFromText } from './inviteLink';

export type SearchInput =
  | { kind: 'empty' }
  | { kind: 'card'; card: string }
  | { kind: 'group'; link: string }
  | { kind: 'id'; id: string }
  | { kind: 'name'; term: string };

export const GROUP_LINK_PREFIX = 'piug:';

export function readSearch(text: string): SearchInput {
  const t = text.trim();
  if (!t) return { kind: 'empty' };
  const card = cardFromText(t);
  if (card) return { kind: 'card', card };
  if (t.startsWith(GROUP_LINK_PREFIX)) return { kind: 'group', link: t.split(/\s/)[0]! };
  const id = t.replace(/^@/, '').toLowerCase();
  if (/^piu:[0-9a-f]{1,32}$/.test(id)) return { kind: 'id', id };
  const hex = id.replace(/\s+/g, '');
  if (/^[0-9a-f]{8,32}$/.test(hex) && /[0-9]/.test(hex)) return { kind: 'id', id: 'piu:' + hex };
  return { kind: 'name', term: t.toLowerCase() };
}

/** Contato pelo id: `piu:…` completo ou o começo dele (a partir de 4 caracteres depois de `piu:`). */
export const matchesId = (peer: string | undefined, id: string) => !!peer && (peer === id || (id.length >= 8 && peer.startsWith(id)));
