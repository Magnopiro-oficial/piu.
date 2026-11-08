/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_HEADER_BYTES, frameHeader, helloFrame, MAX_PARTIAL_MESSAGES, nextMessageId, PARTIAL_TIMEOUT_MS, Reassembler, toFrames } from '../frames';
import { createMultiTransport, type LinkEvent, type LinkSource } from '../multi';
import { FAILURE_COOLDOWN_MS, isLora, MEDIA, rankLinks, SMALL_ENVELOPE_BYTES, type LinkInfo } from '../select';
import { DISCOVERY_INTERVAL_SEC, type Medium, type TransportEvent } from '../types';

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const L = (medium: Medium, extra: Partial<LinkInfo> = {}): LinkInfo => ({ medium, up: true, failures: 0, ...extra });

// ---------- seleção (FUN-013) ----------

test('envelope pequeno prefere BLE; grande prefere Nearby', () => {
  const links = [L('nearby'), L('ble')];
  assert.deepEqual(rankLinks(links, { size: 200, lowBattery: false, now: 0 }).map(l => l.medium), ['ble', 'nearby']);
  assert.deepEqual(rankLinks(links, { size: SMALL_ENVELOPE_BYTES + 1, lowBattery: false, now: 0 }).map(l => l.medium), ['nearby', 'ble']);
});

test('bateria baixa prefere BLE mesmo com envelope grande', () => {
  const r = rankLinks([L('nearby'), L('ble')], { size: 20_000, lowBattery: true, now: 0 });
  assert.deepEqual(r.map(l => l.medium), ['ble', 'nearby']);
});

test('só enlaces conectados, ligados e com capacidade para o envelope', () => {
  const links = [L('nearby', { up: false }), L('ble')];
  assert.deepEqual(rankLinks(links, { size: 5000, lowBattery: false, now: 0 }).map(l => l.medium), ['ble']);
  assert.deepEqual(rankLinks([L('nearby'), L('ble')], { size: 5000, lowBattery: false, now: 0, disabled: new Set<Medium>(['nearby']) }).map(l => l.medium), ['ble']);
  const caps = { ble: { ...MEDIA.ble, maxEnvelopeBytes: 1000 } };
  assert.deepEqual(rankLinks([L('nearby'), L('ble')], { size: 1500, lowBattery: true, now: 0, caps }).map(l => l.medium), ['nearby']);
});

test('enlace que falhou há pouco vai para o fim e volta depois do resfriamento', () => {
  const links = [L('nearby'), L('ble', { failures: 1, lastFailureAt: 1000 })];
  assert.deepEqual(rankLinks(links, { size: 100, lowBattery: false, now: 2000 }).map(l => l.medium), ['nearby', 'ble']);
  assert.deepEqual(rankLinks(links, { size: 100, lowBattery: false, now: 1000 + FAILURE_COOLDOWN_MS }).map(l => l.medium), ['ble', 'nearby']);
  // Duas falhas seguidas: resfriamento dobra.
  const twice = [L('nearby'), L('ble', { failures: 2, lastFailureAt: 1000 })];
  assert.equal(rankLinks(twice, { size: 100, lowBattery: false, now: 1000 + FAILURE_COOLDOWN_MS })[0].medium, 'nearby');
});

test('cada meio declara MTU, tamanho máximo, banda e custo de energia (INF-005)', () => {
  for (const m of Object.values(MEDIA)) {
    // LoRa (Meshtastic e o próprio) é a exceção de propósito: só texto curto e recibos (meshtastic/fragments.ts).
    assert.ok(isLora(m.medium) ? m.maxEnvelopeBytes >= 512 : m.maxEnvelopeBytes >= 32 * 1024);
    assert.ok(m.mtuBytes > FRAME_HEADER_BYTES && m.approxBytesPerSec > 0);
  }
  assert.ok(MEDIA.nearby.approxBytesPerSec > MEDIA.ble.approxBytesPerSec);
  assert.ok(MEDIA.ble.energyCost < MEDIA.nearby.energyCost);
});

// ---------- vizinhos lógicos e troca de meio (FUN-014) ----------

function fakeSource(media: Medium[] = ['nearby', 'ble']) {
  const listeners = new Set<(e: LinkEvent) => void>();
  const sent: { medium: Medium; id: string; size: number }[] = [];
  const failing = new Set<Medium>();
  const source: LinkSource = {
    kind: 'nearby',
    media: media.map(m => MEDIA[m]),
    start: async () => {},
    stop: async () => {},
    sendVia: async (medium, id, data) => {
      sent.push({ medium, id, size: data.length });
      if (failing.has(medium)) throw new Error(`falha em ${medium}`);
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  return { source, sent, failing, emit: (e: LinkEvent) => listeners.forEach(fn => fn(e)) };
}

function setup(opts: { lowBattery?: () => boolean; now?: () => number } = {}) {
  const f = fakeSource();
  const t = createMultiTransport(f.source, opts);
  const events: TransportEvent[] = [];
  t.subscribe(e => events.push(e));
  return { ...f, t, events };
}

test('o mesmo vizinho por Nearby e BLE vira um só, com os dois meios', async () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'nearby', id: 'AB12', name: 'piu-aaaaaa' });
  s.emit({ type: 'up', medium: 'ble', id: '11:22:33:44:55:66', name: 'piu-aaaaaa' });
  const connected = s.events.filter(e => e.type === 'connected');
  assert.equal(connected.length, 1);
  assert.deepEqual(connected[0], { type: 'connected', id: 'n:piu-aaaaaa', name: 'piu-aaaaaa', via: 'nearby' });

  await s.t.send('n:piu-aaaaaa', bytes(100));
  await s.t.send('n:piu-aaaaaa', bytes(10_000));
  assert.deepEqual(s.sent.map(x => x.medium), ['ble', 'nearby']);
});

