/**
 * TransportProvider fino (plano "app fechado", fatia 3): o desmonte da tela (deslizar o app dos
 * recentes) não desliga nada. Quem liga e para é o núcleo (core/node.ts); o provider só configura e lê.
 * O provider importa react-native e não monta em node: o teste lê o código. As decisões que podem
 * parar algo no núcleo (LAN no remonte, segredo do nome) estão em funções puras de core/node.ts,
 * testadas com núcleo falso em node.test.ts; aqui só se confere que o provider passa por elas.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const src = readFileSync(join(__dirname, '..', '..', 'state', 'transport.tsx'), 'utf8');

test('TransportProvider não liga nem para transporte e LAN por conta própria', () => {
  assert.doesNotMatch(src, /transport\.stop\(|lan\.stop\(|transport\.start\(|lan\.start\(|createStopGate/);
});

test('TransportProvider configura o núcleo, com posse única, e lê o estado dele', () => {
  assert.match(src, /getCore/);
  assert.match(src, /\.claimRuntime\(/);
  assert.match(src, /core\.configure\(/);
  assert.match(src, /useSyncExternalStore\(core\.subscribe, core\.status/);
  assert.doesNotMatch(src, /transport\.subscribe\(/, 'estado e vizinhos vêm do núcleo');
});

test('TransportProvider não manda a LAN ao núcleo antes de ler o Wi-Fi (screenLan)', () => {
  assert.match(src, /screenLan\(/);
  assert.match(src, /if \(lanCfg !== undefined\) core\.configure\(\{ lan: lanCfg \}\)/);
});

test('transport.nameSecret tem um dono só: core/index.ts (a tela não guarda o seu)', () => {
  const root = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p); } else if (/\.tsx?$/.test(n)) files.push(p); } };
  walk(root);
  const users = files.filter(f => readFileSync(f, 'utf8').includes("'transport.nameSecret'")).map(f => relative(root, f)).sort();
  // node.ts só lê (persistedConfig); index.ts lê e grava.
  assert.deepEqual(users, [join('core', 'index.ts'), join('core', 'node.ts')]);
  assert.match(src, /nodeNameSecret\(\)/);
});
