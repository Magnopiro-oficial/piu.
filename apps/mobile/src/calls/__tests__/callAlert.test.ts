import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERT_VIBRATION, NO_ALERT, alertAction, alertDiff, alertTexts, askNotifNow, planAlert, type AlertEnv, type AlertPlan } from '../callAlert';
import { IDLE, type CallState } from '../callMachine';
import { CALL_ALERT_DICTS, callAlertT } from '../../i18n/callAlert';
import { LANGS, varsOf } from '../../i18n/core';

const ringing: CallState = { ...IDLE, phase: 'ringing', callId: 'c1', peer: 'marina', dir: 'in', route: 'direct', startedAt: 1 };
const active: CallState = { ...ringing, phase: 'active', connectedAt: 2 };
const OUT: AlertEnv = { foreground: false, locked: false };
const OPEN: AlertEnv = { foreground: true, locked: false };
const LOCKED: AlertEnv = { foreground: false, locked: true };

test('alerta: tocando com o app fechado → toque, notificação em tela cheia e tela acesa por cima do bloqueio', () => {
  const p = planAlert(ringing, LOCKED);
  assert.deepEqual(p, { ring: true, incoming: { callId: 'c1', full: true }, ongoing: null, overLock: true, wake: true });
  assert.deepEqual(planAlert(ringing, OUT).incoming, { callId: 'c1', full: true });
});

test('alerta: tocando com o app aberto e desbloqueado → só toque (o aviso in-app já aparece)', () => {
  const p = planAlert(ringing, OPEN);
  assert.equal(p.ring, true);
  assert.equal(p.incoming, null);
});

test('alerta: app vai para segundo plano no meio do toque → notificação sem tela cheia (não reabre o app sozinho)', () => {
  const first = planAlert(ringing, OPEN);
  const p = planAlert(ringing, OUT, first);
  assert.deepEqual(p.incoming, { callId: 'c1', full: false });
});

test('alerta: notificação posta fica até parar de tocar (apagar e acender a tela não repete)', () => {
  const posted = planAlert(ringing, LOCKED);
  const opened = planAlert(ringing, { foreground: true, locked: false }, posted);
  assert.deepEqual(opened.incoming, posted.incoming);
  assert.deepEqual(alertDiff(posted, opened), []);
});

test('alerta: atender para o toque, tira a notificação e liga o serviço do microfone', () => {
  const r = planAlert(ringing, LOCKED);
  const a = planAlert(active, { foreground: true, locked: true }, r);
  assert.deepEqual(a, { ring: false, incoming: null, ongoing: 'c1', overLock: true, wake: false });
  assert.deepEqual(alertDiff(r, a), [
    { do: 'ring', on: false },
    { do: 'incoming', note: null },
    { do: 'lock', overLock: true, wake: false },
    { do: 'ongoing', callId: 'c1' },
  ]);
});

test('alerta: recusar, perder ou atender em outro aparelho → tudo para e a tela volta ao bloqueio', () => {
  const r = planAlert(ringing, LOCKED);
  const idle = planAlert(IDLE, LOCKED, r);
  assert.deepEqual(idle, NO_ALERT);
  assert.deepEqual(alertDiff(r, idle), [{ do: 'ring', on: false }, { do: 'incoming', note: null }, { do: 'lock', overLock: false, wake: false }]);
});

test('alerta: desligar para o serviço; a tela de fim segue por cima do bloqueio só se já estava', () => {
  const a = planAlert(active, LOCKED, planAlert(ringing, LOCKED));
  const ending: CallState = { ...active, phase: 'ending', end: { reason: 'hangup' } };
  const e = planAlert(ending, LOCKED, a);
  assert.equal(e.ongoing, null);
  assert.equal(e.overLock, true);
  assert.deepEqual(alertDiff(a, e), [{ do: 'ongoing', callId: null }]);
  // Minimizada (conversa à mostra): sai de cima do bloqueio e o fim não reaparece sobre ele.
  const mini = planAlert({ ...active, mini: true }, LOCKED, a);
  assert.equal(mini.overLock, false);
  assert.equal(planAlert(ending, LOCKED, mini).overLock, false);
});

test('alerta: chamando (saindo) fica por cima do bloqueio, sem toque, sem acender a tela e sem serviço ainda', () => {
  const calling: CallState = { ...IDLE, phase: 'calling', callId: 'c2', peer: 'm', dir: 'out', stage: 'ringing', route: 'bt' };
  assert.deepEqual(planAlert(calling, LOCKED), { ring: false, incoming: null, ongoing: null, overLock: true, wake: false });
});

test('alerta: folha "pre" e pedido pela malha não mexem no aparelho', () => {
  assert.deepEqual(planAlert({ ...IDLE, phase: 'pre', peer: 'm', preRoute: 'direct' }, LOCKED), NO_ALERT);
  assert.deepEqual(planAlert({ ...IDLE, phase: 'reqIn', peer: 'm', requestId: 'r' }, OUT), NO_ALERT);
});

test('alerta: sem mudança, sem comando; trava liga antes da notificação (tela cheia precisa da flag)', () => {
  const p = planAlert(ringing, OUT);
  assert.deepEqual(alertDiff(p, p), []);
  const cmds = alertDiff(NO_ALERT, p).map(c => c.do);
  assert.deepEqual(cmds, ['lock', 'ring', 'incoming']);
});

