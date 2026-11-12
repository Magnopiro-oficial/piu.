/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showsContent } from '../notifyPreview';

const android = (locked: boolean | null, scheduled = false) => ({ os: 'android', locked, scheduled, iosPreviewsWhenUnlocked: false });

test('prévia "Sempre" mostra remetente e texto; "Nunca" esconde, em qualquer estado', () => {
  for (const locked of [true, false, null]) {
    assert.equal(showsContent('always', android(locked)), true);
    assert.equal(showsContent('never', android(locked)), false);
  }
});

test('prévia "Desbloqueado" no Android: aparelho bloqueado recebe o texto genérico', () => {
  assert.equal(showsContent('unlocked', android(true)), false);
  assert.equal(showsContent('unlocked', android(false)), true);
});

test('prévia "Desbloqueado" no Android: sem conseguir ler o bloqueio, vale como bloqueado', () => {
  assert.equal(showsContent('unlocked', android(null)), false);
});

test('prévia "Desbloqueado" no Android: aviso agendado sai genérico (o bloqueio na hora da entrega é desconhecido)', () => {
  assert.equal(showsContent('unlocked', android(false, true)), false);
});

test('prévia "Desbloqueado" no iPhone segue as prévias do sistema; na web, genérico', () => {
  assert.equal(showsContent('unlocked', { os: 'ios', locked: null, scheduled: false, iosPreviewsWhenUnlocked: true }), true);
  assert.equal(showsContent('unlocked', { os: 'ios', locked: null, scheduled: true, iosPreviewsWhenUnlocked: true }), true);
  assert.equal(showsContent('unlocked', { os: 'ios', locked: null, scheduled: false, iosPreviewsWhenUnlocked: false }), false);
  assert.equal(showsContent('unlocked', { os: 'web', locked: null, scheduled: false, iosPreviewsWhenUnlocked: false }), false);
});
