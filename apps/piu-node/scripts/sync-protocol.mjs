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
 * `phoneNode`: o operador do piu-node avaliza celulares (docs/economia/no-celular.md) com o mesmo
 * formato de aval que o app e o validador usam. `carry`: o piu-node é o gateway principal da carga pela
 * malha (docs/carteira/transacoes-pela-malha.md).
 */
export const FILES = ['bytes', 'suite', 'keys', 'envelope', 'receipts', 'router', 'fragment', 'lnnp', 'phrase', 'phoneNode', 'carry'];

/**
 * Cliente Meshtastic do app (apps/mobile/src/transport/meshtastic): o Super Node fala com o rádio pela
 * serial com o mesmo protobuf, os mesmos pedaços "P1", o mesmo balde de tempo de rádio e o anúncio "PN"
 * (docs/transporte/super-node-lora.md). Vão para src/meshtastic/.
 */
export const MESH_SRC = join(here, '../../mobile/src/transport/meshtastic');
export const MESH_DST = join(here, '../src/meshtastic');
export const MESH_FILES = ['proto', 'fragments', 'budget', 'nodeBeacon'];

/**
 * Rádio próprio do Piu (apps/mobile/src/transport/rnode, caminho B): regiões do mundo, plano do rádio e
 * KISS do RNode, os mesmos no app e no Super Node. Vão para src/rnode/.
 */
export const RNODE_SRC = join(here, '../../mobile/src/transport/rnode');
export const RNODE_DST = join(here, '../src/rnode');
export const RNODE_FILES = ['regions', 'rnode'];

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

/** Ajustes só de tipo nos arquivos do Meshtastic (mesma regra de TYPE_PATCHES). */
const MESH_PATCHES = {};

/** `group`: `false` protocolo, `true` Meshtastic, `'rnode'` rádio próprio. */
export function generate(name, group = false) {
  const rnode = group === 'rnode', mesh = group === true;
  let src = readFileSync(join(rnode ? RNODE_SRC : mesh ? MESH_SRC : SRC, `${name}.ts`), 'utf8');
  for (const [from, to] of (rnode || mesh ? MESH_PATCHES[name] : TYPE_PATCHES[name]) ?? []) {
    if (src.includes(from)) src = src.replace(from, to);
    else if (!src.includes(to)) throw new Error(`Ajuste de tipo não se aplica mais em ${name}.ts: revise TYPE_PATCHES.`);
  }
  const body = src.replace(/(from\s+'\.\/[A-Za-z0-9-]+)'/g, "$1.js'").replace(/from\s+'\.\.\/\.\.\/protocol\/([a-z0-9-]+)'/g, "from '../protocol/$1.js'");
  const origin = rnode ? `apps/mobile/src/transport/rnode/${name}.ts` : mesh ? `apps/mobile/src/transport/meshtastic/${name}.ts` : `apps/mobile/src/protocol/${name}.ts`;
  return `// GERADO por scripts/sync-protocol.mjs a partir de ${origin}. Não edite aqui.\n${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  if (!existsSync(SRC)) {
    console.error(`Fonte não encontrada: ${SRC}`);
    process.exit(check ? 0 : 1);
  }
  let stale = 0;
  for (const [dir, files, group] of [[DST, FILES, false], [MESH_DST, MESH_FILES, true], [RNODE_DST, RNODE_FILES, 'rnode']]) {
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const out = generate(f, group);
      const path = join(dir, `${f}.ts`);
      const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
      if (cur === out) continue;
      stale++;
      if (check) console.error(`Desatualizado: ${path}`);
      else writeFileSync(path, out);
    }
  }
  if (check && stale) process.exit(1);
  console.log(check ? 'Protocolo em dia.' : `Protocolo sincronizado (${stale} arquivo(s) atualizado(s)).`);
}
