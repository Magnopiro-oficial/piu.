/// <reference types="node" />
/**
 * Transporte LAN do celular (docs/rede/pontos-piu-roteadores.md, fase 1): endereços, descoberta em
 * camadas, handshake LNNP, fragmentos, limites da auditoria e teste de compatibilidade.
 * Rede falsa em memória (lanFake.ts); a conversa com o Desktop de verdade está em apps/desktop/test.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { decodeError, LnnpErrorCode } from '../../protocol/lnnp';
import { broadcastOf, isPrivateLan, parseLanPeer, subnetHosts, subnetSize } from '../lan/addr';
import { HANDSHAKE_MAX, LnnpLanEngine, MAX_DISCOVERY_DIALS, type LanEngineOptions } from '../lan/engine';
import { classifyLanCheck, runLanCheck, type LanCheckInputs } from '../lan/lanCheck';
import { shouldScan } from '../lan/scan';
import type { LinkEvent } from '../multi';
import { FakeLan, type FakeApi } from './lanFake';

const engines: LnnpLanEngine[] = [];
function engine(api: FakeApi, o: Partial<LanEngineOptions> = {}) {
  const e = new LnnpLanEngine({ api, node: deriveNodeKey(newSeed()), beaconMs: 60, hintWaitMs: 30, handshakeTimeoutMs: 800, ...o });
  engines.push(e);
  return e;
}
const stopAll = async () => { await Promise.all(engines.splice(0).map(e => e.stop())); };
const collect = (e: LnnpLanEngine) => { const ev: LinkEvent[] = []; e.subscribe(x => ev.push(x)); return ev; };
async function until(cond: () => boolean, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- endereços ----------

test('rede local: RFC 1918, link-local, loopback e IPv6 ULA/link-local; o resto não', () => {
  for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.10', '169.254.1.1', '127.0.0.1', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.5']) assert.ok(isPrivateLan(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1', 'piu.local', '192.168.1']) assert.ok(!isPrivateLan(a), a);
});

test('vizinho manual (QR): só IP de rede local com porta; nomes, públicos e lixo são recusados', () => {
  assert.equal(parseLanPeer(' 192.168.1.20:8422 '), '192.168.1.20:8422');
  assert.equal(parseLanPeer('[FE80::1]:8422'), '[fe80::1]:8422');
  for (const bad of ['8.8.8.8:8422', 'piu.local:8422', '192.168.1.20', '192.168.1.20:0', '192.168.1.20:70000', 'http://192.168.1.2:80', 'a@192.168.1.2:1', 42, null]) assert.equal(parseLanPeer(bad), null, String(bad));
});

test('sub-rede: tamanho, broadcast e varredura só até /24, sem o próprio endereço', () => {
  assert.equal(subnetSize(24), 254);
  assert.equal(subnetSize(16), 65534);
  assert.equal(broadcastOf('192.168.1.37', 24), '192.168.1.255');
  assert.equal(broadcastOf('10.0.5.9', 22), '10.0.7.255');
  const hosts = subnetHosts('192.168.1.37', 24);
  assert.equal(hosts.length, 253);
  assert.ok(!hosts.includes('192.168.1.37') && !hosts.includes('192.168.1.0') && !hosts.includes('192.168.1.255'));
  assert.equal(subnetHosts('192.168.1.37', 28).length, 13);
  assert.deepEqual(subnetHosts('10.0.0.5', 16), [], 'sub-rede grande demais: não varre');
  assert.deepEqual(subnetHosts('8.8.8.8', 24), [], 'endereço público: não varre');
});

test('varredura automática: só sem ninguém pelo anúncio/mDNS depois do prazo, em /24, sem bateria baixa e com espera entre varreduras', () => {
  const base = { now: 10 * 60_000, startedAt: 0, lastSeenAt: null, lastScanAt: null, prefix: 24, lowPower: false, scanning: false };
  assert.ok(shouldScan(base));
  assert.ok(!shouldScan({ ...base, now: 60_000 }), 'cedo demais');
  assert.ok(!shouldScan({ ...base, lastSeenAt: 5 }), 'anúncio/mDNS já achou alguém');
  assert.ok(!shouldScan({ ...base, prefix: 23 }), 'sub-rede maior que /24');
  assert.ok(!shouldScan({ ...base, lowPower: true }), 'bateria baixa');
  assert.ok(!shouldScan({ ...base, lastScanAt: 9 * 60_000 }), 'varreu há pouco');
  assert.ok(shouldScan({ ...base, now: 40 * 60_000, lastScanAt: 9 * 60_000 }));
});

// ---------- enlace ----------

test('dois celulares no mesmo Wi-Fi: anúncio UDP, handshake LNNP, nome curto e envelopes nos dois sentidos', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  // Os dois mandam nome: o aviso sai assim que o NODE_HINT chega (engine.announce), sem depender do prazo.
  // Prazo longo de propósito: com 30 ms, máquina carregada (suíte inteira) às vezes avisava antes do nome.
  const A = engine(lan.add('192.168.1.10'), { name: 'piu-aaaaaa', hintWaitMs: 5000 });
  const B = engine(lan.add('192.168.1.20'), { name: 'piu-bbbbbb', hintWaitMs: 5000 });
  const evA = collect(A), evB = collect(B);
  await A.start(); await B.start();
  assert.equal(A.state, 'running');
  await until(() => evA.some(e => e.type === 'up') && evB.some(e => e.type === 'up'), 'enlace A–B');
  const upA = evA.find(e => e.type === 'up');
  assert.ok(upA && upA.type === 'up');
  assert.equal(upA.medium, 'lan');
  assert.equal(upA.id, B.nodeId);
  assert.equal(upA.name, 'piu-bbbbbb', 'o nome curto chega antes do aviso: vira o mesmo vizinho do Bluetooth');
  assert.equal(A.linkCount, 1);
  assert.equal(B.linkCount, 1, 'uma conexão por par');

  await A.send(B.nodeId, Uint8Array.from([1, 2, 3]));
  await until(() => evB.some(e => e.type === 'data'), 'B receber');
  const got = evB.find(e => e.type === 'data');
  assert.ok(got && got.type === 'data');
  assert.deepEqual([...got.data], [1, 2, 3]);
  assert.equal(got.id, A.nodeId);
  await B.send(A.nodeId, Uint8Array.from([9]));
  await until(() => evA.some(e => e.type === 'data'), 'A receber');
  assert.equal(A.discoveryStats().broadcast, 1);

  await B.stop();
  await until(() => evA.some(e => e.type === 'down'), 'A ver B sair');
  assert.equal(A.linkCount, 0);
});

test('envelope maior que o MTU negociado vai em fragmentos e chega inteiro', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const A = engine(lan.add('192.168.1.10'), { mtu: 600 });
  const B = engine(lan.add('192.168.1.20'), { mtu: 600 });
  const evB = collect(B);
  await A.start(); await B.start();
  await until(() => A.linkCount === 1 && B.linkCount === 1, 'enlace');
  await until(() => engines.every(e => e.peers().length === 1), 'avisos');
  const big = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 7) & 0xff);
  await A.send(B.nodeId, big);
  await until(() => evB.some(e => e.type === 'data'), 'remontagem');
  const got = evB.find(e => e.type === 'data');
  assert.ok(got && got.type === 'data');
  assert.equal(got.data.length, big.length);
  assert.deepEqual(got.data, big);
});

test('vizinho que não manda nome (Desktop/piu-node) aparece depois da espera, sem nome', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const A = engine(lan.add('192.168.1.10'), { name: 'piu-aaaaaa' });
  const B = engine(lan.add('192.168.1.20'));
  const evA = collect(A);
  await A.start(); await B.start();
  await until(() => evA.some(e => e.type === 'up'), 'aviso');
  const up = evA.find(e => e.type === 'up');
  assert.ok(up && up.type === 'up' && up.name === undefined);
});

// ---------- limites (auditoria) ----------

test('anúncios forjados: só rede local e no máximo 8 discagens de descoberta ao mesmo tempo (A-02, B-03)', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const api = lan.add('192.168.1.10');
  const A = engine(api);
  await A.start();
  const dials: string[] = [];
  const orig = api.connect.bind(api);
  api.connect = async (host: string, port: number, ms: number) => { dials.push(host); await sleep(300); return orig(host, port, ms); };
  // Etiqueta 0xff…: maior que qualquer outra, então este celular é quem disca.
  const beacon = (port: number) => Uint8Array.from([0x4c, 0x4e, 0x4e, 0x50, 0xbe, 1, 1, port >> 8, port & 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0]);
  for (let i = 0; i < 20; i++) api.fire({ type: 'udp', host: `192.168.1.${100 + i}`, port: 8423, data: beacon(8422) });
  api.fire({ type: 'udp', host: '8.8.8.8', port: 8423, data: beacon(8422) });
  await sleep(50);
  assert.equal(dials.length, MAX_DISCOVERY_DIALS, 'teto de discagens de descoberta');
  assert.ok(!dials.includes('8.8.8.8'), 'endereço fora da rede local nunca vira discagem');
  // O mesmo IP anunciando de novo dentro do período não disca outra vez.
  for (let i = 0; i < 5; i++) api.fire({ type: 'udp', host: '192.168.1.100', port: 8423, data: beacon(8422) });
  await sleep(20);
  assert.equal(dials.filter(h => h === '192.168.1.100').length, 1);
});

test('handshakes de entrada: teto por IP de origem (M-04) e quadro de handshake acima de 4 KiB fecha', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const api = lan.add('192.168.1.10');
  const A = engine(api, { maxPendingPerIp: 2, handshakeTimeoutMs: 3000 });
  await A.start();
  const atk = lan.add('192.168.1.66');
  atk.started = true;
  const got: { id: number; type: string; data?: Uint8Array }[] = [];
  atk.subscribe(e => { if (e.type === 'frame' || e.type === 'close') got.push({ id: e.id, type: e.type, data: e.type === 'frame' ? e.data : undefined }); });
  const ids = [lan.connect(atk, '192.168.1.10', A.port), lan.connect(atk, '192.168.1.10', A.port), lan.connect(atk, '192.168.1.10', A.port)];
  await sleep(30);
  const busy = got.filter(g => g.id === ids[2] && g.type === 'frame').map(g => decodeError(g.data!));
  assert.equal(busy[0]?.wire, LnnpErrorCode.Busy, 'terceira conexão do mesmo IP: ocupado');
  assert.ok(got.some(g => g.id === ids[2] && g.type === 'close'));
  assert.ok(!got.some(g => g.id === ids[0] && g.type === 'close'), 'as duas primeiras seguem no handshake');
  // Quadro grande antes do handshake: o lado "nativo" fecha (teto de 4 KiB).
  atk.send(ids[0]!, new Uint8Array(HANDSHAKE_MAX + 1));
  await sleep(30);
  assert.ok(got.some(g => g.id === ids[0] && g.type === 'close'));
});

test('origem de fora da rede local não entra (servidor só no Wi-Fi, conferido de novo no TS)', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const api = lan.add('192.168.1.10');
  const A = engine(api);
  await A.start();
  const out = lan.add('100.64.1.2');
  out.started = true;
  const closed: number[] = [];
  out.subscribe(e => { if (e.type === 'close') closed.push(e.id); });
  const id = lan.connect(out, '192.168.1.10', A.port);
  await sleep(30);
  assert.ok(closed.includes(id));
});

test('sem Wi-Fi o LAN fica indisponível (não liga em dados móveis)', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const A = engine(lan.add('192.168.1.10', { connected: false, ip: null }));
  await A.start();
  assert.equal(A.state, 'unavailable');
  assert.match(A.reason ?? '', /Wi-Fi/);
});

// ---------- descoberta em camadas ----------

test('rede que filtra broadcast: o mDNS (_piu._udp) acha o vizinho', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  lan.blockBroadcast = true;
  const A = engine(lan.add('192.168.1.10'));
  const B = engine(lan.add('192.168.1.20'));
  await A.start(); await B.start();
  await until(() => A.linkCount === 1 && B.linkCount === 1, 'enlace pelo mDNS');
  assert.equal(A.discoveryStats().broadcast + B.discoveryStats().broadcast, 0);
  assert.ok(A.discoveryStats().mdns >= 1);
});

test('sem anúncio e sem mDNS: a varredura da /24 acha quem escuta na porta do LNNP', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  lan.blockBroadcast = true;
  const a = lan.add('192.168.1.10'), b = lan.add('192.168.1.20');
  a.mdnsStart = undefined as never; b.mdnsStart = undefined as never;
  const A = engine(a, { scan: { afterMs: 0, intervalMs: 1 } });
  const B = engine(b, { discoveryPort: 9999 });
  await B.start(); await A.start();
  await until(() => A.linkCount === 1, 'enlace pela varredura', 6000);
  assert.equal(A.discoveryStats().scan, 1);
});

test('vizinho manual (QR do ponto): conecta, mostra o estado e sai sem deixar enlace', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  lan.blockBroadcast = true;
  const a = lan.add('192.168.1.10'), b = lan.add('192.168.1.20');
  a.mdnsStart = undefined as never; b.mdnsStart = undefined as never;
  const A = engine(a), B = engine(b);
  await A.start(); await B.start();
  A.addPeer(`192.168.1.20:${B.port}`);
  await until(() => A.linkCount === 1, 'enlace manual');
  assert.equal(A.manualPeers()[0]?.state, 'connected');
  assert.equal(A.manualPeers()[0]?.nodeId, B.nodeId);
  A.addPeer('192.168.1.99:8422');
  await until(() => A.manualPeers()[1]?.state === 'failed', 'falha visível');
  assert.match(A.manualPeers()[1]!.error ?? '', /recusada/);
  assert.ok(A.removePeer(`192.168.1.20:${B.port}`));
  await until(() => A.linkCount === 0, 'enlace fechado');
});

// ---------- teste de compatibilidade ----------

const inputs = (o: Partial<LanCheckInputs> = {}): LanCheckInputs => ({
  wifi: { connected: true, internet: false, ip: '192.168.4.10', prefix: 24, gateway: '192.168.4.1' },
  lanRunning: true, seen: { broadcast: 2, mdns: 1, scan: 0, links: 2 }, gatewayAdmin: ['timeout', 'timeout'], otherLans: {}, knownPeer: null, ...o,
});

test('compatibilidade: rede dedicada sem internet, aparelhos se vendo e roteador fechado = verde', () => {
  const r = classifyLanCheck(inputs());
  assert.equal(r.verdict, 'green');
  assert.deepEqual(r.issues, []);
  assert.equal(r.isolation, 'none');
  assert.equal(r.subnetSize, 254);
});

test('compatibilidade: isolamento de clientes, exposição da rede de casa, internet e broadcast filtrado', () => {
  const iso = classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 }, gatewayAdmin: ['open', 'refused'], knownPeer: { probe: 'timeout', discovered: false } }));
  assert.equal(iso.verdict, 'red');
  assert.equal(iso.isolation, 'suspected');
  assert.ok(iso.issues.includes('isolation') && iso.issues.includes('routerAdminReachable'));

  const empty = classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 } }));
  assert.equal(empty.isolation, 'unknown', 'sem vizinho de teste não dá para afirmar isolamento');
  assert.ok(empty.issues.includes('noPeers'));
  assert.equal(empty.verdict, 'yellow');

  const home = classifyLanCheck(inputs({ otherLans: { '192.168.0.1': 'open', '10.0.0.1': 'timeout' } }));
  assert.equal(home.verdict, 'red');
  assert.deepEqual(home.homeExposure.otherLans, ['192.168.0.1']);

  const net = classifyLanCheck(inputs({ wifi: { connected: true, internet: true, ip: '10.0.0.5', prefix: 16, gateway: '10.0.0.1' } }));
  assert.ok(net.issues.includes('internet') && net.issues.includes('largeSubnet'));
  assert.equal(net.verdict, 'yellow');

  const filtered = classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 1, links: 1 } }));
  assert.ok(filtered.issues.includes('broadcastFiltered'));

  const known = classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 }, knownPeer: { probe: 'open', discovered: false } }));
  assert.equal(known.isolation, 'none');
  assert.ok(known.issues.includes('broadcastFiltered'));

  const off = classifyLanCheck(inputs({ wifi: { connected: false, internet: false, ip: null, prefix: null, gateway: null } }));
  assert.equal(off.verdict, 'red');
  assert.deepEqual(off.issues, ['noWifi']);
});

test('runLanCheck: mede descoberta e conexões de teste (só abre e fecha) e classifica', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const a = lan.add('192.168.1.10', { internet: true });
  lan.add('192.168.1.20');
  const A = engine(a);
  const B = engine(lan.apis[1]!);
  await A.start(); await B.start();
  lan.probes.set('192.168.1.1:80', 'open');
  lan.probes.set('192.168.0.1:80', 'refused');
  lan.probes.set(`192.168.1.20:${B.port}`, 'open');
  const r = await runLanCheck({ api: a, engine: A, knownPeer: `192.168.1.20:${B.port}`, listenMs: 150 });
  assert.equal(r.wifi, true);
  assert.equal(r.internet, true);
  assert.ok(r.peers.broadcast >= 1);
  assert.equal(r.isolation, 'none');
  assert.equal(r.homeExposure.routerAdmin, true);
  assert.deepEqual(r.homeExposure.otherLans, ['192.168.0.1']);
  assert.ok(r.issues.includes('homeLanReachable') && r.issues.includes('internet'));
  assert.equal(r.verdict, 'red');
});

test('pulso nativo (PiuRelayService, tela apagada): anuncia quando o timer JS atrasou, e não em dobro', async t => {
  t.after(stopAll);
  const lan = new FakeLan();
  const a = lan.add('192.168.1.10');
  let now = 1_000_000;
  // Anúncio de 5 s com o timer JS parado (o intervalo nunca dispara no teste): só o pulso anuncia.
  const A = engine(a, { beaconMs: 5000, now: () => now });
  const beacons = () => a.sent.filter(s => s.port === 8423).length;
  await A.start();
  const first = beacons();
  assert.ok(first >= 1, 'anúncio ao ligar');
  A.heartbeat();
  assert.equal(beacons(), first, 'o timer está em dia: o pulso não repete o anúncio');
  now += 5000;
  A.heartbeat();
  assert.ok(beacons() > first, 'o timer atrasou: o pulso anuncia');
  await A.stop();
  const stopped = beacons();
  now += 60_000;
  A.heartbeat();
  assert.equal(beacons(), stopped, 'desligada não anuncia');
});