test('alerta: ações da notificação valem só para a chamada certa e na fase certa', () => {
  assert.equal(alertAction(ringing, 'answer', 'c1'), 'answer');
  assert.equal(alertAction(ringing, 'decline', 'c1'), 'decline');
  assert.equal(alertAction(ringing, 'answer', 'outra'), null);
  assert.equal(alertAction(ringing, 'answer', ''), null);
  assert.equal(alertAction(ringing, 'hangup', 'c1'), null);
  assert.equal(alertAction(active, 'hangup', 'c1'), 'hangup');
  assert.equal(alertAction(active, 'answer', 'c1'), null);
  assert.equal(alertAction(active, 'show', 'c1'), 'show');
  assert.equal(alertAction(IDLE, 'show', 'c1'), null);
  assert.equal(alertAction(ringing, 'qualquer', 'c1'), null);
});

test('alerta: permissão de notificação é pedida quando a chamada termina, com o app à vista', () => {
  const pre: CallState = { ...IDLE, phase: 'pre', peer: 'm', preRoute: 'direct' };
  const calling: CallState = { ...IDLE, phase: 'calling', callId: 'c', peer: 'm', dir: 'out', stage: 'searching' };
  // Nunca ao ligar: o pedido do microfone vem logo depois e o Android cancela um segundo pedido aberto.
  assert.equal(askNotifNow(pre, calling, OPEN), false);
  assert.equal(askNotifNow(ringing, active, OPEN), false); // nem no meio do toque ou da conversa
  assert.equal(askNotifNow(ringing, IDLE, OPEN), true); // perdida ou recusada
  assert.equal(askNotifNow({ ...active, phase: 'ending' }, IDLE, OPEN), true);
  assert.equal(askNotifNow({ ...calling, phase: 'ending' }, IDLE, OPEN), true); // a primeira que eu liguei
  assert.equal(askNotifNow(ringing, IDLE, OUT), false);
  assert.equal(askNotifNow(ringing, IDLE, { foreground: true, locked: true }), false);
  assert.equal(askNotifNow(pre, IDLE, OPEN), false);
  assert.equal(askNotifNow({ ...IDLE, phase: 'reqIn', peer: 'm', requestId: 'r' }, IDLE, OPEN), false);
});

test('alerta: vibração acompanha o ícone do trilho (0,55 s a cada 1,5 s)', () => {
  assert.deepEqual(ALERT_VIBRATION, [0, 550, 950]);
  assert.equal(ALERT_VIBRATION.reduce((a, b) => a + b, 0), 1500);
});

const echo = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key);

test('alerta: textos só com o nome do contato e o caminho (nada de mensagem)', () => {
  const x = alertTexts(echo, { name: 'Marina Souza', route: 'bt' });
  assert.equal(x.incoming.title, 'Marina Souza');
  assert.equal(x.incoming.body, 'call.incoming.banner(via=call.route.via.bt)');
  assert.equal(x.incoming.answer, 'call.answer');
  assert.equal(x.incoming.decline, 'call.decline');
  assert.equal(x.incoming.publicTitle, 'Piu');
  assert.equal(x.incoming.publicBody, 'call.voice');
  assert.equal(x.ongoing.title, 'callAlert.ongoing(name=Marina Souza)');
  assert.equal(x.ongoing.hangup, 'call.ctl.hangup');
  assert.equal(x.ongoing.publicTitle, 'callAlert.ongoingHidden');
  assert.equal(x.channels.incoming, 'callAlert.channel.incoming');
  assert.equal(x.channels.ongoing, 'callAlert.channel.ongoing');
});

test('alerta: pré-visualização "Nunca" esconde o nome também na chamada', () => {
  const x = alertTexts(echo, { name: 'Marina Souza', route: 'direct', hideName: true });
  const all = JSON.stringify(x);
  assert.ok(!all.includes('Marina'), all);
  assert.equal(x.incoming.title, 'Piu');
  assert.equal(x.ongoing.title, 'callAlert.ongoingHidden');
  // Sem nome conhecido (conversa ainda não carregou): também não fica vazio.
  assert.equal(alertTexts(echo, { name: '', route: 'direct' }).incoming.title, 'Piu');
});

test('alerta: textos em 11 idiomas, mesmas chaves e variáveis do pt-BR', () => {
  const ref = CALL_ALERT_DICTS['pt-BR'];
  for (const { code } of LANGS) {
    const d = CALL_ALERT_DICTS[code];
    assert.ok(d, code);
    assert.deepEqual(Object.keys(d).sort(), Object.keys(ref).sort(), code);
    for (const k of Object.keys(ref)) {
      assert.deepEqual(varsOf(d[k]!), varsOf(ref[k]!), `${code} ${k}`);
      assert.ok(String(d[k]).trim().length > 0, `${code} ${k}`);
    }
  }
  assert.equal(callAlertT('callAlert.ongoing', { name: 'Ana' }, 'pt-BR'), 'Em chamada com Ana');
  assert.equal(callAlertT('callAlert.ongoing', { name: 'Ana' }, 'en'), 'In a call with Ana');
  // As chaves `call.*` vêm do dicionário do app.
  assert.equal(callAlertT('call.answer', undefined, 'pt-BR'), 'Atender');
});

test('alerta: plano novo nunca reaproveita a notificação de outra chamada', () => {
  const prev: AlertPlan = { ...NO_ALERT, ring: true, incoming: { callId: 'velha', full: true } };
  const p = planAlert(ringing, OPEN, prev);
  assert.equal(p.incoming, null);
});
