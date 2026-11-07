import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRestore, lockGate, onboardingRedirect, PhraseExistsError, replacesPhrase } from '../identityGuard';

const A = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');
const B = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'.split(' ');

// A-01 (auditoria 2026-11-06): piu://restore e piu://migrate não podem abrir com identidade existente.
test('guarda: com identidade, restaurar e migrar voltam para as abas (inclusive por link piu://)', () => {
  assert.equal(onboardingRedirect(true, 'restore'), '/(tabs)');
  assert.equal(onboardingRedirect(true, 'migrate'), '/(tabs)');
});

test('guarda: com identidade, o resto abre normal ("Ver boas-vindas", chaves atuais, abas, convite)', () => {
  for (const s of ['welcome', 'identity', 'keys', '(tabs)', 'invite', 'backup', 'devices', 'chat']) assert.equal(onboardingRedirect(true, s), null, s);
  assert.equal(onboardingRedirect(true, undefined), null);
});

test('guarda: antes do onboarding, só as telas de entrada abrem; o resto vai para as boas-vindas', () => {
  for (const s of ['welcome', 'identity', 'keys', 'restore', 'migrate']) assert.equal(onboardingRedirect(false, s), null, s);
  for (const s of ['(tabs)', 'invite', 'backup', 'devices', 'wallet']) assert.equal(onboardingRedirect(false, s), '/welcome', s);
  assert.equal(onboardingRedirect(false, undefined), null);
});

test('restaurar: sem frase no aparelho, ou com a mesma frase, segue', () => {
  assert.doesNotThrow(() => checkRestore(null, A));
  assert.doesNotThrow(() => checkRestore(A, [...A]));
  assert.equal(replacesPhrase(null, A), false);
  assert.equal(replacesPhrase(A, [...A]), false);
});

test('restaurar: nunca troca uma frase existente por outra sem o pedido explícito da tela de confirmação', () => {
  assert.equal(replacesPhrase(A, B), true);
  assert.throws(() => checkRestore(A, B), (e: unknown) => e instanceof PhraseExistsError && e.code === 'EXISTS');
  assert.throws(() => checkRestore(A, B, { replace: false }), PhraseExistsError);
  assert.doesNotThrow(() => checkRestore(A, B, { replace: true }));
});

// M-01: revelar/transferir a frase segue a mesma regra da carteira (sem bloqueio do aparelho, recusa).
test('bloqueio do aparelho: só "ok" libera a frase; sem bloqueio pede para ativar um', () => {
  assert.equal(lockGate('ok', false), 'ok');
  assert.equal(lockGate('denied', false), 'denied');
  assert.equal(lockGate('unavailable', false), 'needLock');
});

test('bloqueio do aparelho: na web (demonstração, sem bloqueio possível) segue mostrando com o aviso', () => {
  assert.equal(lockGate('unavailable', true), 'ok');
  assert.equal(lockGate('denied', true), 'denied');
});
