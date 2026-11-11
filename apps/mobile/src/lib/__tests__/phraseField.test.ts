/// <reference types="node" />
/** Auditoria 2026-11-09 (baixo): campos da frase sem aprendizado do teclado nem autofill. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { phraseFieldProps } from '../phraseField';

test('Frase · Android: teclado de senha visível (sem aprendizado/sugestões) e fora do autofill', () => {
  const p = phraseFieldProps('android');
  assert.equal(p.keyboardType, 'visible-password');
  assert.equal(p.importantForAutofill, 'no');
  assert.equal(p.autoCorrect, false);
  assert.equal(p.autoComplete, 'off');
  assert.equal(p.spellCheck, false);
});

test('Frase · iPhone: sem tipo de conteúdo (não oferece senha nem preenchimento)', () => {
  const p = phraseFieldProps('ios');
  assert.equal(p.textContentType, 'none');
  assert.equal(p.keyboardType, undefined, 'no iPhone o teclado de senha não existe; fica o padrão');
});

test('Frase · PhraseInput usa as props protegidas', () => {
  const src = readFileSync(new URL('../../ui/PhraseInput.tsx', import.meta.url), 'utf8');
  assert.match(src, /phraseFieldProps\(Platform\.OS\)/);
});
