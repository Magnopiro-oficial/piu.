// Copia o cliente de leitura da Lunes Mainnet do app (apps/mobile/src/lib) para src/lunes/, com
// imports `.js`. Mesmo motivo de sync-protocol.mjs: o piu-node compila e roda sozinho (Linux/OpenWrt,
// app desktop), sem o projeto Expo. A fonte da verdade é a do app; test/lunes.test.ts acusa cópia
// desatualizada.
// Uso: node scripts/sync-lunes.mjs          → atualiza a cópia
//      node scripts/sync-lunes.mjs --check  → só confere (código 1 se estiver diferente)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, '../../mobile/src/lib');
export const DST = join(here, '../src/lunes');
/** xxHash64/twox, SS58 e o cliente JSON-RPC. Nada de react-native nesses módulos. */
export const FILES = ['xxhash', 'ss58', 'lunesRpc'];

export function generate(name) {
  const src = readFileSync(join(SRC, `${name}.ts`), 'utf8');
  const body = src.replace(/(from\s+'\.\/[A-Za-z0-9-]+)'/g, "$1.js'");
  return `// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/lib/${name}.ts. Não edite aqui.\n${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  if (!existsSync(SRC)) {
    console.error(`Fonte não encontrada: ${SRC}`);
    process.exit(check ? 0 : 1);
  }
  let stale = 0;
  mkdirSync(DST, { recursive: true });
  for (const f of FILES) {
    const out = generate(f);
    const path = join(DST, `${f}.ts`);
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (cur === out) continue;
    stale++;
    if (check) console.error(`Desatualizado: src/lunes/${f}.ts`);
    else writeFileSync(path, out);
  }
  if (check && stale) process.exit(1);
  console.log(check ? 'Cliente da Lunes em dia.' : `Cliente da Lunes sincronizado (${stale} arquivo(s) atualizado(s)).`);
}
