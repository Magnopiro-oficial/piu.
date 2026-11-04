/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BADGE_MAX, badgeAfterOpen, nextBadgeCount } from '../badgeCount';

test('número no ícone: cada notificação comum do sistema soma 1', () => {
  assert.equal(nextBadgeCount(0, { critical: false }), 1);
  assert.equal(nextBadgeCount(3, {}), 4);
});

test('número no ícone: alertas críticos da comunidade não contam', () => {
  assert.equal(nextBadgeCount(2, { critical: true }), 2);
  assert.equal(nextBadgeCount(0, { critical: true }), 0);
});

test('número no ícone: entrada inválida ou negativa conta como zero; não passa do teto', () => {
  assert.equal(nextBadgeCount(-5, {}), 1);
  assert.equal(nextBadgeCount(Number.NaN, {}), 1);
  assert.equal(nextBadgeCount(BADGE_MAX, {}), BADGE_MAX);
  assert.equal(nextBadgeCount(BADGE_MAX + 10, {}), BADGE_MAX);
});

test('número no ícone: ao voltar ao primeiro plano, zera', () => {
  assert.equal(badgeAfterOpen(), 0);
});
