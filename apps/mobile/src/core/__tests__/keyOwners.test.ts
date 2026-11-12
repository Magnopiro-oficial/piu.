/**
 * Um dono por chave salva (plano "app fechado", fatia 4). Se o núcleo e um `usePersisted` da tela
 * gravassem a mesma chave, o último a gravar apagaria o outro. As chaves do núcleo (conversas e
 * mensageiro) só podem ser gravadas pelos arquivos dele; a tela só lê.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { CHAT_STORE_KEYS } from '../chatStore';
import { RUNTIME_KEYS } from '../messengerRuntime';

const root = join(__dirname, '..', '..');
const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p); } else if (/\.tsx?$/.test(n)) files.push(p); } };
walk(root);

/** Primeiro argumento de cada chamada: texto literal ou constante `const X = '...'` do mesmo arquivo. */
function keysOf(src: string, call: RegExp): string[] {
  const consts = new Map([...src.matchAll(/const ([A-Z_]+) = '([^']+)'/g)].map(m => [m[1]!, m[2]!]));
  return [...src.matchAll(call)].map(m => { const a = m[1]!.trim(); return a.startsWith("'") ? a.slice(1, -1) : consts.get(a) ?? a; });
}

const owned = new Map<string, string>([...CHAT_STORE_KEYS.map(k => [k, join('core', 'chatStore.ts')] as const), ...RUNTIME_KEYS.map(k => [k, join('core', 'messengerRuntime.ts')] as const)]);

test('nenhuma chave do núcleo é estado `usePersisted` da tela', () => {
  for (const f of files) {
    for (const k of keysOf(readFileSync(f, 'utf8'), /usePersisted(?:<.*?>)?\(\s*([^,)]+)/g)) {
      assert.ok(!owned.has(k), `${relative(root, f)} usa usePersisted('${k}'), que é do núcleo (${owned.get(k)})`);
    }
  }
});

test('só o dono grava as chaves do núcleo (persistNow / schedule)', () => {
  for (const f of files) {
    const rel = relative(root, f);
    for (const k of keysOf(readFileSync(f, 'utf8'), /(?:persistNow|schedulePersisted|forgetPersisted)\(\s*([^,)]+)/g)) {
      if (owned.has(k)) assert.equal(rel, owned.get(k), `${rel} grava '${k}', que é de ${owned.get(k)}`);
    }
  }
});

test('as conversas, as verificações, as sessões e os pedidos de pagamento estão entre as chaves do núcleo', () => {
  for (const k of ['chats', 'verified', 'msg.state', 'pay.requests', 'routes']) assert.ok(owned.has(k), k);
});
