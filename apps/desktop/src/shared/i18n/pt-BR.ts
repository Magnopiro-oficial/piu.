/**
 * Dicionário de referência (pt-BR) do Piu Desktop. Toda chave nasce aqui, por área (./pt-BR/<área>.ts);
 * os outros idiomas (./<código>.ts) têm as mesmas chaves e as mesmas variáveis `{x}` (test/i18n.test.ts).
 * Plural: objeto `{ one, other }` escolhido por `{count}`. Nomes do produto (Piu, LUNES, LNNP, Mainnet,
 * Touch ID, Keychain) não se traduzem.
 */
import { app } from './pt-BR/app';
import { auth } from './pt-BR/auth';
import { chats } from './pt-BR/chats';
import { common } from './pt-BR/common';
import { guardian } from './pt-BR/guardian';
import { main } from './pt-BR/main';
import { settings } from './pt-BR/settings';
import { updates } from './pt-BR/updates';
import { wallet } from './pt-BR/wallet';

export const ptBR = { ...common, ...app, ...auth, ...chats, ...wallet, ...settings, ...guardian, ...updates, ...main };
