import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallController, type CallPorts } from '../callController';
import type { CallRecord, Signal } from '../callMachine';

function harness() {
  let now = 1000, id = 0;
  const sent: { peer: string; signal: Signal }[] = [], recs: CallRecord[] = [], media: boolean[] = [];
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  const ports: CallPorts = {
    now: () => now, newId: () => 'id' + ++id,
    send: (peer, signal) => sent.push({ peer, signal }), record: r => recs.push(r), media: on => media.push(on),
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: h => { (h as { dead?: boolean }).dead = true; },
  };
  const fire = (ms: number) => { const t = timers.find(x => !x.dead && x.ms === ms); assert.ok(t, `timer ${ms}`); t!.dead = true; now += ms; t!.fn(); };
  return { c: new CallController(ports), sent, recs, media, fire, tick: (ms: number) => { now += ms; } };
}

test('controlador: liga, conecta, desliga e volta à conversa pelo timer da tela de fim', () => {
  const h = harness(); const seen: string[] = [];
  h.c.subscribe(s => seen.push(s.phase));
  h.c.open('marina', 'direct'); h.c.dial();
  assert.deepEqual(h.sent[0], { peer: 'marina', signal: { t: 'invite', callId: 'id1', route: 'direct' } });
  h.c.dispatch({ type: 'connected', callId: 'id1', now: 2000 });
  assert.deepEqual(h.media, [true]);
  h.tick(60_000); h.c.hangup();
  assert.equal(h.recs[0].durationMs, 60_000 - 1000);
  h.fire(1700);
  assert.equal(h.c.state.phase, 'idle');
  assert.deepEqual(seen, ['pre', 'calling', 'active', 'ending', 'idle']);
});

test('controlador: sem resposta no tempo limite cancela e avisa o outro lado', () => {
  const h = harness();
  h.c.open('m', 'bt'); h.c.dial();
  h.fire(45_000);
  assert.equal(h.c.state.end?.reason, 'noanswer');
  assert.equal(h.sent.at(-1)!.signal.t, 'cancel');
});

test('controlador: conectar cancela o tempo limite (não desliga sozinho depois)', () => {
  const h = harness();
  h.c.open('m', 'direct'); h.c.dial();
  h.c.dispatch({ type: 'connected', callId: 'id1', now: 1 });
  assert.throws(() => h.fire(45_000));
  assert.equal(h.c.state.phase, 'active');
});
