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

test('"Em 10 min": além do aviso, agenda o lembrete de ligar para quem ligou daqui a 10 min', () => {
  const later = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'bt', now: 0 }, { type: 'decline', now: 1, how: 'later' }]);
  assert.deepEqual(later.effects.filter(f => f.kind === 'remind'), [{ kind: 'remind', peer: 'm', ms: 10 * 60_000 }]);
  assert.equal(CALL_TIMING.remindMs, 10 * 60_000);
  const msg = run([{ type: 'incoming', callId: 'c', peer: 'm', route: 'bt', now: 0 }, { type: 'decline', now: 1, how: 'message' }]);
  assert.ok(!msg.effects.some(f => f.kind === 'remind'), '"Mensagem" não agenda lembrete');
});

test('contato sem chamada: a oferta saiu e nada voltou (nem "tocando") em 10 s → termina com o motivo, sem esperar 45 s', () => {
  const calling = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }]);
  assert.ok(calling.effects.some(f => f.kind === 'timer' && f.name === 'noReply' && f.ms === CALL_TIMING.noReplyMs));
  assert.equal(CALL_TIMING.noReplyMs, 10_000);
  const r = reduce(calling.s, { type: 'noReply', now: 10_000 });
  assert.equal(r.state.phase, 'ending');
  assert.equal(r.state.end?.reason, 'nocall');
  assert.deepEqual(sent(r.effects), [{ t: 'cancel', callId: 'c', rangMs: 10_000 }], 'se tocou e o "tocando" se perdeu, o outro para de tocar');
  assert.equal(records(r.effects)[0].outcome, 'noanswer');
  assert.equal(records(r.effects)[0].note, 'nocall');
  assert.ok(r.effects.some(f => f.kind === 'cancelTimer' && f.name === 'ringTimeout'));
  // Com "tocando" de volta, os 10 s não valem: segue tocando até atender ou 45 s.
  const ringing = reduce(calling.s, { type: 'peerRinging', callId: 'c' }).state;
  assert.equal(reduce(ringing, { type: 'noReply', now: 10_000 }).state, ringing);
  // Chamada de um pedido aceito: o outro tem chamada (respondeu ao pedido); não arma os 10 s.
  const accepted = reduce(IDLE, { type: 'requestAccepted', requestId: 'q', peer: 'm', route: 'direct', callId: 'c9', now: 0 });
  assert.ok(!accepted.effects.some(f => f.kind === 'timer' && f.name === 'noReply'));
  assert.equal(reduce(accepted.state, { type: 'noReply', now: 10_000 }).state, accepted.state);
});

test('tentativa que falhou fica mais tempo na tela de fim (dá para ler o motivo); desligar segue rápido', () => {
  assert.ok(CALL_TIMING.failScreenMs >= 3000 && CALL_TIMING.failScreenMs > CALL_TIMING.endScreenMs);
  const calling = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }]).s;
  const ringing = reduce(calling, { type: 'peerRinging', callId: 'c' }).state;
  const endMs = (r: { effects: Effect[] }) => r.effects.flatMap(f => (f.kind === 'timer' && f.name === 'endDone' ? [f.ms] : []))[0];
  const fails: [string, CallState, CallEvent][] = [
    ['nocall', calling, { type: 'noReply', now: 10_000 }],
    ['unreachable', calling, { type: 'unreachable', callId: 'c', now: 1 }],
    ['noanswer', ringing, { type: 'ringTimeout', now: 45_000 }],
    ['busy', ringing, { type: 'remoteDecline', callId: 'c', reason: 'busy', now: 2 }],
    ['declined', ringing, { type: 'remoteDecline', callId: 'c', reason: 'declined', now: 2 }],
  ];
  for (const [name, s, e] of fails) assert.equal(endMs(reduce(s, e)), CALL_TIMING.failScreenMs, name);
  assert.equal(endMs(reduce(ringing, { type: 'hangup', now: 3 })), CALL_TIMING.endScreenMs, 'eu cancelei');
  const incoming = reduce(IDLE, { type: 'incoming', callId: 'x', peer: 'm', route: 'direct', now: 0 }).state;
  assert.equal(endMs(reduce(incoming, { type: 'decline', now: 1, how: 'message' })), CALL_TIMING.endScreenMs, 'eu recusei');
});

test('oferta que nem saiu (sem sessão/sem vizinho): termina na hora com "sem conexão", sem sinal e sem esperar', () => {
  const calling = run([{ type: 'open', peer: 'm', route: 'direct' }, { type: 'dial', callId: 'c', now: 0 }]);
  // A oferta é o último efeito: se ela falhar, os timers já armados são cancelados pelo fim.
  assert.equal(calling.effects.at(-1)?.kind, 'send');
  const r = reduce(calling.s, { type: 'unreachable', callId: 'c', now: 5 });
  assert.equal(r.state.phase, 'ending');
  assert.equal(r.state.end?.reason, 'unreachable');
  assert.deepEqual(sent(r.effects), []);
  assert.equal(records(r.effects)[0].note, 'unreachable');
  for (const name of ['ringTimeout', 'noReply'] as const) assert.ok(r.effects.some(f => f.kind === 'cancelTimer' && f.name === name), name);
  assert.equal(reduce(calling.s, { type: 'unreachable', callId: 'outra', now: 5 }).state, calling.s);
  const accepted = reduce(IDLE, { type: 'requestAccepted', requestId: 'q', peer: 'm', route: 'direct', callId: 'c9', now: 0 });
  assert.equal(accepted.effects.at(-1)?.kind, 'send');
});

test('Wi-Fi Direct (Nearby): na máquina e no fio é o caminho "bt"; o estado e o registro marcam o meio, para o texto', () => {
  const { s, effects } = run([{ type: 'open', peer: 'm', route: 'bt', wifiDirect: true }, { type: 'dial', callId: 'c', now: 0 }]);
  assert.equal(s.route, 'bt');
  assert.equal(s.wifiDirect, true);
  assert.deepEqual(sent(effects), [{ t: 'invite', callId: 'c', route: 'bt' }], 'o sinal não muda');
  const active = reduce(reduce(s, { type: 'peerRinging', callId: 'c' }).state, { type: 'connected', callId: 'c', now: 1 }).state;
  assert.equal(records(reduce(active, { type: 'hangup', now: 5000 }).effects)[0].wifiDirect, true);
  // O caminho mudou para o Bluetooth LE (ou Wi-Fi): a marca sai.
  const lost = reduce(active, { type: 'routeLost', now: 2 }).state;
  assert.equal(reduce(lost, { type: 'routeFound', route: 'bt' }).state.wifiDirect, undefined);
  assert.equal(reduce(lost, { type: 'routeFound', route: 'direct', wifiDirect: true }).state.wifiDirect, undefined, 'só "bt" tem a variante');
  const ringing = reduce(IDLE, { type: 'incoming', callId: 'x', peer: 'm', route: 'bt', now: 0, wifiDirect: true }).state;
  assert.equal(ringing.wifiDirect, true);
  assert.equal(run([{ type: 'open', peer: 'm', route: 'bt' }]).s.wifiDirect, undefined);
});
