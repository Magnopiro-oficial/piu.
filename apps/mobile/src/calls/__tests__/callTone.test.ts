import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE, type CallState, type EndReason } from '../callMachine';
import { callTone } from '../callTone';

const out: CallState = { ...IDLE, phase: 'calling', callId: 'c', peer: 'm', dir: 'out', route: 'direct', stage: 'searching' };
const ending = (reason: EndReason, dir: 'out' | 'in' = 'out'): CallState => ({ ...out, dir, phase: 'ending', end: { reason } });

test('som de chamando: só em quem liga, enquanto espera o outro lado (procurando, tocando, pedido aceito)', () => {
  assert.equal(callTone(out), 'ringback');
  assert.equal(callTone({ ...out, stage: 'ringing' }), 'ringback');
  assert.equal(callTone({ ...out, stage: 'accepted' }), 'ringback');
  // "Posso agora" a um pedido: quem espera é quem recebeu o pedido, não toca chamando.
  assert.equal(callTone({ ...out, dir: 'in', stage: 'notifying' }), null);
  for (const phase of ['idle', 'pre', 'ringing', 'active', 'reqIn'] as const) assert.equal(callTone({ ...out, phase }), null, phase);
});

test('som de falha: tentativa de quem ligou que não deu certo (ocupado, recusou, sem resposta, sem chamada, sem conexão)', () => {
  for (const r of ['busy', 'declined', 'noanswer', 'nocall', 'unreachable'] as const) assert.equal(callTone(ending(r)), 'fail', r);
});

test('sem som de falha quando eu desliguei, a conversa terminou, ou quem recusou fui eu', () => {
  for (const r of ['cancel', 'hangup', 'remote', 'lost', 'sas'] as const) assert.equal(callTone(ending(r)), null, r);
  assert.equal(callTone(ending('declined', 'in')), null);
  assert.equal(callTone(ending('noanswer', 'in')), null, 'quem disse "Posso agora" e ninguém ligou');
});
