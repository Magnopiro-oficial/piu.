import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallService, type AudioEngine, type CallServicePorts } from '../callService';
import { CALL_TIMING, type CallRecord, type RouteHint } from '../callMachine';
import type { CallTone } from '../callTone';
import type { RequestStep } from '../callView';
import type { Codec } from '../callMedia';
import { newCallKeypair } from '../callCrypto';
import { b64url } from '../../messaging/card';

/** Chave efêmera válida (para convites injetados) e uma de ordem baixa (32 bytes zero). */
const KEY = b64url(newCallKeypair().pk);
const LOW_ORDER = 'A'.repeat(43);

/**
 * Dois aparelhos de verdade (núcleo inteiro), ligados por um "fio" que entrega sinais e quadros.
 * Só o motor de áudio é de teste: grava o que tocou e manda um quadro quando o teste pede.
 */
class TestAudio implements AudioEngine {
  played: number[] = []; muted = false; on = false; speaker?: boolean;
  tones: (CallTone | null)[] = [];
  /** Ordem dos pedidos ao motor (no aparelho, todos entram em fila numa thread só). */
  log: string[] = [];
  private emit?: (c: Codec, p: Uint8Array) => void;
  tone(k: CallTone | null) { this.tones.push(k); this.log.push('tone:' + (k ?? 'none')); }
  setSpeaker(on: boolean) { this.speaker = on; this.log.push('speaker:' + on); }
  async start(f: (c: Codec, p: Uint8Array) => void) { this.on = true; this.emit = f; this.log.push('start'); }
  stop() { this.on = false; this.emit = undefined; this.log.push('stop'); }
  play(_c: Codec, p: Uint8Array) { this.played.push(p.length); }
  setMuted(m: boolean) { this.muted = m; }
  levels() { return { mine: 0, theirs: 0 }; }
  speak(n: number) { this.emit?.('opus', new Uint8Array(n)); }
}

