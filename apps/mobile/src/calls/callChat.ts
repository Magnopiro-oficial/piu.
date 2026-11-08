/**
 * Chamada de voz → conversa do celular (puro, testado em __tests__/callChat.test.ts). O registro entra
 * como mensagem com `call` (cartão no lugar do balão) e `text` = título, para a prévia, a busca e o aviso.
 */
import type { Msg } from '../data/types';
import { t } from '../i18n/core';
import { nowHM } from '../lib/text';
import type { CallRecord } from './callMachine';
import { contactOf, recordCard, type Tr } from './callView';

/** Perdida entra como não lida (com aviso); feita por mim, como minha; o resto, como linha do sistema. */
export function callRecordMsg(rec: CallRecord, name: string): Msg {
  const title = recordCard(t as unknown as Tr, rec, contactOf(name), { desktop: false }).title;
  const from: Msg['from'] = rec.dir === 'out' ? 'me' : rec.outcome === 'missed' ? 'them' : 'sys';
  return { id: `call-${rec.callId}`, from, time: nowHM(), at: rec.at, text: title, call: rec, ...(from === 'me' ? { status: 'entregue' as const } : {}) };
}


/** Rascunhos que a rota pode pedir, pela chave: o texto sai do app, nunca do link. */
const DRAFTS = { decline: 'call.declineDraft' } as const;

/**
 * Recusar com "Mensagem": abre a conversa com o rascunho do desenho pronto no campo, sem enviar
 * (o app não guarda rascunhos; a chave vai como parâmetro da rota e a conversa preenche o campo).
 */
export const declineDraftRoute = (chatId: string) =>
  ({ pathname: '/chat/[id]' as const, params: { id: chatId, draft: 'decline' as const } });

/**
 * Rascunho vindo da rota (`?draft=`). Só uma chave de DRAFTS: um link de fora (piu://chat/…?draft=…)
 * não consegue deixar texto dele pronto para a pessoa enviar sem perceber. Nunca é enviado sozinho.
 */
export function draftParam(p: unknown): string {
  return typeof p === 'string' && Object.hasOwn(DRAFTS, p) ? t(DRAFTS[p as keyof typeof DRAFTS]) : '';
}
