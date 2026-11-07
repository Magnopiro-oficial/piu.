// Descoberta LAN pelo broadcast da SUB-REDE (ex.: 192.168.50.255), como o guia "Wi-Fi externo" manda
// configurar numa rede nova (PIU_LNNP_BROADCAST / lnnp.broadcast). Diferente do teste de relay.test.ts,
// que anuncia direto em 127.0.0.1: aqui os dois nós escutam em 0.0.0.0, na MESMA porta UDP de descoberta
// (como dois equipamentos na rede), e o anúncio vai para o endereço de broadcast da interface de verdade.
// O enlace TCP abre para o IP de origem do anúncio (o da interface), não para localhost.
//
// Precisa de uma interface IPv4 não interna com máscara menor que /32 (Wi-Fi, Ethernet, runner do CI).
// Sem ela, o teste é pulado e diz por quê.
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { test } from 'node:test';
import type { LnnpConfig } from '../src/config.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { type RelayHandle, startRelay } from '../src/relay/index.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

/** Broadcast da sub-rede (endereço | ~máscara); null para /31, /32 ou valor torto. */
function subnetBroadcast(address: string, netmask: string): string | null {
  const n = (s: string) => { const p = s.split('.').map(Number); return p.length === 4 && p.every(x => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0 : null; };
  const a = n(address), m = n(netmask);
  if (a === null || m === null || m >>> 0 >= 0xfffffffe) return null;
  const b = (a | ~m) >>> 0;
  return [b >>> 24, (b >>> 16) & 255, (b >>> 8) & 255, b & 255].join('.');
}

test('subnetBroadcast (ajudante do teste): endereço | ~máscara', () => {
  assert.equal(subnetBroadcast('192.168.50.1', '255.255.255.0'), '192.168.50.255');
  assert.equal(subnetBroadcast('10.1.2.3', '255.255.0.0'), '10.1.255.255');
  assert.equal(subnetBroadcast('10.0.0.1', '255.255.255.254'), null);
});

/** Primeira interface IPv4 externa com broadcast de sub-rede (endereço, broadcast). */
function lanInterface(): { address: string; broadcast: string; name: string } | null {
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const broadcast = subnetBroadcast(i.address, i.netmask);
      if (broadcast) return { address: i.address, broadcast, name };
    }
  }
  return null;
}

const freeUdpPort = () => new Promise<number>(res => {
  const s = createSocket('udp4');
  s.bind(0, '0.0.0.0', () => { const { port } = s.address(); s.close(() => res(port)); });
});

const iface = lanInterface();

test('LAN: dois nós na mesma porta UDP se acham pelo broadcast da sub-rede e abrem um enlace só', { skip: iface ? false : 'sem interface IPv4 com broadcast de sub-rede nesta máquina' }, async t => {
  const discoveryPort = await freeUdpPort();
  const cfg = (): LnnpConfig => ({
    enabled: true, relay: true, listen: '0.0.0.0', port: 0, discoveryPort, broadcast: [iface!.broadcast], peers: [],
    memoryMB: 16, allow: null, beaconMs: 200,
  });
  const nodes: RelayHandle[] = [];
  t.after(() => Promise.all(nodes.map(n => n.close())));
  for (let i = 0; i < 2; i++) nodes.push(await startRelay(deriveNodeKey(newSeed()), cfg(), DEFAULT_SETTINGS, { tickMs: 100 }));
  const [A, B] = nodes as [RelayHandle, RelayHandle];
  assert.equal(A.discoveryPort, discoveryPort);
  assert.equal(B.discoveryPort, discoveryPort, 'as duas instâncias dividem a porta de descoberta (reuseAddr)');

  const end = Date.now() + 8000;
  while (!(A.engine.stats().neighbors.length === 1 && B.engine.stats().neighbors.length === 1)) {
    assert.ok(Date.now() < end, `sem enlace pela descoberta em 8 s (broadcast ${iface!.broadcast}:${discoveryPort} em ${iface!.name})`);
    await new Promise(r => setTimeout(r, 50));
  }
  await new Promise(r => setTimeout(r, 600)); // várias rodadas de anúncio: nada de conexão dupla
  assert.equal(A.engine.stats().neighbors.length, 1);
  assert.equal(B.engine.stats().neighbors.length, 1);
  assert.equal(A.engine.stats().neighbors[0]!.id, B.engine.stats().node);
  // Quem disca usa o IP de origem do anúncio: o da interface, não o loopback.
  const dialed = [...A.lan.peerStatus(), ...B.lan.peerStatus()];
  assert.equal(dialed.length, 0, 'nenhum vizinho fixo: o enlace veio só da descoberta');
  t.diagnostic(`broadcast ${iface!.broadcast}:${discoveryPort} na interface ${iface!.name} (${iface!.address})`);
});
