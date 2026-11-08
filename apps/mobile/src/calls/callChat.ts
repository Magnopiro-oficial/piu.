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

