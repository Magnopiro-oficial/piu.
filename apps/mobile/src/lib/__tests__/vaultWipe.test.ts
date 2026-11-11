/**
 * "Apagar dados locais" (auditoria 2026-11-09): nenhum item do cofre do sistema pode ficar para trás.
 * O teste lê o código do app: uma chave nova do cofre que não entre na limpeza faz o teste falhar.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { VAULT_WIPE_KEYS, wipeVault, type VaultDeps } from '../phraseVault';

/** Apagada por clearPersisted (lib/persist.ts), junto com o armazenamento cifrado. */
const CLEARED_BY_PERSIST = new Set(['piu.datakey.v1']);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__') out.push(...sources(p)); }
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

test('toda chave do cofre usada no app entra na limpeza', () => {
  const found = new Set<string>();
  for (const f of sources(join(__dirname, '..', '..'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/'(piu\.[a-z.]+\.v\d+)'/g)) found.add(m[1]);
  }
  assert.ok(found.has('piu.approvals.v1') && found.has('piu.point.secret.v1'), 'a busca encontra as chaves');
  for (const k of found) assert.ok(VAULT_WIPE_KEYS.includes(k) || CLEARED_BY_PERSIST.has(k), `${k} fica no aparelho depois de apagar`);
});

test('wipeVault apaga também os nós pareados do provider e o segredo do ponto', async () => {
  const items = new Set(['piu.keys.v2', 'piu.phrase.v1', 'piu.phrase.bio.v1', 'piu.approvals.v1', 'piu.point.secret.v1']);
  const deps = { store: { get: async () => null, set: async () => {}, del: async (k: string) => { items.delete(k); } } } as unknown as VaultDeps;
  await wipeVault(deps);
  assert.deepEqual([...items], []);
});
