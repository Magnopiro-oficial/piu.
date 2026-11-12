/**
 * Ajustes do aparelho para "Receber com o app fechado" (lib/bgSetupCore.ts): o que falta configurar
 * e quando o app pede, uma vez, logo depois do onboarding.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingSteps, oemOf, setupNote, shouldAskBgSetup, type PowerInfo } from '../bgSetupCore';
import { ptBR } from '../../i18n/pt-BR';

const power = (o: Partial<PowerInfo> = {}): PowerInfo => ({ ignoringBattery: false, manufacturer: 'Google', brand: 'google', ...o });

test('fabricante: Xiaomi, Redmi e POCO (pelo fabricante ou pela marca) contam como Xiaomi', () => {
  assert.equal(oemOf('Xiaomi', 'Redmi'), 'xiaomi');
  assert.equal(oemOf('XIAOMI', 'POCO'), 'xiaomi');
  assert.equal(oemOf('', 'poco'), 'xiaomi');
  assert.equal(oemOf('Redmi', ''), 'xiaomi');
  assert.equal(oemOf('samsung', 'samsung'), 'samsung');
  assert.equal(oemOf('Google', 'google'), 'other');
  assert.equal(oemOf('', ''), 'other');
});

test('o que falta: isenção de bateria em todos; Inicialização automática só na Xiaomi, até a pessoa dizer "Já liguei"', () => {
  assert.deepEqual(missingSteps(power(), false), ['battery']);
  assert.deepEqual(missingSteps(power({ ignoringBattery: true }), false), []);
  const mi = power({ manufacturer: 'Xiaomi', brand: 'Redmi' });
  assert.deepEqual(missingSteps(mi, false), ['battery', 'autostart']);
  assert.deepEqual(missingSteps(mi, true), ['battery']);
  assert.deepEqual(missingSteps({ ...mi, ignoringBattery: true }, true), []);
  // Sem o módulo nativo (iPhone, web, binário antigo): não se sabe, não pede nada.
  assert.deepEqual(missingSteps(null, false), []);
});

test('orientação curta por fabricante: a já existente da aba Rede', () => {
  assert.equal(setupNote('xiaomi'), 'network.receiveClosed.guide.xiaomi');
  assert.equal(setupNote('samsung'), 'network.receiveClosed.guide.samsung');
  assert.equal(setupNote('other'), null);
  for (const k of ['xiaomi', 'samsung'] as const) assert.ok(setupNote(k)! in ptBR);
});

test('quando pedir: uma vez, depois do onboarding, com o cofre e o ajuste ligado', () => {
  const ok = { android: true, onboarded: true, hasKeys: true, receiveClosed: true, asked: false, locked: false, missing: ['battery'] as const };
  assert.equal(shouldAskBgSetup(ok), true);
  assert.equal(shouldAskBgSetup({ ...ok, onboarded: false }), false, 'durante o onboarding');
  assert.equal(shouldAskBgSetup({ ...ok, hasKeys: false }), false, 'antes do cofre existir');
  assert.equal(shouldAskBgSetup({ ...ok, receiveClosed: false }), false, 'ajuste desligado');
  assert.equal(shouldAskBgSetup({ ...ok, asked: true }), false, 'já pediu uma vez: depois só a aba Rede');
  assert.equal(shouldAskBgSetup({ ...ok, missing: [] }), false, 'nada a configurar');
  assert.equal(shouldAskBgSetup({ ...ok, android: false }), false, 'só Android');
  assert.equal(shouldAskBgSetup({ ...ok, locked: true }), false, 'com o bloqueio do app na frente');
});
