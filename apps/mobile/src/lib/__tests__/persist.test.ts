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
import { oncePerProcess } from '../persistSafety';

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