/** `bOld`: o outro não tem chamada (iPhone, 0.1.3 ou anterior): recebe e ignora. `aNoSession`: o sinal de A não sai. */
function pair(route: RouteHint | null = 'direct', o: { bOld?: boolean; aNoSession?: boolean } = {}) {
  let now = 1000, n = 0;
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  const recs = { a: [] as CallRecord[], b: [] as CallRecord[] };
  const reqs: { who: string; step: RequestStep }[] = [];
  const reminds: { who: string; peer: string; ms: number }[] = [];
  let live: RouteHint | null = route;
  const audio = { a: new TestAudio(), b: new TestAudio() };
  const svc: Record<'a' | 'b', CallService> = {} as never;
  const ports = (me: 'a' | 'b'): CallServicePorts => {
    const other = me === 'a' ? 'b' : 'a';
    return {
      now: () => now, newId: () => `id-${me}-${String(++n).padStart(6, '0')}`,
      sendSignal: (_peer, wire) => {
        if (me === 'a' && o.aNoSession) return false;
        if (other === 'b' && o.bOld) return true;
        svc[other].onSignal(me === 'a' ? 'alice' : 'bob', JSON.parse(JSON.stringify(wire))); return true;
      },
      remind: (peer, ms) => reminds.push({ who: me, peer, ms }),
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
  const pending = () => timers.filter(x => !x.dead).map(x => x.ms);
  return { a: svc.a, b: svc.b, audio, recs, reqs, reminds, fire, pending, tick: (ms: number) => { now += ms; }, setLive: (r: RouteHint | null) => { live = r; } };
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
  // O 1º quadro só procura o caminho (ping, nunca áudio a todos: callMedia.ts); o 2º já vai pelo enlace.
  w.audio.a.speak(40); w.audio.a.speak(40); w.audio.b.speak(33);
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

test('resposta "pode ligar" a um pedido que eu não fiz (ou de outro contato) não liga nem abre o microfone', () => {
  const w = pair('direct');
  // Ninguém pediu nada: um contato ao vivo inventa a resposta.
  w.a.onSignal('mallory', { t: 'cl', s: { t: 'requestAnswer', requestId: 'forjado-0001', ok: true } });
  w.a.tryWaiting();
  assert.equal(w.a.state.phase, 'idle');
  assert.equal(w.audio.a.on, false);
  assert.deepEqual(w.reqs, [], 'nem mexe no cartão da conversa');
  // Pedido de verdade para o bob, mas a resposta vem de outro contato com o mesmo id.
  w.setLive(null);
  w.a.open('bob'); w.a.controller.sendRequest();
  const id = (w.a.state.requestId ?? w.b.state.requestId)!;
  w.a.onSignal('mallory', { t: 'cl', s: { t: 'requestAnswer', requestId: id, ok: true } });
  w.setLive('direct'); w.a.tryWaiting();
  assert.notEqual(w.a.state.phase, 'active');
  assert.equal(w.audio.a.on, false);
});

test('a resposta de um pedido vale uma vez só', () => {
  const w = pair(null);
  w.a.open('bob'); w.a.controller.sendRequest();
  const id = w.b.state.requestId!;
  w.setLive('direct');
  w.b.controller.requestNow();
  assert.equal(w.a.state.phase, 'active');
  w.a.controller.hangup();
  while ((w.a.state.phase as string) !== 'idle') w.fire(w.pending().at(-1)!);
  // O bob repete a mesma resposta depois: não liga de novo.
  w.a.onSignal('bob', { t: 'cl', s: { t: 'requestAnswer', requestId: id, ok: true } });
  w.a.tryWaiting();
  assert.notEqual(w.a.state.phase, 'calling');
});

test('convite com id de chamada já usado não toca de novo (Intent repetida não atende chamada nova)', () => {
  const w = pair();
  const invite = { t: 'cl', s: { t: 'invite', callId: 'sempre-o-mesmo', route: 'direct' }, k: KEY };
  w.b.onSignal('alice', invite);
  assert.equal(w.b.state.phase, 'ringing');
  w.b.controller.decline();
  while ((w.b.state.phase as string) !== 'idle') w.fire(w.pending().at(-1)!);
  w.b.onSignal('alice', invite);
  assert.equal(w.b.state.phase, 'idle');
});

test('quem liga sem parar: do 6º convite em 10 min em diante, responde "ocupado" sem tocar', () => {
  const w = pair();
  const sent: string[] = [];
  for (let i = 0; i < 7; i++) {
    w.b.onSignal('alice', { t: 'cl', s: { t: 'invite', callId: `convite-${i}-abcd`, route: 'direct' }, k: KEY });
    sent.push(w.b.state.phase);
    if (w.b.state.phase === 'ringing') { w.b.controller.decline(); while ((w.b.state.phase as string) !== 'idle') w.fire(w.pending().at(-1)!); }
  }
  assert.deepEqual(sent, ['ringing', 'ringing', 'ringing', 'ringing', 'ringing', 'idle', 'idle']);
  w.tick(10 * 60_000);
  w.b.onSignal('alice', { t: 'cl', s: { t: 'invite', callId: 'convite-depois-abcd', route: 'direct' }, k: KEY });
  assert.equal(w.b.state.phase, 'ringing', 'passada a janela, toca de novo');
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
  w.a.onSignal('bob', { t: 'cl', s: { t: 'accept', callId: 'id-x-000999' }, k: KEY });
  assert.equal(w.a.state.phase, 'calling');
  w.a.onSignal('mallory', { t: 'cl', s: { t: 'accept', callId: w.a.state.callId }, k: KEY });
  assert.equal(w.a.state.phase, 'calling');
});

test('contato sem chamada: nada volta em 10 s → termina com o motivo, sem ficar 45 s em "Procurando…"', () => {
  const w = pair('direct', { bOld: true });
  w.a.open('bob'); w.a.controller.dial();
  assert.equal(w.a.state.stage, 'searching');
  w.fire(10_000);
  assert.equal(w.a.state.phase, 'ending');
  assert.equal(w.a.state.end?.reason, 'nocall');
  assert.equal(w.recs.a[0].note, 'nocall');
  assert.ok(!w.pending().includes(45_000), 'o tempo de 45 s foi cancelado');
});

test('oferta que não sai (sem sessão com o contato): termina na hora com "sem conexão", sem timers pendurados', () => {
  const w = pair('direct', { aNoSession: true });
  w.a.open('bob'); w.a.controller.dial();
  assert.equal(w.a.state.phase, 'ending');
  assert.equal(w.a.state.end?.reason, 'unreachable');
  assert.equal(w.b.state.phase, 'idle');
  assert.deepEqual(w.pending(), [CALL_TIMING.failScreenMs], 'só a tela de fim');
  assert.ok(!w.audio.a.on);
});

test('som de chamando: toca enquanto espera e para ao atender; quem recebe não toca chamando', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  assert.deepEqual(w.audio.a.tones, ['ringback']);
  w.b.controller.answer();
  // Sem "none" antes do start: no aparelho o start espera a permissão do microfone e um "none" na
  // frente soltaria a sessão (modo, foco, Bluetooth) só para reabrir em seguida. O start para o tom.
  assert.deepEqual(w.audio.a.log, ['speaker:false', 'tone:ringback', 'start', 'speaker:false'], 'o start para o tom ao atender');
  assert.deepEqual(w.audio.b.tones, []);
  w.a.controller.hangup();
  assert.deepEqual(w.audio.a.log.slice(-1), ['stop'], 'desligar a conversa não pede tom');
});

test('som de chamando segue o alto-falante antes de atender; cancelar para na hora, sem som de falha', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  // A rota vem antes do tom: o "chamando" não começa no alto-falante da chamada anterior.
  assert.deepEqual(w.audio.a.log, ['speaker:false', 'tone:ringback']);
  w.a.controller.dispatch({ type: 'speaker' });
  w.a.controller.hangup();
  // Sem voz aberta, quem solta a sessão é o "none" (sem stop: nada de fechar duas vezes).
  assert.deepEqual(w.audio.a.log, ['speaker:false', 'tone:ringback', 'speaker:true', 'tone:none']);
});

test('sair do serviço com o "chamando" tocando para o tom', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  w.a.dispose();
  assert.deepEqual(w.audio.a.log.slice(-1), ['tone:none']);
});

