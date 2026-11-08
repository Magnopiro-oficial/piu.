import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallService, type AudioEngine, type CallServicePorts } from '../callService';
import type { CallRecord, LiveRoute } from '../callMachine';
import type { RequestStep } from '../callView';
import type { Codec } from '../callMedia';

/**
 * Dois aparelhos de verdade (núcleo inteiro), ligados por um "fio" que entrega sinais e quadros.
 * Só o motor de áudio é de teste: grava o que tocou e manda um quadro quando o teste pede.
 */
class TestAudio implements AudioEngine {
  played: number[] = []; muted = false; on = false;
  private emit?: (c: Codec, p: Uint8Array) => void;
  async start(f: (c: Codec, p: Uint8Array) => void) { this.on = true; this.emit = f; }
  stop() { this.on = false; this.emit = undefined; }
  play(_c: Codec, p: Uint8Array) { this.played.push(p.length); }
  setMuted(m: boolean) { this.muted = m; }
  levels() { return { mine: 0, theirs: 0 }; }
  speak(n: number) { this.emit?.('opus', new Uint8Array(n)); }
}

function pair(route: LiveRoute | null = 'direct') {
  let now = 1000, n = 0;
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  const recs = { a: [] as CallRecord[], b: [] as CallRecord[] };
  const reqs: { who: string; step: RequestStep }[] = [];
  let live: LiveRoute | null = route;
  const audio = { a: new TestAudio(), b: new TestAudio() };
  const svc: Record<'a' | 'b', CallService> = {} as never;
  const ports = (me: 'a' | 'b'): CallServicePorts => {
    const other = me === 'a' ? 'b' : 'a';
    return {
      now: () => now, newId: () => `id-${me}-${String(++n).padStart(6, '0')}`,
      sendSignal: (_peer, wire) => { svc[other].onSignal(me === 'a' ? 'alice' : 'bob', JSON.parse(JSON.stringify(wire))); return true; },
      record: r => recs[me].push(r),
      requestUpdate: (_p, _id, step) => reqs.push({ who: me, step }),
      liveRouteTo: () => live,
      links: () => [{ peerId: 'link-' + other, medium: 'lan' }],
      sendFrame: (_peerId, f) => { svc[other].onFrame('link-' + me, 'lan', f); },
      audio: audio[me],
      setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
      clearTimer: h => { (h as { dead?: boolean }).dead = true; },
      setInterval: () => 0, clearInterval: () => {},
    };
  };
  svc.a = new CallService(ports('a'));
  svc.b = new CallService(ports('b'));
  const fire = (ms: number) => { const t = timers.find(x => !x.dead && x.ms === ms); assert.ok(t); t!.dead = true; now += ms; t!.fn(); };
  return { a: svc.a, b: svc.b, audio, recs, reqs, fire, tick: (ms: number) => { now += ms; }, setLive: (r: LiveRoute | null) => { live = r; } };
}

test('chamada de ponta a ponta: toca, atende, voz nos dois sentidos, mesmas 4 palavras, desliga e registra dos dois lados', () => {
  const w = pair();
  w.a.open('bob');
  assert.equal(w.a.state.phase, 'pre');
  w.a.controller.dial();
  assert.equal(w.b.state.phase, 'ringing');
  assert.equal(w.a.state.stage, 'ringing', 'o outro avisou que está tocando');
  w.b.controller.answer();
  assert.equal(w.a.state.phase, 'active');
  assert.equal(w.b.state.phase, 'active');
  assert.ok(w.a.words && w.a.words.length === 4);
  assert.deepEqual(w.a.words, w.b.words);
  assert.ok(w.audio.a.on && w.audio.b.on);
  w.audio.a.speak(40); w.audio.b.speak(33);
  assert.deepEqual(w.audio.b.played, [40]);
  assert.deepEqual(w.audio.a.played, [33]);
  w.tick(90_000);
  w.a.controller.hangup();
  assert.equal(w.a.state.phase, 'ending');
  assert.equal(w.b.state.phase, 'ending');
  assert.equal(w.recs.a[0].outcome, 'done');
  assert.equal(w.recs.a[0].dir, 'out');
  assert.equal(w.recs.b[0].outcome, 'done');
  assert.equal(w.recs.b[0].dir, 'in');
  assert.ok(!w.audio.a.on && !w.audio.b.on, 'microfone fechado no fim');
  assert.equal(w.a.words, null, 'chaves apagadas');
});

test('recusar do outro lado e chamada perdida', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  w.b.controller.decline();
  assert.equal(w.a.state.end?.reason, 'declined');
  assert.equal(w.b.state.phase, 'idle');
  const v = pair();
  v.a.open('bob'); v.a.controller.dial();
  v.tick(22_000);
  v.a.controller.hangup();
  assert.equal(v.recs.b[0].outcome, 'missed');
  assert.equal(v.recs.b[0].rangMs, 22_000);
});

test('sem caminho ao vivo: pedido pela malha → aceito → liga sozinho e conecta sem tocar de novo', () => {
  const w = pair(null);
  w.a.open('bob');
  assert.equal(w.a.state.preRoute, null);
  w.a.controller.sendRequest();
  assert.equal(w.b.state.phase, 'reqIn');
  w.setLive('direct');
  w.b.controller.requestNow();
  assert.equal(w.a.state.phase, 'active');
  assert.equal(w.b.state.phase, 'active');
  assert.deepEqual(w.reqs.map(r => `${r.who}:${r.step}`), ['a:traveling', 'b:delivered', 'a:accepted']);
});

test('palavras diferentes encerram dos dois lados por segurança', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial(); w.b.controller.answer();
  w.b.controller.wordsDiffer();
  assert.equal(w.a.state.end?.reason, 'sas');
  assert.equal(w.b.state.end?.reason, 'sas');
});

test('aceite forjado (outra chamada ou sem chave) não conecta', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  w.a.onSignal('bob', { t: 'cl', s: { t: 'accept', callId: 'id-x-000999' }, k: 'A'.repeat(43) });
  assert.equal(w.a.state.phase, 'calling');
  w.a.onSignal('mallory', { t: 'cl', s: { t: 'accept', callId: w.a.state.callId }, k: 'A'.repeat(43) });
  assert.equal(w.a.state.phase, 'calling');
});
