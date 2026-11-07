import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../mobile/src/protocol/keys';
import { LnnpLanTransport, type LanTransportOptions } from '../src/transport/lnnpLan';
import type { TransportEvent } from '../src/transport/types';

const started: LnnpLanTransport[] = [];
async function lan(o: Partial<LanTransportOptions> = {}) {
  const t = new LnnpLanTransport({ node: deriveNodeKey(newSeed()), listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], beaconMs: 150, handshakeTimeoutMs: 2000, ...o });
  await t.start();
  started.push(t);
  return t;
}
const addr = (t: LnnpLanTransport) => `127.0.0.1:${t.port}`;
const closeAll = async () => { await Promise.all(started.splice(0).map(t => t.stop())); };

async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 15));
  }
}
const collect = (t: LnnpLanTransport) => { const ev: TransportEvent[] = []; t.subscribe(e => ev.push(e)); return ev; };

test('LAN: dois computadores fazem o handshake LNNP por TCP e trocam envelopes nos dois sentidos', async t => {
  t.after(closeAll);
  const B = await lan();
  const A = await lan({ peers: [addr(B)] });
  const evA = collect(A), evB = collect(B);
  await until(() => A.linkCount === 1 && B.linkCount === 1, 'enlace A–B');
  const connA = evA.find(e => e.type === 'connected');
  assert.ok(connA && connA.type === 'connected');
  assert.equal(connA.id, B.nodeId, 'A vê o id do nó B');
  const peerB = A.peerStatus()[0]!;
  assert.equal(peerB.state, 'connected');
  assert.equal(peerB.source, 'config');
  assert.equal(peerB.nodeId, B.nodeId);

  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  await A.send(B.nodeId, bytes);
  await until(() => evB.some(e => e.type === 'envelope'), 'B receber');
  const got = evB.find(e => e.type === 'envelope');
  assert.ok(got && got.type === 'envelope');
  assert.equal(got.from, A.nodeId);
  assert.deepEqual([...got.data], [1, 2, 3, 4, 5]);
  await B.send(A.nodeId, Uint8Array.from([9]));
  await until(() => evA.some(e => e.type === 'envelope'), 'A receber');
});

test('LAN: envelope maior que o MTU negociado vai fragmentado e chega inteiro', async t => {
  t.after(closeAll);
  const B = await lan({ mtu: 600 });
  const A = await lan({ peers: [addr(B)] });
  const evB = collect(B);
  await until(() => A.linkCount === 1, 'enlace');
  const big = new Uint8Array(2000).map((_, i) => i & 0xff);
  await A.send(B.nodeId, big);
  await until(() => evB.some(e => e.type === 'envelope'), 'B receber o envelope remontado');
  const got = evB.find(e => e.type === 'envelope');
  assert.ok(got && got.type === 'envelope');
  assert.deepEqual(got.data, big);
});

test('LAN: vizinho inexistente fica "failed" com motivo; adicionar e remover vizinho em tempo de execução', async t => {
  t.after(closeAll);
  const A = await lan({ handshakeTimeoutMs: 300 });
  A.addPeer('127.0.0.1:1'); // nada escuta aqui
  await until(() => A.peerStatus()[0]?.state === 'failed', 'falha registrada', 4000);
  const p = A.peerStatus()[0]!;
  assert.equal(p.source, 'manual');
  assert.match(p.error ?? '', /recusada|sem resposta/);
  assert.equal(A.removePeer('127.0.0.1:1'), true);
  assert.equal(A.peerStatus().length, 0);
  assert.equal(A.removePeer('127.0.0.1:1'), false);
});

test('LAN: enviar para vizinho sem enlace rejeita (a fila do roteador segura a mensagem)', async t => {
  t.after(closeAll);
  const A = await lan();
  await assert.rejects(A.send('0000000000000000', Uint8Array.of(1)), /enlace/i);
});

test('LAN: descoberta por UDP em localhost conecta os dois sem vizinho fixo', async t => {
  t.after(closeAll);
  // Portas de descoberta distintas (mesma máquina): cada um anuncia para a porta do outro.
  const pB = 48000 + Math.floor(Math.random() * 1000);
  const pA = pB + 1;
  const B = await lan({ discoveryPort: pB, broadcast: [`127.0.0.1:${pA}`] });
  const A = await lan({ discoveryPort: pA, broadcast: [`127.0.0.1:${pB}`] });
  await until(() => A.linkCount === 1 && B.linkCount === 1, 'descoberta UDP → enlace TCP', 6000);
  // Aparece na tela Rede como descoberto (não como vizinho fixo): some quando o enlace cai.
  assert.deepEqual(A.peerStatus().map(p => [p.source, p.state, p.nodeId]), [['discovered', 'connected', B.nodeId]]);
  await A.stop();
  await until(() => B.linkCount === 0, 'B percebe a saída de A');
});

test('B-03: beacon só faz discar para endereço da rede local, uma vez por IP no intervalo, com teto de discagens descobertas', async t => {
  t.after(closeAll);
  const { isPrivateLan } = await import('../src/transport/lnnpLan');
  const { encodeBeacon, LNNP_MIN_VERSION, LNNP_VERSION } = await import('../../mobile/src/protocol/lnnp');
  for (const a of ['10.0.0.5', '172.16.3.4', '172.31.255.1', '192.168.0.10', '169.254.1.1', '127.0.0.1', '::1', 'fe80::1', 'fd12:3456::1', '::ffff:192.168.1.2']) assert.equal(isPrivateLan(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '1.1.1.1', '2001:4860::8888', '::ffff:8.8.8.8', 'lixo', '']) assert.equal(isPrivateLan(a), false, a);
  const A = await lan();
  const dials: string[] = [];
  (A as unknown as { dial: (x: string) => void }).dial = x => { dials.push(x); };
  const beacon = (port: number) => Buffer.from(encodeBeacon({ minVersion: LNNP_MIN_VERSION, maxVersion: LNNP_VERSION, port, tag: new Uint8Array(8).fill(0xff), relay: false }));
  const onBeacon = (msg: Buffer, from: string) => (A as unknown as { onBeacon: (m: Buffer, a: string) => void }).onBeacon(msg, from);
  onBeacon(beacon(8422), '8.8.8.8');
  assert.deepEqual(dials, [], 'endereço público: ignora');
  onBeacon(beacon(8422), '192.168.0.20');
  onBeacon(beacon(9000), '192.168.0.20');
  onBeacon(beacon(9001), '192.168.0.20');
  assert.deepEqual(dials, ['192.168.0.20:8422'], 'portas variadas do mesmo IP: uma discagem por intervalo');
  for (let i = 1; i <= 40; i++) onBeacon(beacon(8422), `10.0.0.${i}`);
  assert.ok(dials.length <= 1 + 16, `teto de discagens descobertas (${dials.length})`);
});
