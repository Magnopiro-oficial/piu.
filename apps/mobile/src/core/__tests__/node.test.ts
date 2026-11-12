/**
 * Núcleo de transporte fora da árvore React (plano "app fechado", fatia 2). Deslizar o app dos
 * recentes desmonta os providers; o núcleo continua ligado. Transporte e LAN falsos, sem react-native.
 */
import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { dailyNodeName } from '../../lib/nodeName';
import type { KeyPair } from '../../protocol/keys';
import type { LanController } from '../../transport/lan/controller';
import type { Transport, TransportEvent } from '../../transport/types';
import { createCore, persistedConfig, type CoreDeps } from '../node';

const SECRET = 'ab'.repeat(32);
const DAY = 20_000;
const key = (d: number): KeyPair => ({ sk: new Uint8Array(32), pk: new Uint8Array(32).fill(d % 256) });
const tick = () => new Promise(r => setTimeout(r, 0));

function fakes() {
  const calls: string[] = [];
  const subs = new Set<(e: TransportEvent) => void>();
  const lan = {
    available: true,
    start: async (o: { node: KeyPair; name: string; relay: boolean }) => { calls.push(`lan.start ${o.name} ${o.node.pk[0]} ${o.relay}`); },
    stop: async () => { calls.push('lan.stop'); },
    setNode: (n: KeyPair) => { calls.push(`lan.setNode ${n.pk[0]}`); },
  } as unknown as LanController;
  const transport = {
    kind: 'native', media: [],
    start: async (name: string, sid: string) => { calls.push(`start ${name} ${sid}`); },
    stop: async () => { calls.push('stop'); },
    send: async () => {},
    subscribe: (fn: (e: TransportEvent) => void) => { subs.add(fn); return () => subs.delete(fn); },
    setMediaEnabled: (m: unknown) => { calls.push(`media ${JSON.stringify(m)}`); },
    lan,
  } as unknown as Transport;
  const emit = (e: TransportEvent) => subs.forEach(fn => fn(e));
  return { calls, transport, emit, subs };
}

// Núcleos ligados seguram timers (dia UTC, chave do nó): desligados no fim para o processo sair.
const live: Array<{ shutdown(): Promise<void> }> = [];
after(() => Promise.all(live.map(c => c.shutdown())));

function core(f = fakes(), over: Partial<CoreDeps> = {}) {
  const logs: string[] = [];
  const c = createCore({ transport: f.transport, serviceId: 'svc', now: () => DAY * 86_400_000 + 1, log: m => logs.push(m), ...over });
  live.push(c);
  return { c, f, logs };
}

test('boot duas vezes liga o transporte uma vez só, com a configuração salva', async () => {
  let loads = 0;
  const { c, f } = core(undefined, {
    load: async () => { loads++; return { config: { nameSecret: SECRET, p2p: true, lan: null }, media: { ble: true } }; },
  });
  await Promise.all([c.boot(), c.boot()]);
  await c.boot();
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(f.calls, ['media {"ble":true}', `start ${dailyNodeName(SECRET, DAY)} svc`]);
});

test('a configuração salva não passa por cima do que a tela já configurou', async () => {
  let release!: () => void;
  const { c, f } = core(undefined, {
    load: () => new Promise(r => { release = () => r({ config: { nameSecret: SECRET, p2p: true, lan: null } }); }),
  });
  const booting = c.boot();
  c.configure({ nameSecret: SECRET, p2p: false });
  release();
  await booting; await tick();
  assert.deepEqual(f.calls, []);
});

test('configure só religa quando um ajuste muda de verdade', async () => {
  const { c, f } = core();
  c.configure({ nameSecret: SECRET, p2p: true, lan: { nodeKeyFor: key, wifiIp: '10.0.0.2', relay: true } });
  await tick();
  const name = dailyNodeName(SECRET, DAY);
  assert.deepEqual(f.calls.sort(), [`lan.start ${name} ${DAY % 256} true`, `start ${name} svc`].sort());
  f.calls.length = 0;
  // Mesmos valores (outra função de chave com a mesma chave do dia, `relay` só vale na partida): nada.
  c.configure({ nameSecret: SECRET, p2p: true, lan: { nodeKeyFor: d => key(d), wifiIp: '10.0.0.2', relay: false } });
  await tick();
  assert.deepEqual(f.calls, []);
  // Outro Wi-Fi: só a LAN religa.
  c.configure({ lan: { nodeKeyFor: key, wifiIp: '10.0.0.9', relay: true } });
  await tick();
  assert.deepEqual(f.calls, ['lan.stop', `lan.start ${name} ${DAY % 256} true`]);
  f.calls.length = 0;
  // A pessoa desliga Bluetooth e Wi-Fi Direct: só o P2P para.
  c.configure({ p2p: false });
  await tick();
  assert.deepEqual(f.calls, ['stop']);
  f.calls.length = 0;
  // Permissão concedida de novo: religa mesmo com o mesmo nome.
  c.configure({ p2p: true });
  await tick();
  c.configure({ p2p: true }, { restartP2p: true });
  await tick();
  assert.deepEqual(f.calls, [`start ${name} svc`, 'stop', `start ${name} svc`]);
});

