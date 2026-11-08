import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALL_TIMING, IDLE, fmtDuration, nextRoute, reduce, type CallEvent, type CallState, type Effect } from '../callMachine';

function run(events: CallEvent[], from: CallState = IDLE) {
  let s = from; const effects: Effect[] = [];
  for (const e of events) { const r = reduce(s, e); s = r.state; effects.push(...r.effects); }
  return { s, effects };
}
const sent = (fx: Effect[]) => fx.filter(f => f.kind === 'send').map(f => (f as Extract<Effect, { kind: 'send' }>).signal);
const records = (fx: Effect[]) => fx.filter(f => f.kind === 'record').map(f => (f as Extract<Effect, { kind: 'record' }>).record);

test('4.1 fazer uma chamada: pre → chamando → tocando → ativa → fim (1,7 s) → conversa, com registro', () => {
  const { s, effects } = run([
    { type: 'open', peer: 'marina', route: 'direct' },
    { type: 'dial', callId: 'c1', now: 1000 },
    { type: 'peerRinging', callId: 'c1' },
    { type: 'connected', callId: 'c1', now: 5000 },
    { type: 'hangup', now: 5000 + 134_000 },
  ]);
  assert.equal(s.phase, 'ending');
  assert.deepEqual(sent(effects).map(x => x.t), ['invite', 'end']);
  const [rec] = records(effects);
  assert.equal(rec.outcome, 'done');
  assert.equal(rec.durationMs, 134_000);
  assert.equal(rec.route, 'direct');
  assert.equal(rec.dir, 'out');
  assert.ok(effects.some(f => f.kind === 'timer' && f.name === 'endDone' && f.ms === CALL_TIMING.endScreenMs));
  assert.equal(reduce(s, { type: 'endDone' }).state.phase, 'idle');
  assert.equal(fmtDuration(134_000), '02:14');
});

test('estágios do chamando: procurando → tocando; só Mudo e Alto-falante valem antes de atender', () => {
  let { s } = run([{ type: 'open', peer: 'm', route: 'bt' }, { type: 'dial', callId: 'c', now: 0 }]);
  assert.equal(s.stage, 'searching');
  assert.equal(s.route, 'bt');
  s = reduce(s, { type: 'peerRinging', callId: 'c' }).state;
  assert.equal(s.stage, 'ringing');
  s = reduce(s, { type: 'openWords' }).state;
  assert.equal(s.wordsOpen, false);
  s = reduce(s, { type: 'mute' }).state;
  assert.equal(s.muted, true);
});

test('sem caminho ao vivo não liga: a folha manda pedido de chamada', () => {
  const pre = run([{ type: 'open', peer: 'ana', route: null }]).s;
  assert.equal(reduce(pre, { type: 'dial', callId: 'x', now: 0 }).state.phase, 'pre', 'não disca pela malha');
  const r = reduce(pre, { type: 'sendRequest', requestId: 'q1' });
  assert.equal(r.state.phase, 'idle');
  assert.deepEqual(sent(r.effects), [{ t: 'request', requestId: 'q1' }]);
});

test('4.3 recusar pelo aviso: volta à conversa sem tela de fim, registro "Recusada"', () => {
  const { s, effects } = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'decline', now: 3000 }]);
  assert.equal(s.phase, 'idle');
  assert.deepEqual(sent(effects).map(x => x.t), ['ringing', 'decline']);
  assert.equal(records(effects)[0].outcome, 'declined');
  assert.equal(records(effects)[0].dir, 'in');
});

test('4.4 Mensagem e Em 10 min: recusam com tela de fim, rascunho pronto ou lembrete', () => {
  const msg = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'bt', now: 0 }, { type: 'decline', now: 1, how: 'message' }]);
  assert.equal(msg.s.phase, 'ending');
  assert.ok(msg.effects.some(f => f.kind === 'draft' && f.peer === 'm'));
  assert.deepEqual(sent(msg.effects).at(-1), { t: 'decline', callId: 'c', reason: 'message' });
  const later = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'bt', now: 0 }, { type: 'decline', now: 1, how: 'later' }]);
  assert.ok(later.effects.some(f => f.kind === 'toast' && f.text === 'remindLater'));
});

test('atender liga a mídia e manda o aceite', () => {
  const { s, effects } = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'answer', now: 2000 }]);
  assert.equal(s.phase, 'active');
  assert.equal(s.connectedAt, 2000);
  assert.ok(effects.some(f => f.kind === 'media' && f.on));
  assert.deepEqual(sent(effects).at(-1), { t: 'accept', callId: 'c' });
});

test('ocupado: chamada nova durante outra é recusada com "busy" sem mexer na atual', () => {
  const active = run([{ type: 'incoming', callId: 'a', peer: 'm', route: 'direct', now: 0 }, { type: 'answer', now: 1 }]).s;
  const r = reduce(active, { type: 'incoming', callId: 'b', peer: 'z', route: 'direct', now: 2 });
  assert.equal(r.state, active);
  assert.deepEqual(sent(r.effects), [{ t: 'decline', callId: 'b', reason: 'busy' }]);
});

test('4.7 chamada perdida: quem liga desiste → o outro registra "perdida" com quanto tocou', () => {
  const { s, effects } = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'remoteCancel', callId: 'c', rangMs: 22_000, now: 22_000 }]);
  assert.equal(s.phase, 'idle');
  assert.equal(records(effects)[0].outcome, 'missed');
  assert.equal(records(effects)[0].rangMs, 22_000);
});

