import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error: script .mjs sem declaração de tipos
import { DST, FILES, generate, MESH_DST, MESH_FILES, RNODE_DST, RNODE_FILES, SRC } from '../scripts/sync-protocol.mjs';

test('src/protocol é cópia fiel de apps/mobile/src/protocol (rode `npm run protocol:sync` se falhar)', t => {
  if (!existsSync(SRC)) { t.skip('apps/mobile não está presente (build isolado do piu-node)'); return; }
  for (const f of FILES as string[]) {
    assert.equal(readFileSync(join(DST as string, `${f}.ts`), 'utf8'), (generate as (n: string) => string)(f), `src/protocol/${f}.ts desatualizado`);
  }
  for (const f of MESH_FILES as string[]) {
    assert.equal(readFileSync(join(MESH_DST as string, `${f}.ts`), 'utf8'), (generate as (n: string, m: boolean) => string)(f, true), `src/meshtastic/${f}.ts desatualizado`);
  }
  for (const f of RNODE_FILES as string[]) {
    assert.equal(readFileSync(join(RNODE_DST as string, `${f}.ts`), 'utf8'), (generate as (n: string, g: string) => string)(f, 'rnode'), `src/rnode/${f}.ts desatualizado`);
  }
});