test('se o meio escolhido falha, cai para o outro e lembra da falha', async () => {
  let clock = 0;
  const s = setup({ now: () => clock });
  s.emit({ type: 'up', medium: 'nearby', id: 'AB12', name: 'piu-b' });
  s.emit({ type: 'up', medium: 'ble', id: 'X', name: 'piu-b' });
  s.failing.add('ble');
  await s.t.send('n:piu-b', bytes(100));
  assert.deepEqual(s.sent.map(x => x.medium), ['ble', 'nearby']);
  // Durante o resfriamento, o BLE nem é tentado primeiro.
  s.failing.clear(); s.sent.length = 0; clock = 1000;
  await s.t.send('n:piu-b', bytes(100));
  assert.deepEqual(s.sent.map(x => x.medium), ['nearby']);
  // Depois do resfriamento, volta a preferir BLE para envelope pequeno.
  s.sent.length = 0; clock = FAILURE_COOLDOWN_MS + 1;
  await s.t.send('n:piu-b', bytes(100));
  assert.deepEqual(s.sent.map(x => x.medium), ['ble']);
});

test('todos os meios falham: o envio falha (o mensageiro mantém na fila)', async () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'nearby', id: 'A', name: 'piu-c' });
  s.emit({ type: 'up', medium: 'ble', id: 'B', name: 'piu-c' });
  s.failing.add('ble'); s.failing.add('nearby');
  await assert.rejects(s.t.send('n:piu-c', bytes(10)), /falha em nearby/);
  await assert.rejects(s.t.send('desconhecido', bytes(10)), /não está conectado/);
  await assert.rejects(s.t.send('n:piu-c', bytes(40 * 1024)), /maior que 32 KB/);
});

test('bateria baixa (leitura automática e dica manual) prefere BLE', async () => {
  let low = true;
  const s = setup({ lowBattery: () => low });
  s.emit({ type: 'up', medium: 'nearby', id: 'A', name: 'piu-d' });
  s.emit({ type: 'up', medium: 'ble', id: 'B', name: 'piu-d' });
  await s.t.send('n:piu-d', bytes(20_000));
  low = false;
  await s.t.send('n:piu-d', bytes(20_000));
  s.t.setPowerHint!(true);
  await s.t.send('n:piu-d', bytes(20_000));
  s.t.setPowerHint!(null);
  await s.t.send('n:piu-d', bytes(20_000));
  assert.deepEqual(s.sent.map(x => x.medium), ['ble', 'nearby', 'ble', 'nearby']);
});

test('meio desligado pela pessoa não é usado', async () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'nearby', id: 'A', name: 'piu-e' });
  s.emit({ type: 'up', medium: 'ble', id: 'B', name: 'piu-e' });
  s.t.setMediaEnabled!({ ble: false });
  await s.t.send('n:piu-e', bytes(10));
  s.t.setMediaEnabled!({ ble: true, nearby: false });
  await s.t.send('n:piu-e', bytes(10_000));
  assert.deepEqual(s.sent.map(x => x.medium), ['nearby', 'ble']);
});

test('vizinho só some quando o último meio cai; envelope informa o meio', () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'nearby', id: 'A', name: 'piu-f' });
  s.emit({ type: 'up', medium: 'ble', id: 'B', name: 'piu-f' });
  s.emit({ type: 'data', medium: 'ble', id: 'B', data: bytes(3) });
  const env = s.events.find(e => e.type === 'envelope');
  assert.deepEqual(env, { type: 'envelope', from: 'n:piu-f', data: bytes(3), via: 'ble' });

  s.emit({ type: 'down', medium: 'nearby', id: 'A' });
  s.emit({ type: 'lost', medium: 'nearby', id: 'A' });
  assert.equal(s.events.filter(e => e.type === 'disconnected' || e.type === 'peerLost').length, 0);
  s.emit({ type: 'down', medium: 'ble', id: 'B' });
  assert.deepEqual(s.events.at(-1), { type: 'disconnected', id: 'n:piu-f' });
  s.emit({ type: 'lost', medium: 'ble', id: 'B' });
  assert.deepEqual(s.events.at(-1), { type: 'peerLost', id: 'n:piu-f' });
});

