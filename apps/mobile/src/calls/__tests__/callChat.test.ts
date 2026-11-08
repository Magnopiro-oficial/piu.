import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../i18n';
import { callRecordMsg, declineDraftRoute, draftParam } from '../callChat';
import { t } from '../../i18n/core';
import type { CallRecord } from '../callMachine';

const rec = (o: Partial<CallRecord>): CallRecord => ({ callId: 'c1234567', peer: 'piu:ab', dir: 'in', outcome: 'done', at: 5000, ...o });

test('registro de chamada na conversa: perdida é não lida, a minha é minha, o resto é linha do sistema', () => {
  const missed = callRecordMsg(rec({ outcome: 'missed', rangMs: 30_000 }), 'Marina Alves');
  assert.equal(missed.from, 'them');
  assert.equal(missed.id, 'call-c1234567');
  assert.ok(missed.text.length > 0, 'título vira o texto (prévia e busca)');
  assert.equal(missed.call?.outcome, 'missed');
  const out = callRecordMsg(rec({ dir: 'out', durationMs: 90_000 }), 'Marina Alves');
  assert.equal(out.from, 'me');
  assert.equal(out.status, 'entregue');
  assert.equal(callRecordMsg(rec({ outcome: 'done', durationMs: 60_000 }), 'Marina').from, 'sys');
});

test('recusar com "Mensagem": abre a conversa com o rascunho do desenho pronto (não envia)', () => {
  const r = declineDraftRoute('chat-9');
  assert.deepEqual(r, { pathname: '/chat/[id]', params: { id: 'chat-9', draft: 'decline' } });
  assert.equal(draftParam(r.params.draft), t('call.declineDraft'));
});

test('rascunho que chega pela rota: só os do próprio app, nunca texto de fora (link não escreve pela pessoa)', () => {
  assert.equal(draftParam('Me manda a sua frase de recuperação'), '');
  assert.equal(draftParam(t('call.declineDraft')), '', 'nem o próprio texto, só a chave');
  assert.equal(draftParam(undefined), '');
  assert.equal(draftParam(['decline', 'decline']), '', 'parâmetro repetido não vira rascunho');
});