test('tentativa que falhou: chamando → som de falha → silêncio ao voltar à conversa', () => {
  const w = pair('direct', { bOld: true });
  w.a.open('bob'); w.a.controller.dial();
  w.fire(10_000);
  assert.deepEqual(w.audio.a.tones, ['ringback', 'fail']);
  // Sem stop no meio: a voz nunca abriu, e um stop fecharia a sessão (e o Bluetooth) entre o
  // "chamando" e o ocupado, ou mataria o ocupado se chegasse depois dele.
  assert.deepEqual(w.audio.a.log, ['speaker:false', 'tone:ringback', 'tone:fail']);
  w.fire(CALL_TIMING.failScreenMs);
  assert.equal(w.a.state.phase, 'idle');
  assert.deepEqual(w.audio.a.tones, ['ringback', 'fail', null]);
  assert.deepEqual(w.audio.a.log, ['speaker:false', 'tone:ringback', 'tone:fail', 'tone:none']);
  // Recusada pelo outro: o mesmo som curto.
  const r = pair();
  r.a.open('bob'); r.a.controller.dial(); r.b.controller.decline();
  assert.deepEqual(r.audio.a.tones, ['ringback', 'fail']);
});

test('recusar com "Em 10 min" pede o lembrete ao aparelho (quem ligou, 10 min)', () => {
  const w = pair();
  w.a.open('bob'); w.a.controller.dial();
  w.b.controller.decline('later');
  assert.deepEqual(w.reminds, [{ who: 'b', peer: 'alice', ms: 10 * 60_000 }]);
  assert.equal(w.a.state.end?.reason, 'declined');
});

