// Copia do protocolo do app (apps/mobile/src/protocol) só o que o validador usa: recibos, provas de
// entrega, vínculo nó → carteira e o livro de contribuições. Usa o mesmo gerador do piu-node (imports
// `.js` e ajustes de tipo), para as duas cópias saírem iguais. test/protocol-sync.test.ts confere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, SRC } from '../../piu-node/scripts/sync-protocol.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DST = join(here, '../src/protocol');
export const FILES = ['bytes', 'suite', 'keys', 'receipts'];
export { generate, SRC };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  mkdirSync(DST, { recursive: true });
  let stale = 0;
  for (const f of FILES) {
    const out = generate(f), path = join(DST, `${f}.ts`);
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') === out) continue;
    stale++;
    if (!check) writeFileSync(path, out);
  }
  console.log(check ? (stale ? `${stale} arquivo(s) desatualizado(s).` : 'Protocolo em dia.') : `Protocolo sincronizado (${stale} arquivo(s) atualizado(s)).`);
  if (check && stale) process.exit(1);
}
