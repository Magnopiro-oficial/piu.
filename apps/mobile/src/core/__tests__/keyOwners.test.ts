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

// Constantes exportadas por qualquer arquivo (chave importada de outro módulo).
const exported = new Map(files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+) = '([^']+)'/g)].map(m => [m[1]!, m[2]!] as const)));
/**
 * Argumentos que não são uma chave fixa: o próprio wrapper genérico e funções que recebem a chave.
 * Um novo caso aqui precisa de motivo (o teste falha em vez de deixar passar uma chave desconhecida).
 */
const DYNAMIC = new Set([
  'lib/persist.ts key: string', // a própria API
  'core/messengerRuntime.ts k', // `schedule(k, v)`: as chaves do próprio runtime
  'lib/nodeLink.ts key(phoneId', // `nodeLink.<aparelho>`
]);

/** Primeiro argumento de cada chamada: texto literal, constante do arquivo ou exportada; o resto falha (fora de DYNAMIC). */
function keysOf(file: string, src: string, call: RegExp): string[] {
  // `const A = 'x'` e também `const A = 'x', B = 'y'`.
  const consts = new Map([...src.matchAll(/(?:const|,)\s*([A-Z_]+) = '([^']+)'/g)].map(m => [m[1]!, m[2]!]));
  return [...src.matchAll(call)].map(m => {
    const a = m[1]!.trim();
    if (a.startsWith("'")) return a.slice(1, -1);
    // Chave montada (`prefixo.${x}`): vale o prefixo fixo.
    if (a.startsWith('`')) return a.slice(1).split('${')[0]!;
    const k = consts.get(a) ?? exported.get(a);
    if (k !== undefined) return k;
    assert.ok(DYNAMIC.has(`${relative(root, file)} ${a}`), `${relative(root, file)}: chave '${a}' não resolvida (use texto, uma const UPPER_CASE ou registre em DYNAMIC)`);
    return a;
  });
}

const owned = new Map<string, string>([...CHAT_STORE_KEYS.map(k => [k, join('core', 'chatStore.ts')] as const), ...RUNTIME_KEYS.map(k => [k, join('core', 'messengerRuntime.ts')] as const)]);

test('nenhuma chave do núcleo é estado `usePersisted` da tela', () => {
  for (const f of files) {
    for (const k of keysOf(f, readFileSync(f, 'utf8'), /usePersisted(?:<.*?>)?\(\s*([^,)]+)/g)) {
      assert.ok(!owned.has(k), `${relative(root, f)} usa usePersisted('${k}'), que é do núcleo (${owned.get(k)})`);
    }
  }
});

test('só o dono grava as chaves do núcleo (persistNow / schedule)', () => {
  for (const f of files) {
    const rel = relative(root, f);
    for (const k of keysOf(f, readFileSync(f, 'utf8'), /(?:persistNow|schedulePersisted|forgetPersisted)\(\s*([^,)]+)/g)) {
      if (owned.has(k)) assert.equal(rel, owned.get(k), `${rel} grava '${k}', que é de ${owned.get(k)}`);
    }
  }
});

test('as conversas, as verificações, as sessões e os pedidos de pagamento estão entre as chaves do núcleo', () => {
  for (const k of ['chats', 'verified', 'msg.state', 'pay.requests', 'routes']) assert.ok(owned.has(k), k);
});

test('chave montada ou importada também é conferida (prefixo fixo e const exportada)', () => {
  const src = "import { X } from 'y';\npersistNow(`chats${n}`, v); schedulePersisted(PHONE_NODE_KEY, v);";
  assert.deepEqual(keysOf(join(root, 'core', 'chatStore.ts'), src, /(?:persistNow|schedulePersisted|forgetPersisted)\(\s*([^,)]+)/g), ['chats', 'phone.node']);
  assert.throws(() => keysOf(join(root, 'ui', 'X.tsx'), 'persistNow(algumaVar, v)', /persistNow\(\s*([^,)]+)/g), /não resolvida/);
});