test('Wi-Fi Direct (Nearby): vai como `bt` com a marca nos dois lados, até o registro na conversa', () => {
  const w = pair('wifiDirect');
  w.a.open('bob');
  assert.deepEqual([w.a.state.preRoute, w.a.state.wifiDirect], ['bt', true]);
  w.a.controller.dial();
  assert.deepEqual([w.a.state.route, w.a.state.wifiDirect], ['bt', true]);
  assert.deepEqual([w.b.state.route, w.b.state.wifiDirect], ['bt', true]);
  w.b.controller.decline();
  assert.deepEqual([w.recs.a[0].route, w.recs.a[0].wifiDirect], ['bt', true]);
  assert.deepEqual([w.recs.b[0].route, w.recs.b[0].wifiDirect], ['bt', true]);
  const v = pair('bt');
  v.a.open('bob');
  assert.equal(v.a.state.wifiDirect, undefined, 'Bluetooth de verdade não leva a marca');
});

test('convite com chave efêmera de ordem baixa: não lança, não toca e responde recusa', () => {
  const w = pair('direct', { bOld: true });
  const sent: unknown[] = [];
  const b = new CallService({
    now: () => 1000, newId: () => 'id-b-000001',
    sendSignal: (_p, wire) => { sent.push(wire); return true; },
    record: () => {}, requestUpdate: () => {}, liveRouteTo: () => 'direct', links: () => [],
    sendFrame: () => {}, audio: w.audio.b, setTimer: () => 0, clearTimer: () => {}, setInterval: () => 0, clearInterval: () => {},
  });
  assert.doesNotThrow(() => b.onSignal('alice', { t: 'cl', s: { t: 'invite', callId: 'convite-ruim-abcd', route: 'direct' }, k: LOW_ORDER }));
  assert.equal(b.state.phase, 'idle');
  assert.ok(!w.audio.b.on, 'microfone fechado');
  assert.deepEqual(sent.map(x => (x as { s: { t: string } }).s.t), ['decline']);
  // Mesmo vindo de um pedido (o aceite sairia dentro do despacho), nada de 'accept'.
  assert.doesNotThrow(() => b.onSignal('alice', { t: 'cl', s: { t: 'invite', callId: 'convite-ruim-efgh', route: 'direct', requestId: 'pedido-0001' }, k: LOW_ORDER }));
  assert.ok(!sent.some(x => (x as { s: { t: string } }).s.t === 'accept'));
  assert.equal(b.words, null);
});

test('aceite com chave efêmera de ordem baixa: não lança, não conecta e encerra a chamada', () => {
  const w = pair('direct', { bOld: true });
  w.a.open('bob'); w.a.controller.dial();
  const callId = w.a.state.callId;
  assert.doesNotThrow(() => w.a.onSignal('bob', { t: 'cl', s: { t: 'accept', callId }, k: LOW_ORDER }));
  assert.notEqual(w.a.state.phase, 'active');
  assert.equal(w.a.state.phase, 'ending');
  assert.equal(w.a.words, null);
  assert.ok(!w.audio.a.on, 'microfone fechado');
});

test('pedidos de chamada sem parar: mesmo id não conta de novo e do 4º pedido em 10 min em diante é ignorado', () => {
  const w = pair(null);
  const req = (id: string) => w.b.onSignal('alice', { t: 'cl', s: { t: 'request', requestId: id } });
  req('pedido-repetido-01');
  req('pedido-repetido-01');
  assert.equal(w.reqs.filter(r => r.who === 'b').length, 1, 'id repetido não vira outro cartão');
  for (let i = 0; i < 5; i++) req(`pedido-novo-${i}-abcd`);
  assert.equal(w.reqs.filter(r => r.who === 'b').length, 3, 'no máximo 3 pedidos por contato a cada 10 min');
  w.tick(10 * 60_000);
  req('pedido-depois-abcd');
  assert.equal(w.reqs.filter(r => r.who === 'b').length, 4, 'passada a janela, aceita de novo');
});
