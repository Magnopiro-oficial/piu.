/**
 * Compatibilidade de fio: o transporte LAN do CELULAR (apps/mobile/src/transport/lan/engine.ts, o
 * mesmo TypeScript que roda no Android sobre o módulo piu-lan) conversando com o LnnpLanTransport do
 * Desktop por soquetes de verdade (TCP e UDP do Node no 127.0.0.1): anúncio de 18 bytes, handshake
 * LNNP, envelopes e fragmentos. Aqui os soquetes são do Node; no celular, do módulo nativo.
 */
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../mobile/src/protocol/keys';
import { LnnpLanEngine } from '../../mobile/src/transport/lan/engine';
import type { LanSocketApi, LanSocketEvent } from '../../mobile/src/transport/lan/types';
import type { LinkEvent } from '../../mobile/src/transport/multi';
import { LnnpLanTransport } from '../src/transport/lnnpLan';
import type { TransportEvent } from '../src/transport/types';

/** Soquetes do "celular" com o Node: o mesmo contrato do módulo nativo (quadros u32, teto por conexão). */
function nodeApi(o: { udpTargetPort: () => number }): LanSocketApi & { udpPort: number } {
  const subs = new Set<(e: LanSocketEvent) => void>();
  const emit = (e: LanSocketEvent) => subs.forEach(fn => fn(e));
  const conns = new Map<number, { sock: Socket; limit: number }>();
  let next = 1;
  let server: Server | null = null;
  const udp = createSocket({ type: 'udp4', reuseAddr: true });
  const adopt = (sock: Socket) => {
    const id = next++;
    const c = { sock, limit: 4096 };
    conns.set(id, c);
    let buf = Buffer.alloc(0);
    sock.on('data', chunk => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n === 0 || n > c.limit) { sock.destroy(); return; }
        if (buf.length < 4 + n) break;
        emit({ type: 'frame', id, data: new Uint8Array(buf.subarray(4, 4 + n)) });
        buf = buf.subarray(4 + n);
      }
    });
    sock.on('error', () => {});
    sock.once('close', () => { conns.delete(id); emit({ type: 'close', id }); });
    return id;
  };
  const api = {
    udpPort: 0,
    async start() {
      server = createServer(sock => { const id = adopt(sock); emit({ type: 'accept', id, host: sock.remoteAddress!.replace(/^::ffff:/, ''), port: sock.remotePort! }); });
      await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
      await new Promise<void>(r => udp.bind(0, '127.0.0.1', () => r()));
      udp.on('message', (msg, rinfo) => emit({ type: 'udp', host: rinfo.address, port: rinfo.port, data: new Uint8Array(msg) }));
      api.udpPort = udp.address().port;
      const a = server.address();
      return { tcpPort: typeof a === 'object' && a ? a.port : 0, udpPort: api.udpPort };
    },
    async stop() { for (const c of conns.values()) c.sock.destroy(); udp.close(); await new Promise<void>(r => (server ? server.close(() => r()) : r())); },
    // O celular manda para a porta padrão de descoberta; aqui, para a do Desktop do teste.
    udpSend(_host: string, _port: number, data: Uint8Array) { udp.send(data, o.udpTargetPort(), '127.0.0.1'); },
    connect(host: string, port: number) {
      return new Promise<number>((res, rej) => { const s = connect({ host, port }); s.once('connect', () => res(adopt(s))); s.once('error', rej); });
    },
    send(id: number, frame: Uint8Array) { const c = conns.get(id); if (!c) throw new Error('fechada'); const h = Buffer.alloc(4); h.writeUInt32BE(frame.length); c.sock.write(Buffer.concat([h, frame])); },
    setFrameLimit(id: number, max: number) { const c = conns.get(id); if (c) c.limit = max; },
    close(id: number) { conns.get(id)?.sock.destroy(); },
    subscribe(fn: (e: LanSocketEvent) => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    async networkInfo() { return { connected: true, internet: false, ip: '127.0.0.1', prefix: 8, gateway: null }; },
    async probe() { return 'timeout' as const; },
  };
  return api;
}

async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 15)); }
}

test('celular ↔ Desktop pela rede local: anúncio UDP, handshake LNNP, envelopes e fragmentos nos dois sentidos', async t => {
  const desk = new LnnpLanTransport({ node: deriveNodeKey(newSeed()), listen: '127.0.0.1', port: 0, discoveryPort: 0, broadcast: [], peers: [], beaconMs: 100, handshakeTimeoutMs: 2000 });
  await desk.start();
  const api = nodeApi({ udpTargetPort: () => desk.discoveryPort ?? 0 });
  const phone = new LnnpLanEngine({ api, node: deriveNodeKey(newSeed()), name: 'piu-abcdef', beaconMs: 100, hintWaitMs: 50, mtu: 1024 });
  t.after(async () => { await phone.stop(); await desk.stop(); });
  const evP: LinkEvent[] = [], evD: TransportEvent[] = [];
  phone.subscribe(e => evP.push(e));
  desk.subscribe(e => evD.push(e));
  await phone.start();
  // O Desktop anuncia para a porta UDP do celular (no fio real, os dois usam 8423 em broadcast).
  (desk as unknown as { o: { broadcast: string[] } }).o.broadcast = [`127.0.0.1:${api.udpPort}`];

  await until(() => phone.linkCount === 1 && desk.linkCount === 1, 'enlace celular–Desktop');
  await until(() => evP.some(e => e.type === 'up'), 'aviso do enlace no celular');
  const up = evP.find(e => e.type === 'up');
  assert.ok(up && up.type === 'up');
  assert.equal(up.id, desk.nodeId);
  assert.equal(up.name, undefined, 'o Desktop não manda nome curto (ignora o NODE_HINT)');

  await phone.send(desk.nodeId, Uint8Array.from([1, 2, 3]));
  await until(() => evD.some(e => e.type === 'envelope'), 'Desktop receber');
  const got = evD.find(e => e.type === 'envelope');
  assert.ok(got && got.type === 'envelope');
  assert.equal(got.from, phone.nodeId);
  assert.deepEqual([...got.data], [1, 2, 3]);

  // Envelope maior que o MTU que o celular anunciou: o Desktop fragmenta e o celular remonta.
  const big = Uint8Array.from({ length: 8000 }, (_, i) => (i * 13) & 0xff);
  await desk.send(phone.nodeId, big);
  await until(() => evP.some(e => e.type === 'data'), 'celular receber');
  const back = evP.find(e => e.type === 'data');
  assert.ok(back && back.type === 'data');
  assert.deepEqual(back.data, big);
});
