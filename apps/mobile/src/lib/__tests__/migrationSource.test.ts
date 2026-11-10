/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeSourceAllowed } from '../migration';

test('oferta (aparelho que envia a frase) só entra pela câmera, nunca por texto colado', () => {
  assert.equal(codeSourceAllowed('offer', 'camera'), true);
  assert.equal(codeSourceAllowed('offer', 'text'), false);
});

test('resposta (aparelho que recebe) segue aceitando câmera e texto colado', () => {
  assert.equal(codeSourceAllowed('reply', 'camera'), true);
  assert.equal(codeSourceAllowed('reply', 'text'), true);
});