test('virada do dia UTC troca o nome e religa; a chave do nó é conferida de hora em hora', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let now = DAY * 86_400_000 + 1;
    const { c, f } = core(undefined, { now: () => now });
    c.configure({ nameSecret: SECRET, p2p: true, lan: { nodeKeyFor: key, wifiIp: '10.0.0.2', relay: true } });
    await tick();
    f.calls.length = 0;
    now += 3_600_000;
    mock.timers.tick(3_600_000);
    await tick();
    assert.ok(f.calls.includes(`lan.setNode ${DAY % 256}`));
    f.calls.length = 0;
    now = (DAY + 1) * 86_400_000 + 5;
    mock.timers.tick(60_000);
    await tick(); await tick();
    const name = dailyNodeName(SECRET, DAY + 1);
    assert.equal(c.status().nodeName, name);
    assert.ok(f.calls.includes(`start ${name} svc`));
    assert.ok(f.calls.includes(`lan.start ${name} ${(DAY + 1) % 256} true`));
  } finally { mock.timers.reset(); }
});

test('nenhum caminho de desmonte para o transporte: só shutdown', async () => {
  const { c, f } = core();
  c.configure({ nameSecret: SECRET, p2p: true, lan: { nodeKeyFor: key, wifiIp: '10.0.0.2', relay: true } });
  await tick();
  const release = c.claimRuntime('tela')!;
  const off = c.subscribe(() => {});
  release(); off();
  await tick();
  assert.ok(!f.calls.includes('stop') && !f.calls.includes('lan.stop'));
  await c.shutdown();
  assert.ok(f.calls.includes('stop') && f.calls.includes('lan.stop'));
  // Depois do shutdown, configurar liga de novo.
  f.calls.length = 0;
  c.configure({ p2p: true, lan: null });
  await tick();
  assert.deepEqual(f.calls, [`start ${dailyNodeName(SECRET, DAY)} svc`]);
});

test('claimRuntime: um segundo dono registra erro e não recebe a posse', () => {
  const { c, logs } = core();
  const a = c.claimRuntime('árvore A');
  assert.ok(a);
  assert.equal(c.claimRuntime('árvore B'), null);
  assert.equal(logs.length, 1);
  a!();
  assert.ok(c.claimRuntime('árvore B'), 'liberado, o próximo dono assume');
});

test('estado e vizinhos ficam no núcleo e sobrevivem ao fim da assinatura', async () => {
  const { c, f } = core();
  let n = 0;
  const off = c.subscribe(() => n++);
  f.emit({ type: 'state', state: 'running' });
  f.emit({ type: 'peerFound', peer: { id: 'p1', name: 'piu-1', via: 'ble' } });
  f.emit({ type: 'connected', id: 'p1' });
  off();
  f.emit({ type: 'peerFound', peer: { id: 'p2', name: 'piu-2', via: 'lan' } });
  const st = c.status();
  assert.equal(st.state, 'running');
  assert.deepEqual(Object.keys(st.peers).sort(), ['p1', 'p2']);
  assert.equal(st.peers.p1.connected, true);
  assert.equal(n, 3);
  assert.equal(c.status(), st, 'mesmo objeto enquanto nada muda (useSyncExternalStore)');
  f.emit({ type: 'state', state: 'off' });
  assert.deepEqual(c.status().peers, {});
});

test('falha ao ligar deixa o motivo no estado', async () => {
  const f = fakes();
  (f.transport as { start: unknown }).start = async () => { throw new Error('Bluetooth desligado'); };
  const { c } = core(f);
  c.configure({ nameSecret: SECRET, p2p: true });
  await tick(); await tick();
  assert.equal(c.status().state, 'unavailable');
  assert.equal(c.status().reason, 'Bluetooth desligado');
});

test('configuração inicial do persistido: mesmos padrões da aba Rede', () => {
  const store: Record<string, unknown> = { onboarded: true, 'transport.nameSecret': SECRET };
  const read = <T,>(k: string) => store[k] as T | undefined;
  const wifi = { connected: true, internet: true, ip: '10.0.0.2', prefix: 24, gateway: '10.0.0.1' };
  const base = { read, grants: { ble: true, nearby: false }, nodeKeyFor: key, wifi, lanAvailable: true };
  const r = persistedConfig(base);
  assert.equal(r.config.p2p, true);
  assert.equal(r.config.nameSecret, SECRET);
  assert.equal(r.config.lan?.wifiIp, '10.0.0.2');
  assert.equal(r.config.lan?.relay, true);
  assert.deepEqual(r.media, { ble: true, nearby: false, lora: false, piulora: false });
  // Sem onboarding: nada liga.
  store.onboarded = false;
  assert.equal(persistedConfig(base).config.p2p, false);
  assert.equal(persistedConfig(base).config.lan, null);
  store.onboarded = true;
  // Bluetooth desligado na aba Rede e Wi-Fi Direct sem permissão; "Wi-Fi Mesh" desligado.
  store['net.tx'] = { ble: false, direct: true, mesh: false, lora: false, eth: false };
  store['net.lan'] = false;
  assert.equal(persistedConfig(base).config.p2p, false);
  assert.equal(persistedConfig(base).config.lan, null);
  // Segredo inválido não vira nome.
  store['transport.nameSecret'] = 'x';
  assert.equal(persistedConfig(base).config.nameSecret, null);
});

