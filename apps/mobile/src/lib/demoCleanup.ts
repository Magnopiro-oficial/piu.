import type { Chat } from '../data/types';

/**
 * Limpeza dos dados de exemplo do protótipo, para quem já tinha o app instalado.
 *
 * As versões anteriores começavam com conversas de exemplo (Marina Alves, Mutirão Vila Esperança,
 * Defesa Civil…) e criavam canais só locais quando as chaves ainda não estavam prontas. Nada disso
 * passa pelo protocolo. Conversa real é a que tem um contato (`peer`, adicionado pelo QR ou pedido
 * de conversa) ou um grupo, canal ou comunidade do protocolo (`group`). O resto sai; as reais ficam
 * intactas, com as mensagens e os arquivos.
 *
 * Funções puras (sem React nem armazenamento), para testar com node:test.
 */

/** Ids das conversas de exemplo do protótipo (para limpar bloqueios e verificações antigas). */
export const DEMO_CHAT_IDS: readonly string[] = ['marina', 'mutirao', 'defesa', 'pedro', 'feira', 'ana', 'radio', 'anon1', 'anon2'];

/** Nome que vinha pré-preenchido no onboarding. */
export const DEMO_PROFILE_NAME = 'Cardeal';

export const isRealChat = (c: Pick<Chat, 'peer' | 'group'> | null | undefined): boolean =>
  !!c && ((typeof c.peer === 'string' && c.peer.startsWith('piu:')) || (typeof c.group === 'string' && c.group.length > 0));

/** Só as conversas reais. Aceita qualquer coisa vinda do disco ou de um backup (descarta o que não é conversa). */
export function cleanChats(saved: unknown): Chat[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((c): c is Chat => !!c && typeof c === 'object' && typeof (c as Chat).id === 'string' && isRealChat(c as Chat));
}

/** Bloqueios: só contatos reais (`piu:…`). Os de conversas de exemplo não bloqueiam ninguém. */
export function cleanBlocked<B extends { id: string }>(saved: unknown): B[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((b): b is B => !!b && typeof b === 'object' && typeof (b as B).id === 'string' && (b as B).id.startsWith('piu:'));
}

/** Verificações: só das conversas que continuam existindo. */
export function cleanVerified(saved: unknown, chats: readonly Pick<Chat, 'id'>[]): Record<string, boolean> {
  if (!saved || typeof saved !== 'object') return {};
  const keep = new Set(chats.map(c => c.id));
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) if (keep.has(k) && v === true) out[k] = true;
  return out;
}

/**
 * Perfil: antes do onboarding, o nome de exemplo ("Cardeal") que vinha preenchido sai, e a pessoa
 * escreve o dela. Depois do onboarding o nome é dela (mesmo que seja Cardeal) e não muda.
 */
export function cleanProfile<P extends { name: string }>(saved: P, onboarded: boolean): P {
  if (onboarded || saved.name !== DEMO_PROFILE_NAME) return saved;
  return { ...saved, name: '' };
}