test('sem resposta: o chamador desiste no tempo limite e avisa o outro', () => {
  const { s, effects } = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }, { type: 'ringTimeout', now: CALL_TIMING.ringTimeoutMs }]);
  assert.equal(s.end?.reason, 'noanswer');
  assert.deepEqual(sent(effects).at(-1), { t: 'cancel', callId: 'c', rangMs: CALL_TIMING.ringTimeoutMs });
});

test('cancelar antes de atender: "Chamada cancelada"', () => {
  const { s, effects } = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }, { type: 'hangup', now: 3000 }]);
  assert.equal(s.end?.reason, 'cancel');
  assert.equal(records(effects)[0].outcome, 'cancelled');
});

test('troca de caminho: Wi-Fi cai → mudando (sem desligar) → Bluetooth; se nada aparece, termina', () => {
  const active = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'answer', now: 0 }]).s;
  const lost = reduce(active, { type: 'routeLost', now: 10 }).state;
  assert.equal(lost.phase, 'active');
  assert.deepEqual(lost.switching, { from: 'direct', since: 10 });
  const back = reduce(lost, { type: 'routeFound', route: 'bt' }).state;
  assert.equal(back.route, 'bt');
  assert.equal(back.switching, undefined);
  const dead = reduce(lost, { type: 'switchTimeout', now: 20_010 });
  assert.equal(dead.state.end?.reason, 'lost');
  assert.equal(nextRoute(['direct', 'bt', 'point'], 'direct'), 'bt');
  assert.equal(nextRoute(['point'], 'bt'), 'point');
  assert.equal(nextRoute([], 'bt'), null);
});

test('4.9 palavras: iguais → conferidas + aviso; diferentes → encerra por segurança e avisa o outro', () => {
  const active = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'answer', now: 0 }, { type: 'openWords' }]).s;
  assert.equal(active.wordsOpen, true);
  const ok = reduce(active, { type: 'wordsMatch' });
  assert.equal(ok.state.verified, true);
  assert.equal(ok.state.wordsOpen, false);
  const bad = reduce(active, { type: 'wordsDiffer', now: 5 });
  assert.equal(bad.state.end?.reason, 'sas');
  assert.deepEqual(sent(bad.effects).at(-1), { t: 'end', callId: 'c', reason: 'sas' });
  assert.equal(records(bad.effects)[0].outcome, 'sas');
});

test('4.5/4.6 pedido: quem recebe diz "Posso agora", quem pediu liga e conecta sem tocar de novo', () => {
  const callee = run([{ type: 'requestIn', requestId: 'q', peer: 'ana' }, { type: 'requestNow', callId: 'tmp', now: 0 }]);
  assert.equal(callee.s.stage, 'notifying');
  assert.deepEqual(sent(callee.effects), [{ t: 'requestAnswer', requestId: 'q', ok: true }]);
  const caller = reduce(IDLE, { type: 'requestAccepted', requestId: 'q', peer: 'marina', route: 'direct', callId: 'c9', now: 0 });
  assert.equal(caller.state.stage, 'accepted');
  assert.deepEqual(sent(caller.effects)[0], { t: 'invite', callId: 'c9', route: 'direct', requestId: 'q' });
  const linked = reduce(callee.s, { type: 'incoming', callId: 'c9', peer: 'ana', route: 'direct', now: 100, requestId: 'q' });
  assert.equal(linked.state.phase, 'active');
  assert.deepEqual(sent(linked.effects)[0], { t: 'accept', callId: 'c9' });
  const later = run([{ type: 'requestIn', requestId: 'q', peer: 'ana' }, { type: 'requestLater' }]);
  assert.equal(later.s.phase, 'idle');
  assert.deepEqual(sent(later.effects), [{ t: 'requestAnswer', requestId: 'q', ok: false }]);
});

test('atendida em outro aparelho: para de tocar e registra onde', () => {
  const { s, effects } = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'answeredElsewhere', callId: 'c', device: 'Pixel 7a', now: 3600 }]);
  assert.equal(s.phase, 'idle');
  assert.equal(records(effects)[0].outcome, 'elsewhere');
  assert.equal(records(effects)[0].note, 'Pixel 7a');
});

test('sinais de outra chamada são ignorados', () => {
  const calling = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }]).s;
  assert.equal(reduce(calling, { type: 'connected', callId: 'outra', now: 1 }).state, calling);
  assert.equal(reduce(calling, { type: 'remoteDecline', callId: 'outra', reason: 'declined', now: 1 }).state, calling);
});

test('minimizar só durante a chamada; restaurar volta à tela cheia', () => {
  const active = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'answer', now: 0 }]).s;
  const mini = reduce(active, { type: 'minimize' }).state;
  assert.equal(mini.mini, true);
  assert.equal(reduce(mini, { type: 'restore' }).state.mini, false);
  assert.equal(reduce(IDLE, { type: 'minimize' }).state.mini, false);
});

test('cada sinal sai com o destinatário certo (inclusive "ocupado" para quem ligou e recusas que voltam à conversa)', () => {
  const busy = reduce({ ...IDLE, phase: 'active', peer: 'marina', callId: 'a', dir: 'in' }, { type: 'incoming', callId: 'b', peer: 'zé', route: 'direct', now: 0 });
  assert.equal((busy.effects[0] as Extract<Effect, { kind: 'send' }>).peer, 'zé');
  const dec = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'direct', now: 0 }, { type: 'decline', now: 1 }]);
  assert.ok(dec.effects.filter(f => f.kind === 'send').every(f => (f as Extract<Effect, { kind: 'send' }>).peer === 'm'));
  const req = run([{ type: 'open', peer: 'ana', route: null }, { type: 'sendRequest', requestId: 'q' }]);
  assert.equal((req.effects.find(f => f.kind === 'send') as Extract<Effect, { kind: 'send' }>).peer, 'ana');
});
