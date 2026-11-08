import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../i18n';
import { callRecordMsg } from '../callChat';
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
