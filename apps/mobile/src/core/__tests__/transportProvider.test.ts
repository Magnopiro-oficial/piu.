/**
 * TransportProvider fino (plano "app fechado", fatia 3): o desmonte da tela (deslizar o app dos
 * recentes) não desliga nada. Quem liga e para é o núcleo (core/node.ts); o provider só configura e lê.
 * O provider importa react-native e não monta em node: o teste lê o código.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const src = readFileSync(join(__dirname, '..', '..', 'state', 'transport.tsx'), 'utf8');

test('TransportProvider não liga nem para transporte e LAN por conta própria', () => {
  assert.doesNotMatch(src, /transport\.stop\(|lan\.stop\(|transport\.start\(|lan\.start\(|createStopGate/);
});

test('TransportProvider configura o núcleo, com posse única, e lê o estado dele', () => {
  assert.match(src, /useMemo\(getCore, \[\]\)/);
  assert.match(src, /\.claimRuntime\(/);
  assert.match(src, /core\.configure\(/);
  assert.match(src, /useSyncExternalStore\(core\.subscribe, core\.status/);
  assert.doesNotMatch(src, /transport\.subscribe\(/, 'estado e vizinhos vêm do núcleo');
});
