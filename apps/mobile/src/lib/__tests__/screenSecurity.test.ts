/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t } from '../../i18n/core';
import { hasScreenSecurity, SCREEN_SECURITY_KEY, shouldPreventCapture } from '../screenSecurity';

test('Segurança da tela · só o Android tem o ajuste (interruptor aparece só lá)', () => {
  assert.equal(hasScreenSecurity('android'), true);
  assert.equal(hasScreenSecurity('ios'), false, 'o iPhone não permite bloquear print: o ajuste não existe');
  assert.equal(hasScreenSecurity('web'), false);
  assert.equal(hasScreenSecurity('macos'), false);
});

test('Segurança da tela · Android: FLAG_SECURE na conversa só com o ajuste ligado', () => {
  assert.equal(shouldPreventCapture('android', true), true);
  assert.equal(shouldPreventCapture('android', false), false);
});

test('Segurança da tela · iPhone, web e outros: nunca aplica, mesmo com o ajuste ligado', () => {
  assert.equal(shouldPreventCapture('ios', true), false);
  assert.equal(shouldPreventCapture('web', true), false);
  assert.equal(shouldPreventCapture('macos', true), false);
});

test('Segurança da tela · chave própria, separada da da tela de backup (cada uma é liberada por si)', () => {
  assert.equal(SCREEN_SECURITY_KEY, 'screenSecurity');
  assert.notEqual(SCREEN_SECURITY_KEY, 'backup');
});

test('Segurança da tela · textos do interruptor existem no pt-BR', () => {
  assert.equal(t('privacy.screen'), 'Segurança da tela');
  assert.equal(t('privacy.screen.desc'), 'Impede prints e gravação de tela dentro das conversas.');
});
