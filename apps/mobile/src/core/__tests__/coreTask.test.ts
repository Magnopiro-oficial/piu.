/**
 * Entrada e tarefa sem tela (plano "app fechado", fatia 8). O PiuRelayService sobe a tarefa Headless
 * `PiuCore`, que liga o núcleo sem árvore React e fica viva até o núcleo parar (uma tarefa ativa
 * destrava os timers JS com o app em segundo plano). A tela usa o mesmo núcleo: nada liga duas vezes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Transport } from '../../transport/types';
import { bootThen, CORE_TASK, coreTask } from '../coreTask';
import { createCore } from '../node';
import { createChatStore } from '../chatStore';
import { createMessengerRuntime, persistedPrefs } from '../messengerRuntime';
import { deriveIdentity, deriveNodeKey, newSeed } from '../../protocol/keys';
import { createSimulatedTransport } from '../../transport/simulated';

const SECRET = 'ab'.repeat(32);
const tick = () => new Promise(r => setTimeout(r, 0));
const root = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', ...p), 'utf8');

const live: Array<{ shutdown(): Promise<void> }> = [];
after(() => Promise.all(live.map(c => c.shutdown())));

function core() {
  const calls: string[] = [];
  const transport = {
    kind: 'native', media: [],
    start: async (name: string) => { calls.push(`start ${name}`); },
    stop: async () => { calls.push('stop'); },
    send: async () => {}, subscribe: () => () => {},
  } as unknown as Transport;
  const c = createCore({ transport, serviceId: 'svc', log: () => {}, load: async () => ({ config: { nameSecret: SECRET, p2p: true, lan: null } }) });
  live.push(c);
  return { c, calls };
}

test('a tarefa, chamada sem tela, sobe o núcleo uma vez só e fica viva até o núcleo parar', async () => {
  const { c, calls } = core();
  const task = coreTask({ boot: c.boot, untilStopped: c.untilStopped });
  let done = 0;
  void task({}).then(() => done++);
  void task({}).then(() => done++);
  await c.boot(); // a tela (_layout.tsx, bootCore) chega junto
  await tick();
  assert.deepEqual(calls.filter(x => x.startsWith('start')).length, 1);
  assert.equal(done, 0, 'a tarefa segura os timers enquanto o núcleo está ligado');
  await c.shutdown();
  await tick();
  assert.equal(done, 2);
  assert.ok(calls.includes('stop'));
});

test('bootCore pela tarefa e pela tela ao mesmo tempo: núcleo uma vez, mensageiro e alertas depois dele, e uma instância de cada', async () => {
  const { c, calls } = core();
  const rt = createMessengerRuntime({
    transport: createSimulatedTransport(), chats: createChatStore({ read: () => undefined, schedule: () => {}, notify: () => {}, chirp: () => {}, active: () => false, locked: () => false }),
    read: () => undefined, persistNow: async () => {}, schedule: () => {}, forget: async () => {}, epoch: () => 0, prefs: persistedPrefs(() => undefined),
  });
  live.push(rt);
  const seed = newSeed();
  const keys = { identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, node: deriveNodeKey(seed), nodeKeyFor: null, phonePk: null, rotation: 0 };
  const seen: unknown[] = [];
  let alerts: object | null = null, made = 0;
  const bootCore = bootThen(c.boot,
    () => { calls.push('messenger'); rt.start(keys); seen.push(rt.messenger()); },
    () => { alerts ??= (made++, {}); });
  await Promise.all([coreTask({ boot: bootCore, untilStopped: async () => {} })({}), bootCore()]);
  assert.equal(calls.filter(x => x.startsWith('start')).length, 1);
  assert.ok(calls.indexOf('messenger') > calls.findIndex(x => x.startsWith('start')), 'o mensageiro sobe depois do núcleo');
  assert.equal(seen.length, 2);
  assert.ok(seen[0] && seen[0] === seen[1], 'o mesmo mensageiro');
  assert.equal(made, 1);
});

test('untilStopped depois de parar espera a próxima parada (o núcleo pode religar)', async () => {
  const { c } = core();
  await c.boot();
  await c.shutdown();
  let done = false;
  void c.untilStopped().then(() => { done = true; });
  await tick();
  assert.equal(done, false);
  await c.shutdown();
  await tick();
  assert.equal(done, true);
});

test('entrada do app: registra a tarefa PiuCore antes do expo-router, e o package.json aponta para ela', () => {
  assert.equal(CORE_TASK, 'PiuCore');
  assert.equal(JSON.parse(root('package.json')).main, 'index.ts');
  const entry = root('index.ts');
  const reg = entry.indexOf("'./src/core/headless'"), router = entry.indexOf("'expo-router/entry'");
  assert.ok(entry.indexOf("'./src/lib/cryptoPolyfill'") >= 0 && entry.indexOf("'./src/lib/cryptoPolyfill'") < reg, 'cripto antes do núcleo');
  assert.ok(reg >= 0 && router > reg, 'tarefa registrada antes de a tela existir');
  const headless = root('src', 'core', 'headless.ts');
  assert.match(headless, /registerHeadlessTask\(CORE_TASK, \(\) => coreTask\(\{ boot: bootCore, untilStopped \}\)\)/);
});

test('a tela sobe o mesmo núcleo (bootCore) e "Apagar dados locais" para o núcleo antes de limpar', () => {
  const layout = root('src', 'app', '_layout.tsx');
  assert.match(layout, /bootCore\(\)/);
  assert.doesNotMatch(layout, /loadPersisted|preloadKeys/);
  const reset = root('src', 'state', 'reset.tsx');
  const stop = reset.indexOf('getCore().shutdown()'), clear = reset.indexOf('clearPersisted()');
  assert.ok(stop >= 0 && stop < clear, 'shutdown antes de clearPersisted');
});
