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
