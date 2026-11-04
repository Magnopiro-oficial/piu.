/// <reference types="node" />
/** Horário do Modo nó (messaging/hours.ts): faixa personalizada, meia-noite, dias da semana e o mensageiro. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed } from '../../protocol/keys';
import { customLabel, formatWindow, hoursAllow, inWindow, NIGHT_WINDOW, normHoursChoice, policyHours, validWindow } from '../hours';
import { Messenger } from '../messenger';

const at = (weekday: number, h: number, m = 0) => ({ weekday, minutes: h * 60 + m });
const SEG = 1, SEX = 5, SAB = 6, DOM = 0;

test('faixa no mesmo dia: início incluso, fim excluso', () => {
  const w = { start: 8 * 60, end: 18 * 60 + 30 };
  assert.equal(inWindow(at(SEG, 7, 59), w), false);
  assert.equal(inWindow(at(SEG, 8), w), true);
  assert.equal(inWindow(at(SEG, 18, 29), w), true);
  assert.equal(inWindow(at(SEG, 18, 30), w), false);
});

test('faixa que atravessa a meia-noite (22:00–07:00)', () => {
  const w = { start: 22 * 60, end: 7 * 60 };
  assert.equal(inWindow(at(SEG, 21, 30), w), false);
  assert.equal(inWindow(at(SEG, 22), w), true);
  assert.equal(inWindow(at(SEG, 23, 59), w), true);
  assert.equal(inWindow(at(SEG, 0), w), true);
  assert.equal(inWindow(at(SEG, 6, 59), w), true);
  assert.equal(inWindow(at(SEG, 7), w), false);
  assert.equal(hoursAllow('night', at(SEG, 23)), true);
  assert.equal(hoursAllow('night', at(SEG, 12)), false);
  assert.equal(hoursAllow('always', at(SEG, 12)), true);
  assert.deepEqual(NIGHT_WINDOW, { start: 1320, end: 420 });
});

test('dias da semana: a madrugada pertence ao dia em que a faixa começou', () => {
  const w = { start: 22 * 60, end: 7 * 60, days: [SEX] };
  assert.equal(inWindow(at(SEX, 23), w), true);
  assert.equal(inWindow(at(SAB, 3), w), true, 'sábado de madrugada: começou na sexta');
  assert.equal(inWindow(at(SAB, 23), w), false);
  assert.equal(inWindow(at(SEX, 3), w), false, 'sexta de madrugada: começaria na quinta');
  const fds = { start: 9 * 60, end: 12 * 60, days: [SAB, DOM] };
  assert.equal(inWindow(at(DOM, 10), fds), true);
  assert.equal(inWindow(at(SEG, 10), fds), false);
  // Domingo → segunda (dia 0 menos 1 = sábado, 6).
  assert.equal(inWindow(at(DOM, 2), { start: 23 * 60, end: 3 * 60, days: [SAB] }), true);
});

test('faixa vazia ou inválida: nunca', () => {
  assert.equal(validWindow({ start: 600, end: 600 }), null, 'vazia');
  assert.equal(inWindow(at(SEG, 10), { start: 600, end: 600 }), false);
  assert.equal(validWindow({ start: 615, end: 700 }), null, 'fora do passo de 30 min');
  assert.equal(validWindow({ start: -30, end: 60 }), null);
  assert.equal(validWindow({ start: 0, end: 1440 }), null);
  assert.equal(validWindow({ start: 0, end: 60, days: [] }), null, 'nenhum dia');
  assert.equal(validWindow({ start: 0, end: 60, days: [7] }), null);
  assert.equal(validWindow({ start: 0, end: 60, days: [1, 1] }), null);
  assert.equal(validWindow(null), null);
  assert.equal(inWindow(at(SEG, 10), null), false);
  assert.deepEqual(validWindow({ start: 0, end: 60, days: [0, 1, 2, 3, 4, 5, 6] }), { start: 0, end: 60 }, 'todos os dias = sem filtro');
  assert.deepEqual(validWindow({ start: 0, end: 60, days: [5, 1] }), { start: 0, end: 60, days: [1, 5] });
  assert.equal(formatWindow({ start: 22 * 60, end: 7 * 60 }), '22:00–07:00');
  assert.equal(formatWindow({ start: 8 * 60 + 30, end: 18 * 60, days: [1, 3, 5] }), '08:30–18:00 · seg, qua, sex');
});

test('mensageiro: retransmite só dentro da faixa personalizada e reavalia no tick', () => {
  const seed = newSeed();
  const m = new Messenger({ identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, node: deriveNodeKey(seed), relay: true, now: () => 1_800_000_000, transmit: async () => {}, events: {} });
  let wd = SEG, h = 12, min = 0;
  m.clock = { hour: () => h, minute: () => min, weekday: () => wd, day: () => 'd' + wd };
  const policy = { maxBytes: 1 << 20, retentionSec: 3600, dailyBytes: 1 << 30, bytesPerSec: Infinity };
  m.setPolicy({ ...policy, hours: { start: 22 * 60 + 30, end: 6 * 60, days: [SEX] } });
  assert.equal(m.router.relay, false);
  assert.equal(m.relayStatus().reason, 'hours');
  wd = SEX; h = 22; min = 30; m.tick();
  assert.equal(m.router.relay, true);
  assert.equal(m.relayStatus().reason, null);
  wd = SAB; h = 5; min = 59; m.tick();
  assert.equal(m.router.relay, true, 'madrugada de sábado: ainda na faixa de sexta');
  min = 0; h = 6; m.tick();
  assert.equal(m.router.relay, false);
  // Sempre volta a retransmitir; Modo nó desligado nunca.
  m.setPolicy({ ...policy, hours: 'always' });
  assert.equal(m.router.relay, true);
  m.relay = false;
  assert.equal(m.relayStatus().reason, 'off');
});

test('ajuste salvo: "Personalizado" sem faixa (versão antiga) migra para "Sempre"', () => {
  assert.deepEqual(normHoursChoice('custom', undefined), { hours: 'always' });
  assert.deepEqual(normHoursChoice('custom', { start: 60, end: 60 }), { hours: 'always' });
  assert.deepEqual(normHoursChoice('custom', { start: 1320, end: 420 }), { hours: 'custom', custom: { start: 1320, end: 420 } });
  assert.deepEqual(normHoursChoice('night', { start: 1320, end: 420 }), { hours: 'night', custom: { start: 1320, end: 420 } }, 'a faixa fica guardada para voltar a ela');
  assert.deepEqual(normHoursChoice('x', null), { hours: 'always' });
  assert.equal(policyHours('custom', undefined), 'always');
  assert.deepEqual(policyHours('custom', { start: 0, end: 360, days: [1] }), { start: 0, end: 360, days: [1] });
  assert.equal(policyHours('night', undefined), 'night');
  assert.equal(customLabel({ start: 1320, end: 420 }), 'Personalizado · 22:00–07:00');
  assert.equal(customLabel(undefined), 'Personalizado');
});
