// Copia o protocolo do app (apps/mobile/src/protocol) para src/protocol/, com imports `.js`.
// Por quê: o piu-node é ESM com `moduleResolution: nodenext` e precisa compilar e rodar sozinho
// (Linux/OpenWrt, app desktop), sem o projeto Expo nem o node_modules dele. A fonte da verdade
// continua sendo apps/mobile/src/protocol; o teste test/protocol-sync.test.ts acusa cópia desatualizada.
// Uso: node scripts/sync-protocol.mjs          → atualiza a cópia
//      node scripts/sync-protocol.mjs --check  → só confere (código 1 se estiver diferente)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, '../../mobile/src/protocol');
export const DST = join(here, '../src/protocol');
/**
 * Só o que o nó usa: rotear, recibos, fragmentos e o LNNP. Nada de sessões nem catraca. `phrase` entra
 * só porque src/lunes/walletKey.ts (cópia) importa `isValidPhrase`; o nó nunca gera nem guarda frase.
 */
export const FILES = ['bytes', 'suite', 'keys', 'envelope', 'receipts', 'router', 'fragment', 'lnnp', 'phrase'];

/**
 * Ajustes só de tipo (o comportamento é idêntico) para compilar com `noUncheckedIndexedAccess`,
 * que o piu-node usa e o app não. Quando o app adotar a mesma forma, o ajuste vira no-op.
 */
const TYPE_PATCHES = {
  bytes: [
    ['  u8() { this.need(1); return this.b[this.o++]; }', '  u8(): number { this.need(1); return this.b[this.o++]!; }'],
    ['d |= a[i] ^ b[i];', 'd |= a[i]! ^ b[i]!;'],
  ],
  router: [['(r[0] << 24 | r[1] << 16 | r[2] << 8 | r[3])', '(r[0]! << 24 | r[1]! << 16 | r[2]! << 8 | r[3]!)']],
};

export function generate(name) {
  let src = readFileSync(join(SRC, `${name}.ts`), 'utf8');
  for (const [from, to] of TYPE_PATCHES[name] ?? []) {
    if (src.includes(from)) src = src.replace(from, to);
    else if (!src.includes(to)) throw new Error(`Ajuste de tipo não se aplica mais em ${name}.ts: revise TYPE_PATCHES.`);
  }
  const body = src.replace(/(from\s+'\.\/[a-z0-9-]+)'/g, "$1.js'");
  return `// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/${name}.ts. Não edite aqui.\n${body}`;
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
    if (check) console.error(`Desatualizado: src/protocol/${f}.ts`);
    else writeFileSync(path, out);
  }
  if (check && stale) process.exit(1);
  console.log(check ? 'Protocolo em dia.' : `Protocolo sincronizado (${stale} arquivo(s) atualizado(s)).`);
}
