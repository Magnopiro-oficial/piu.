/**
 * `loadPersisted` lê o disco uma vez por processo (plano "app fechado", fatia 1). Deslizar o app dos
 * recentes destrói a Activity, mas o runtime JS segue vivo; ao reabrir, o `_layout` monta de novo e
 * chamava `loadPersisted` outra vez, que trocava o `snapshot` inteiro pelo que estava no disco e perdia
 * o que o núcleo já tinha gravado em memória (gravações ainda no atraso de `schedule`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createReadHealth, oncePerProcess } from '../persistSafety';

test('duas leituras com uma escrita no meio não perdem a escrita', async () => {
  const disk: Record<string, unknown> = { onboarded: true };
  let snapshot: Record<string, unknown> = {};
  let reads = 0;
  const load = oncePerProcess(async () => { reads++; snapshot = { ...disk }; });
  await load();
  snapshot.chats = ['nova']; // gravada em memória, ainda não foi ao disco
  await load();
  assert.deepEqual(snapshot, { onboarded: true, chats: ['nova'] });
  assert.equal(reads, 1);
});

test('chamadas ao mesmo tempo esperam a mesma leitura', async () => {
  let reads = 0;
  let done!: () => void;
  const load = oncePerProcess(() => { reads++; return new Promise<void>(r => { done = r; }); });
  const a = load(), b = load();
  assert.equal(a, b);
  done();
  await Promise.all([a, b]);
  assert.equal(reads, 1);
});

test('persist.ts usa a leitura única em loadPersisted', () => {
  const src = readFileSync(join(__dirname, '..', 'persist.ts'), 'utf8');
  assert.match(src, /export const loadPersisted\s*=\s*oncePerProcess\(/);
});

test('leitura que falhou é tentada de novo na próxima chamada; a que deu certo, não', async () => {
  let reads = 0, ok = false;
  const load = oncePerProcess(async () => { reads++; return ok; });
  await load();
  ok = true;
  await load();
  await load();
  assert.equal(reads, 2);
});

test('"Apagar dados locais" não deixa a carteira travada pelo resto do processo', () => {
  const h = createReadHealth();
  h.begin(); h.unreadable('chats'); h.succeeded();
  assert.equal(h.failed('wallet.transfer'), false);
  assert.equal(h.failed('chats'), true);
  // Durante o apagamento, fecha (nada lido prova ausência); ao terminar, o vazio é de propósito.
  h.begin();
  assert.equal(h.failed('wallet.transfer'), true);
  h.wiped();
  assert.equal(h.failed('wallet.transfer'), false);
  assert.equal(h.failed('chats'), false);
});

test('clearPersisted marca o armazenamento como vazio de propósito ao terminar', () => {
  const src = readFileSync(join(__dirname, '..', 'persist.ts'), 'utf8');
  const clear = src.slice(src.indexOf('export async function clearPersisted'), src.indexOf('export async function forgetPersisted'));
  assert.match(clear, /await guard\.run\([\s\S]*\}\);\s*(\/\/.*\n\s*)?health\.wiped\(\);/);
  assert.match(src, /export const persistedReadFailed = \(key: string\) => health\.failed\(key\)/);
});
