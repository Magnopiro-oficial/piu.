import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error: script .mjs sem declaração de tipos
import { DST, FILES, generate, SRC } from '../scripts/sync-protocol.mjs';

test('src/protocol é cópia fiel de apps/mobile/src/protocol (rode `npm run protocol:sync` se falhar)', t => {
  if (!existsSync(SRC)) { t.skip('apps/mobile não está presente (build isolado do piu-node)'); return; }
  for (const f of FILES as string[]) {
    assert.equal(readFileSync(join(DST as string, `${f}.ts`), 'utf8'), (generate as (n: string) => string)(f), `src/protocol/${f}.ts desatualizado`);
  }
});
