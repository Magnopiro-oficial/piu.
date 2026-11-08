import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE, type CallState } from '../../mobile/src/calls/callMachine';
import { callNoticeText, missedCallsText, ringingCall, shouldNotifyCall, shouldRing } from '../src/shared/callNotify';
import { DEFAULT_PREFS } from '../src/shared/types';

const P = DEFAULT_PREFS;
const ANA = 'piu:' + 'a'.repeat(32);
const ringing: CallState = { ...IDLE, phase: 'ringing', callId: 'c1', peer: ANA, dir: 'in', route: 'direct', startedAt: 1 };

test('chamada tocando aqui: só a recebida na fase "tocando" (chamar, em chamada, fim e pedido pela malha não)', () => {
  assert.deepEqual(ringingCall(ringing), { callId: 'c1', peer: ANA, route: 'direct' });
  assert.equal(ringingCall(null), null);
  assert.equal(ringingCall(IDLE), null);
  for (const phase of ['pre', 'calling', 'active', 'ending', 'reqIn'] as const) assert.equal(ringingCall({ ...ringing, phase }), null, phase);
  assert.equal(ringingCall({ ...ringing, dir: 'out' }), null);
});

test('toque: soa enquanto toca; Não perturbe e conversa silenciada calam o som', () => {
  assert.equal(shouldRing(P, ringing, false), true);
  assert.equal(shouldRing({ ...P, dnd: true }, ringing, false), false);
  assert.equal(shouldRing(P, ringing, true), false);
  assert.equal(shouldRing(P, { ...ringing, phase: 'active' }, false), false, 'atendeu: para');
  assert.equal(shouldRing(P, IDLE, false), false, 'recusou ou terminou: para');
  // O toque não depende do som das notificações (é o som da chamada, como no telefone).
  assert.equal(shouldRing({ ...P, notifSound: false }, ringing, false), true);
});

test('aviso nativo da chamada: regras das mensagens diretas; janela em foco e Piu bloqueado não avisam', () => {
  const o = { muted: false, focused: false, locked: false };
  assert.equal(shouldNotifyCall(P, o), true);
  assert.equal(shouldNotifyCall(P, { ...o, focused: true }), false, 'o aviso já está na janela');
  assert.equal(shouldNotifyCall(P, { ...o, muted: true }), false);
  assert.equal(shouldNotifyCall({ ...P, dnd: true }, o), false);
  assert.equal(shouldNotifyCall({ ...P, notifications: false }, o), false);
  assert.equal(shouldNotifyCall(P, { ...o, locked: true }), false, 'bloqueado: decisão do dono do produto');
});

test('texto do aviso segue "Mostrar no aviso": nome e caminho, só o nome, ou nada', () => {
  assert.deepEqual(callNoticeText('always', 'Ana', 'direct'), { title: 'Chamada de Ana', body: 'Chamada de voz · direto pelo Wi-Fi' });
  assert.deepEqual(callNoticeText('always', 'Ana', 'point'), { title: 'Chamada de Ana', body: 'Chamada de voz · via Ponto Piu' });
  assert.deepEqual(callNoticeText('name', 'Ana', 'direct'), { title: 'Chamada de Ana', body: 'Chamada de voz' });
  assert.deepEqual(callNoticeText('never', 'Ana', 'direct'), { title: 'Piu', body: 'Chamada de voz' });
});

test('ao desbloquear: "Chamada perdida de X" (sem repetir nomes; vários, os primeiros e quantos mais)', () => {
  assert.equal(missedCallsText([]), null);
  assert.equal(missedCallsText(['Ana']), 'Chamada perdida de Ana');
  assert.equal(missedCallsText(['Ana', 'Ana']), 'Chamada perdida de Ana');
  assert.equal(missedCallsText(['Ana', 'Bia']), 'Chamadas perdidas de Ana, Bia');
  assert.equal(missedCallsText(['Ana', 'Bia', 'Caio', 'Davi', 'Eva']), 'Chamadas perdidas de Ana, Bia, Caio +2');
});