test('enlace BLE sem nome migra para o vizinho certo quando o hello chega', () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'nearby', id: 'A', name: 'piu-g' });
  s.emit({ type: 'up', medium: 'ble', id: 'C1' }); // central que conectou em nós: nome ainda desconhecido
  assert.ok(s.events.some(e => e.type === 'connected' && e.id === 'l:ble:C1'));
  s.events.length = 0;
  s.emit({ type: 'found', medium: 'ble', id: 'C1', name: 'piu-g' }); // hello
  assert.deepEqual(s.events.slice(0, 2), [{ type: 'disconnected', id: 'l:ble:C1' }, { type: 'peerLost', id: 'l:ble:C1' }]);
  // O vizinho piu-g ganha o meio BLE (via de exibição continua a mais rápida).
  assert.ok(!s.events.some(e => e.type === 'connected'));
});

test('transporte desligado esquece os vizinhos', async () => {
  const s = setup();
  s.emit({ type: 'up', medium: 'ble', id: 'B', name: 'piu-h' });
  s.emit({ type: 'state', state: 'off' });
  await assert.rejects(s.t.send('n:piu-h', bytes(1)), /não está conectado/);
  assert.deepEqual(s.events.at(-1), { type: 'state', state: 'off' });
});

// ---------- blocos BLE e remontagem ----------

test('blocos: cabeçalho de 8 bytes big-endian e tamanho do MTU', () => {
  const data = bytes(1000);
  const frames = toFrames(data, 185, 0x01020304);
  assert.equal(frames.length, Math.ceil(1000 / (185 - 8)));
  assert.ok(frames.every(f => f.length <= 185));
  assert.deepEqual([...frames[1].subarray(0, 8)], [1, 2, 3, 4, 0, 1, 0, frames.length]);
  assert.deepEqual(frameHeader(frames.at(-1)!), { id: 0x01020304, index: frames.length - 1, count: frames.length });
  assert.equal(toFrames(new Uint8Array(0), 23, 1).length, 1);
  assert.throws(() => toFrames(data, 23, 0));
  assert.equal(nextMessageId(0xffffffff), 1);
});

test('remontagem fora de ordem, com repetidos, por remetente', () => {
  const r = new Reassembler(() => 0);
  const a = bytes(5000, 7), b = bytes(700, 9);
  const fa = toFrames(a, 23, 5), fb = toFrames(b, 512, 5);
  const order = fa.map((_, i) => i).reverse();
  let out = null;
  for (const i of order) { out = r.push('A', fa[i]) ?? out; if (i === 3) assert.equal(r.push('A', fa[i]), null); }
  for (const f of fb) { const x = r.push('B', f); if (x) assert.deepEqual(x, { kind: 'envelope', data: b }); }
  assert.deepEqual(out, { kind: 'envelope', data: a });
  assert.equal(r.open, 0);
});

test('hello: nome do nó em bloco único com id 0', () => {
  const r = new Reassembler();
  assert.deepEqual(r.push('A', helloFrame('piu-abc123')), { kind: 'hello', name: 'piu-abc123' });
  assert.equal(helloFrame('x'.repeat(100)).length, 8 + 64);
});

test('remontagem tem teto de memória: bloco inválido, envelope > 32 KB, prazo e número de remontagens', () => {
  let clock = 0;
  const r = new Reassembler(() => clock);
  // Bloco curto, índice fora do total, total zero.
  assert.equal(r.push('A', new Uint8Array(4)), null);
  assert.equal(r.push('A', Uint8Array.of(0, 0, 0, 1, 0, 5, 0, 5, 1)), null);
  assert.equal(r.push('A', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0, 1)), null);
  // Mais de 32 KB somando os blocos: descartado.
  const big = toFrames(bytes(33 * 1024), 512, 9);
  for (const f of big) assert.equal(r.push('A', f), null);
  assert.ok(r.open <= 1); // só o último bloco (tamanho desconhecido) fica aberto até expirar
  r.clear();
  // Mesmo chegando só o último bloco antes, a soma acima de 32 KB é descartada.
  const tail = [...big].reverse();
  for (const f of tail) assert.equal(r.push('A', f), null);
  r.clear();
  // No máximo 64 remontagens abertas.
  for (let i = 1; i <= MAX_PARTIAL_MESSAGES + 10; i++) r.push('A', toFrames(bytes(100), 23, i)[0]);
  assert.equal(r.open, MAX_PARTIAL_MESSAGES);
  // Remontagem velha expira.
  clock = PARTIAL_TIMEOUT_MS;
  r.push('B', toFrames(bytes(100), 23, 1)[0]);
  assert.equal(r.open, 1);
});

// ---------- descoberta (NFR-004) ----------

test('8.1 "Procurar vizinhos" chega ao módulo nativo: Econômica 60 s, Normal 20 s, Rápida 5 s', () => {
  const f = fakeSource();
  const got: number[] = [];
  f.source.setDiscoveryInterval = s => got.push(s);
  const t = createMultiTransport(f.source);
  for (const m of ['eco', 'normal', 'fast'] as const) t.setDiscoveryInterval?.(DISCOVERY_INTERVAL_SEC[m]);
  t.setDiscoveryInterval?.(Number.NaN);
  t.setDiscoveryInterval?.(0);
  assert.deepEqual(got, [60, 20, 5], 'valores inválidos não chegam ao rádio');
});
