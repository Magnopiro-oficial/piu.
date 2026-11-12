/// <reference types="node" />
/**
 * Auditoria 2026-11-09 (baixos): telas que recebem a frase ou mostram o QR de resposta com a frase
 * cifrada bloqueiam print e gravação, como backup e vault-recover.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('Restaurar · bloqueia captura e limpa as palavras depois de restaurar', () => {
  const src = read('app/restore.tsx');
  assert.match(src, /usePreventCapture\('restore'\)/);
  assert.match(src, /setWords\(Array\(PHRASE_WORDS\)\.fill\(''\)\)/);
});

test('Migração · bloqueia captura na transferência de outro aparelho', () => {
  assert.match(read('app/migrate.tsx'), /usePreventCapture\('migrate'\)/);
});

test('Aparelhos · QR de resposta (frase cifrada) com captura bloqueada', () => {
  assert.match(read('app/devices.tsx'), /pair\?\.step === 'reply' && <NoCapture k="devices-pair" \/>/);
});
