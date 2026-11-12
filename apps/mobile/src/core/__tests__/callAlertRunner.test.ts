/**
 * Alertas de chamada no núcleo (plano "app fechado", fatia 7). Com a tela desmontada, um sinal de
 * chamada que chega ainda toca e mostra o aviso (tela cheia, Atender/Recusar); quem decide é
 * src/calls/callAlert.ts e o executor fica fora da árvore. Dois CallService de verdade ligados por um
 * fio; só o aparelho (PiuCallAlert) é de teste e grava os comandos.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CallService, type AudioEngine, type CallServicePorts } from '../../calls/callService';
import { createCallAlertRunner, type AlertDevice } from '../callAlertRunner';

const audio = (): AudioEngine => ({ async start() {}, stop() {}, play() {}, setMuted() {}, setSpeaker() {}, tone() {}, levels: () => ({ mine: 0, theirs: 0 }) });

/** A liga para B (os sinais passam pelo fio na hora; os timers só andam se o teste mandar). */
function pair() {
  let n = 0;
  const svc = {} as Record<'a' | 'b', CallService>;
  const ports = (me: 'a' | 'b'): CallServicePorts => {
    const other = me === 'a' ? 'b' : 'a';
    return {
      now: () => 1000, newId: () => `id-${me}-${String(++n).padStart(6, '0')}`,
      sendSignal: (_p, wire) => { svc[other].onSignal(me === 'a' ? 'alice' : 'bob', JSON.parse(JSON.stringify(wire))); return true; },
      record: () => {}, requestUpdate: () => {},
      liveRouteTo: () => 'direct', links: () => [{ peerId: 'link-' + other, medium: 'lan' }],
      sendFrame: (_id, f) => { svc[other].onFrame('link-' + me, 'lan', f); },
      audio: audio(),
      setTimer: () => ({}), clearTimer: () => {}, setInterval: () => 0, clearInterval: () => {},
    };
  };
  svc.a = new CallService(ports('a'));
  svc.b = new CallService(ports('b'));
  return svc;
}

function device(locked = false) {
  const log: string[] = [];
  const lockFns = new Set<(l: boolean) => void>();
  const actionFns = new Set<(e: { action: string; callId: string }) => void>();
  const d: AlertDevice = {
    isLocked: () => locked,
    setLockFlags: (o, w) => log.push(`lock:${o}:${w}`),
    startRinging: () => log.push('ring:on'),
    stopRinging: () => log.push('ring:off'),
    showIncoming: x => log.push(`incoming:${x.callId}:${x.full}:${x.title}`),
    hideIncoming: () => log.push('incoming:hide'),
    startOngoing: x => log.push(`ongoing:${x.callId}`),
    stopOngoing: () => log.push('ongoing:stop'),
    addLockListener: fn => { lockFns.add(fn); return { remove: () => { lockFns.delete(fn); } }; },
    addActionListener: fn => { actionFns.add(fn); return { remove: () => { actionFns.delete(fn); } }; },
  };
  return {
    d, log,
    setLocked: (l: boolean) => { locked = l; lockFns.forEach(f => f(l)); },
    tap: (action: string, callId: string) => actionFns.forEach(f => f({ action, callId })),
    listeners: () => lockFns.size + actionFns.size,
  };
}

function runner(dev: ReturnType<typeof device>, o: { foreground?: boolean; enabled?: boolean } = {}) {
  const fg = new Set<(f: boolean) => void>();
  return createCallAlertRunner({
    device: dev.d, enabled: o.enabled ?? true,
    foreground: () => o.foreground ?? false,
    onForeground: fn => { fg.add(fn); return { remove: () => { fg.delete(fn); } }; },
    nameOf: peer => (peer === 'alice' ? 'Alice' : ''), hideName: () => false, askNotif: () => {},
  });
}

test('chamada recebida sem tela: toca e mostra o aviso em tela cheia; o fim para o toque e esconde', () => {
  const w = pair(), dev = device(), r = runner(dev);
  r.attach(w.b);
  w.a.open('bob'); w.a.controller.dial();
  assert.equal(w.b.state.phase, 'ringing');
  const id = w.b.state.callId!;
  assert.ok(dev.log.includes('ring:on'), dev.log.join());
  assert.ok(dev.log.includes(`incoming:${id}:true:Alice`), dev.log.join());
  dev.log.length = 0;
  w.a.controller.hangup();
  assert.notEqual(w.b.state.phase, 'ringing');
  assert.ok(dev.log.includes('ring:off'), dev.log.join());
  assert.ok(dev.log.includes('incoming:hide'), dev.log.join());
});

test('tela bloqueada: a chamada fica em tela cheia (`shown`) e quem assina é avisado', () => {
  const w = pair(), dev = device(true), r = runner(dev);
  let n = 0;
  r.subscribe(() => n++);
  r.attach(w.b);
  assert.equal(r.getSnapshot().locked, true);
  w.a.open('bob'); w.a.controller.dial();
  assert.equal(r.getSnapshot().shown, w.b.state.callId);
  assert.ok(n > 0);
  // A tela reabre depois (deslizou e voltou): lê o que já está em curso, sem esperar outro sinal.
  assert.equal(runner(dev).getSnapshot().shown, null);
  assert.equal(r.getSnapshot().shown, w.b.state.callId);
});

test('Atender pela notificação: atende, abre a chamada e sobe o aviso do microfone', () => {
  const w = pair(), dev = device(), r = runner(dev);
  r.attach(w.b);
  w.a.open('bob'); w.a.controller.dial();
  const id = w.b.state.callId!;
  dev.tap('answer', id);
  assert.equal(w.b.state.phase, 'active');
  assert.equal(r.getSnapshot().shown, id);
  assert.ok(dev.log.includes(`ongoing:${id}`), dev.log.join());
});

test('serviço trocado (mensageiro novo) ou solto: o aviso anterior sai e os ouvintes são removidos', () => {
  const w = pair(), dev = device(), r = runner(dev);
  r.attach(w.b);
  r.attach(w.b); // o mesmo serviço não duplica ouvintes
  assert.equal(dev.listeners(), 2);
  w.a.open('bob'); w.a.controller.dial();
  dev.log.length = 0;
  r.attach(null);
  assert.deepEqual(dev.log.filter(x => x === 'ring:off' || x === 'incoming:hide'), ['ring:off', 'incoming:hide']);
  assert.equal(dev.listeners(), 0);
  assert.equal(r.getSnapshot().locked, false);
});

test('sem o módulo nativo (iPhone, web): nada toca', () => {
  const w = pair(), dev = device(), r = runner(dev, { enabled: false });
  r.attach(w.b);
  w.a.open('bob'); w.a.controller.dial();
  assert.deepEqual(dev.log, []);
});

test('useCallAlerts só lê o núcleo: sem toque nem aviso na tela', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'state', 'callAlerts.ts'), 'utf8');
  assert.match(src, /useSyncExternalStore\(/);
  assert.doesNotMatch(src, /startRinging|showIncoming|alertDiff|useEffect\(/);
});
