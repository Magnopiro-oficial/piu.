/**
 * Desktop como guardião de ponto Piu (Piu 12 · E4/E5): chave própria do ponto, QR de Wi-Fi só com a senha
 * digitada, teste da rede com sondas só de conexão, e o nó guardando e repassando envelopes de verdade
 * entre "celulares" (enlaces LNNP reais em 127.0.0.1). Nada de rede externa: Lunes falsa onde precisa.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { utf8 } from '../../mobile/src/protocol/bytes';
import { MsgType, openDirect, sealDirect } from '../../mobile/src/protocol/envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../mobile/src/protocol/keys';
import { GuardianService, isolationSuspected, pointKey, sameNetwork } from '../src/main/guardian/guardian';
import { runLanCheck, tcpProbe } from '../src/main/guardian/lanCheck';
import { cidrOf, currentNetwork, inCidr, primaryInterface } from '../src/main/guardian/netinfo';
import { packRecords, unpackRecords } from '../src/main/guardian/sealed';
import { escapeWifi, levelSummary, sanitizeGuardianConfig, wifiPasswordProblem, wifiQr, type GuardianNetwork, type GuardianState } from '../src/shared/guardian';
import { LnnpLanTransport } from '../src/transport/lnnpLan';

const NET: GuardianNetwork = { up: true, wired: false, ssid: 'Escritório-Wi-Fi', iface: 'en0', address: '192.168.0.23', cidr: '192.168.0.0/24', gateway: '192.168.0.1', label: 'Escritório-Wi-Fi' };
async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`); await new Promise(r => setTimeout(r, 25)); }
}

test('chave do ponto: só da semente do ponto, com rótulo próprio (não é a chave de nó da frase); cada ponto é outro', () => {
  const seed = newSeed();
  const a = pointKey(seed), b = pointKey(seed), other = pointKey(newSeed());
  assert.deepEqual(a.pk, b.pk, 'determinística pela semente');
  assert.notDeepEqual(a.pk, other.pk);
  assert.notDeepEqual(a.pk, deriveNodeKey(seed).pk, 'mesmo com a mesma semente, o rótulo do ponto dá outra chave');
  const id = deriveIdentity(seed, 'public');
  assert.notDeepEqual(a.pk, id.signPk);
  assert.throws(() => pointKey(new Uint8Array(16)), /inválida/);
});

test('QR de Wi-Fi: padrão WIFI:, escapa caracteres especiais e só existe com a senha digitada (ou rede aberta)', () => {
  assert.equal(escapeWifi('a;b,c:d"e\\f'), 'a\\;b\\,c\\:d\\"e\\\\f');
  assert.equal(wifiQr('Escritório', { password: 'segredo123', open: false }), 'WIFI:T:WPA;S:Escritório;P:segredo123;;');
  assert.equal(wifiQr('Café;Bar', { password: 'p:ss;w,rd', open: false }), 'WIFI:T:WPA;S:Café\\;Bar;P:p\\:ss\\;w\\,rd;;');
  assert.equal(wifiQr('Aberta', { password: null, open: true }), 'WIFI:T:nopass;S:Aberta;;');
  assert.equal(wifiQr('Escritório', { password: null, open: false }), null, 'sem senha digitada: sem QR');
  assert.equal(wifiQr(null, { password: 'segredo123', open: false }), null, 'sem nome da rede: sem QR');
  assert.equal(wifiPasswordProblem('1234567'), 'Senhas de Wi-Fi têm pelo menos 8 caracteres.');
  assert.equal(wifiPasswordProblem('a'.repeat(64)), null, '64 hex (PSK)');
  assert.match(wifiPasswordProblem('x'.repeat(64) + 'z')!, /longa/);
  assert.match(wifiPasswordProblem('abc\ndefgh')!, /inválidos/);
});

test('configuração vinda da interface: só campos e valores conhecidos; limites reais (7 dias no máximo)', () => {
  const c = sanitizeGuardianConfig({ name: '  Piu ·  Escritório  ', level: 'guardian', storageMB: 1024, days: 7, gateway: false, autoStart: true });
  assert.deepEqual(c, { name: 'Piu · Escritório', level: 'guardian', storageMB: 1024, days: 7, gateway: false, autoStart: true });
  assert.throws(() => sanitizeGuardianConfig({ ...c, days: 30 }), /days/, '30 dias passa da validade do envelope');
  assert.throws(() => sanitizeGuardianConfig({ ...c, storageMB: 10240 }), /storageMB/);
  assert.throws(() => sanitizeGuardianConfig({ ...c, level: 'gateway' }), /level/);
  assert.throws(() => sanitizeGuardianConfig({ ...c, extra: 1 }), /extra/);
  assert.throws(() => sanitizeGuardianConfig({ ...c, name: '<script>' }), /name/);
  assert.throws(() => sanitizeGuardianConfig(null), /inválida/);
  assert.equal(levelSummary(c), 'Guardião · 1 GB · 7 dias');
  assert.equal(levelSummary({ level: 'multiplier', storageMB: 512, days: 7 }), 'Multiplicador · nada guardado');
});

test('rede: interface física privada antes das virtuais; sub-rede; nome do Wi-Fi ou "Rede local · sub-rede"', async () => {
  const ifs = {
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true, mac: '', cidr: null }],
    docker0: [{ address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', internal: false, mac: '', cidr: null }],
    en0: [{ address: '192.168.0.23', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: '', cidr: null }],
  } as never;
  assert.deepEqual(primaryInterface(ifs), { iface: 'en0', address: '192.168.0.23', netmask: '255.255.255.0' });
  assert.equal(cidrOf('10.1.2.3', '255.255.0.0'), '10.1.0.0/16');
  assert.ok(inCidr('192.168.0.1', '192.168.0.0/24'));
  assert.ok(!inCidr('192.168.1.1', '192.168.0.0/24'));
  const n = await currentNetwork({ ifaces: () => ifs, ssid: async () => null, gateway: async () => '192.168.0.1' });
  assert.equal(n.label, 'Rede local · 192.168.0.0/24');
  assert.equal((await currentNetwork({ ifaces: () => ({}) as never, ssid: async () => null, gateway: async () => null })).up, false);
  assert.ok(sameNetwork({ ssid: 'A', cidr: '192.168.0.0/24' }, NET) === false);
  assert.ok(sameNetwork({ ssid: 'Escritório-Wi-Fi', cidr: '192.168.0.0/24' }, NET));
});

test('sonda TCP: só conecta e fecha (nenhum byte enviado); porta fechada = "recusou" (há aparelho ali)', async t => {
  let got = 0;
  const srv = createServer(s => { s.on('data', d => { got += d.length; }); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  t.after(() => srv.close());
  const port = (srv.address() as { port: number }).port;
  assert.equal(await tcpProbe('127.0.0.1', port), 'open');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(got, 0, 'nada foi enviado ao aparelho sondado');
  srv.close();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(await tcpProbe('127.0.0.1', port), 'refused');
});

test('teste da rede (E4): verde, amarelo (rede de casa alcançável, ninguém respondeu) e vermelho (sem rede, sem espaço)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-check-'));
  try {
    const asked: string[] = [];
    const green = await runLanCheck(NET, { storageMB: 512, dataDir: dir, external: true }, {
      beacons: async () => 5, freeBytes: async () => 50 * 2 ** 30,
      probe: async (h, p) => { asked.push(`${h}:${p}`); return h === '1.1.1.1' ? 'open' : 'none'; },
    });
    assert.equal(green.verdict, 'ok');
    assert.deepEqual(green.steps.map(s => [s.id, s.level]), [['peers', 'ok'], ['home', 'ok'], ['internet', 'ok'], ['capacity', 'ok']]);
    assert.equal(green.steps[0]!.detail, '5 aparelhos responderam');
    assert.equal(green.internet, true);
    assert.ok(!asked.some(a => a.startsWith('192.168.0.1:') && !a.endsWith(':80') && !a.endsWith(':443')), 'só portas 80/443');
    assert.ok(asked.includes('192.168.1.1:80'), 'roteadores de OUTRAS redes privadas');
    assert.ok(!asked.includes('192.168.0.1:22'));
    const yellow = await runLanCheck(NET, { storageMB: 512, dataDir: dir, external: true }, {
      beacons: async () => 0, freeBytes: async () => 600 * 2 ** 20, probe: async h => (h === '10.0.0.1' ? 'refused' : 'none'),
    });
    assert.equal(yellow.verdict, 'warn');
    assert.match(yellow.steps[1]!.detail, /10\.0\.0\.1/);
    assert.match(yellow.steps[0]!.detail, /isola/);
    assert.equal(yellow.steps[2]!.detail, 'Não tem · o ponto funciona só na rede local');
    assert.equal(yellow.steps[3]!.level, 'warn');
    const noLan = await runLanCheck({ ...NET, up: false, cidr: null }, { storageMB: 512, dataDir: dir }, { beacons: async () => 3, probe: async () => 'open', freeBytes: async () => 1e12 });
    assert.equal(noLan.verdict, 'fail');
    const full = await runLanCheck(NET, { storageMB: 512, dataDir: dir }, { beacons: async () => 3, probe: async () => 'none', freeBytes: async () => 100 * 2 ** 20 });
    assert.equal(full.verdict, 'fail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const EXTERNAL = ['1.1.1.1', '9.9.9.9'];

test('teste da rede sem a ponte: nenhum contato externo; a etapa "internet" é só uma estimativa local (há rota de saída?)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-local-'));
  try {
    const asked: string[] = [];
    const deps = { beacons: async () => 3, freeBytes: async () => 50 * 2 ** 30, probe: async (h: string) => { asked.push(h); return 'open' as const; } };
    const local = await runLanCheck(NET, { storageMB: 512, dataDir: dir }, deps);
    assert.ok(!asked.some(h => EXTERNAL.includes(h)), 'sem a ponte, 1.1.1.1 e 9.9.9.9 nunca são consultados');
    assert.ok(asked.includes('192.168.1.1') && asked.includes('192.168.0.1'), 'as etapas da rede local continuam iguais');
    assert.equal(local.internet, false, 'estimativa não conta como internet confirmada');
    assert.deepEqual(local.steps.map(s => [s.id, s.level]), [['peers', 'ok'], ['home', 'warn'], ['internet', 'ok'], ['capacity', 'ok']]);
    assert.match(local.steps[2]!.detail, /Parece ter .*estimativa local/);
    const noRoute = await runLanCheck({ ...NET, gateway: null }, { storageMB: 512, dataDir: dir }, deps);
    assert.match(noRoute.steps[2]!.detail, /Parece não ter .*estimativa local/);
    assert.ok(!asked.some(h => EXTERNAL.includes(h)));
    // Com a ponte (ou a pedido): aí sim o teste real.
    const real = await runLanCheck(NET, { storageMB: 512, dataDir: dir, external: true }, deps);
    assert.deepEqual(EXTERNAL.filter(h => asked.includes(h)), EXTERNAL);
    assert.equal(real.internet, true);
    assert.equal(real.steps[2]!.detail, 'Tem · fica desligada para o ponto');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ponto sem a ponte nunca consulta fora da rede; o teste real só roda a pedido ou com a ponte ligada, e só ele libera a ponte', async t => {
  const { LunesRpc } = await import('../../mobile/src/lib/lunesRpc');
  const { fakeConnect, substrate } = await import('../../piu-node/test/lunes-fake.js');
  const { connect } = fakeConnect(substrate({ finalized: 1000, storage: {} }).handle);
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-bridge-'));
  const asked: string[] = [];
  const svc = new GuardianService({
    dir, hostname: 'mac-do-lucas', onState: () => {}, dataKey: async () => Buffer.alloc(32, 7),
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1' }, tickMs: 3_600_000, watchMs: 3_600_000,
    net: { ifaces: () => ({}) as never }, check: { beacons: async () => 2, probe: async h => { asked.push(h); return h === '1.1.1.1' ? 'open' : 'none'; }, freeBytes: async () => 50 * 2 ** 30 },
    // Lunes falsa: a ponte do teste não fala com ninguém de verdade.
    gatewayRpc: () => new LunesRpc({ endpoints: ['ws://lunes-falsa'], connect, timeoutMs: 2000 }),
  });
  (svc as unknown as { network: () => Promise<GuardianNetwork> }).network = async () => ({ ...NET, address: '127.0.0.1' });
  t.after(async () => { await svc.close(); rmSync(dir, { recursive: true, force: true }); });
  const external = () => asked.filter(h => EXTERNAL.includes(h)).length;
  await svc.init();
  const first = await svc.test();
  assert.equal(external(), 0, 'abrir a tela e testar a rede: nada externo');
  assert.equal(first.internet, false);
  await assert.rejects(svc.activate({ name: 'Piu · Casa', level: 'guardian', gateway: true }), /internet/, 'estimativa local não libera a ponte');
  await svc.activate({ name: 'Piu · Casa', level: 'guardian', storageMB: 256, days: 3, gateway: false, autoStart: true });
  await svc.test();
  await svc.watch();
  assert.equal(external(), 0, 'ponto ligado sem a ponte: nada externo');
  await assert.rejects(svc.update({ gateway: true }), /internet/);
  // A pessoa liga a ponte: só agora o teste real.
  assert.equal(await svc.testInternet(), true);
  assert.equal(external(), 2, 'uma conexão com 1.1.1.1 e outra com 9.9.9.9');
  assert.equal((await svc.update({ gateway: true })).point!.gateway, true);
  // Com a ponte ligada, o teste da rede inclui o teste real.
  asked.length = 0;
  const withBridge = await svc.test();
  assert.equal(external(), 2);
  assert.equal(withBridge.internet, true);
  // "Testar de novo" do aviso de isolamento só olha a rede local: nada externo, mesmo com a ponte ligada.
  asked.length = 0;
  (svc as unknown as { status: string }).status = 'isolating';
  await svc.test();
  assert.equal(external(), 0, 'reteste do isolamento não consulta fora da rede');
  assert.equal(svc.state().status, 'active', 'os aparelhos voltaram a se ver: sai do aviso');
  await svc.update({ gateway: false });
  assert.equal((await svc.update({ gateway: true })).point!.gateway, true, 'a internet confirmada antes continua valendo');
});

test('arquivo dos envelopes guardados: ida e volta; lixo no fim não quebra', () => {
  // Chegada múltipla do dia e vencimento múltiplo da hora: é como o disco guarda (sealed.packRecords).
  const recs = [{ bytes: new Uint8Array([1, 2, 3]), from: 'abcd', storedAt: 86400, dropAt: 90000, sentTo: ['x'], copies: 1, salt: '00112233445566778899aabbccddeeff' }];
  const back = unpackRecords(Buffer.concat([packRecords(recs), Buffer.from([0, 0, 9])]));
  assert.deepEqual(back, recs);
});

test('isolamento: só quando vários aparelhos caíram juntos e ninguém voltou', () => {
  const now = 1_000_000;
  assert.equal(isolationSuspected({ peersNow: 0, peersEver: 3, lastDrops: [now - 60_000, now - 50_000] }, now), true);
  assert.equal(isolationSuspected({ peersNow: 1, peersEver: 3, lastDrops: [now - 60_000, now - 50_000] }, now), false);
  assert.equal(isolationSuspected({ peersNow: 0, peersEver: 1, lastDrops: [now - 60_000] }, now), false);
  assert.equal(isolationSuspected({ peersNow: 0, peersEver: 3, lastDrops: [now - 600_000, now - 50_000] }, now), false, 'saíram aos poucos');
});

/** Serviço com o ponto ligado em 127.0.0.1 (porta livre, sem descoberta), rede e teste falsos, cofre falso. */
async function service(dir: string, o: { key?: Buffer | null; net?: GuardianNetwork } = {}) {
  const states: GuardianState[] = [];
  let net = o.net ?? { ...NET, address: '127.0.0.1' };
  const svc = new GuardianService({
    dir, hostname: 'mac-do-lucas', onState: s => states.push(s), dataKey: async () => (o.key === undefined ? Buffer.alloc(32, 7) : o.key),
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1' }, tickMs: 100, watchMs: 3_600_000,
    net: { ifaces: () => ({}) as never }, check: { beacons: async () => 2, probe: async h => (h === '1.1.1.1' ? 'open' : 'none'), freeBytes: async () => 50 * 2 ** 30 },
  });
  // A rede vem do teste (não do computador que roda os testes).
  (svc as unknown as { network: () => Promise<GuardianNetwork> }).network = async () => net;
  await svc.init();
  return { svc, states, setNet: (n: GuardianNetwork) => { net = n; } };
}

test('guardião de verdade: guarda o envelope de um celular e entrega a outro que chega depois; recibo e contagens reais', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-'));
  const { svc } = await service(dir);
  const phones: LnnpLanTransport[] = [];
  t.after(async () => { await Promise.all(phones.map(p => p.stop())); await svc.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(svc.state().status, 'off');
  const test1 = await svc.test();
  assert.equal(test1.verdict, 'ok');
  const s = await svc.activate({ name: 'Piu · Escritório Lima', level: 'guardian', storageMB: 512, days: 7, gateway: false, autoStart: true });
  assert.equal(s.status, 'active');
  assert.match(s.point!.id, /^[0-9a-f]{16}$/);
  assert.equal(s.point!.qr, null, 'sem senha digitada, sem QR');
  const port = (svc as unknown as { node: { o: { transport: LnnpLanTransport } } }).node.o.transport.port;
  assert.ok(port > 0);

  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  const env = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('oi pela malha'), now: Math.floor(Date.now() / 1000) });
  // Celular A entra, entrega a carta e sai.
  const a = new LnnpLanTransport({ node: deriveNodeKey(newSeed()), port: 0, discoveryPort: null, listen: '127.0.0.1', peers: [`127.0.0.1:${port}`] });
  phones.push(a);
  const aPeers: string[] = [];
  a.subscribe(e => { if (e.type === 'connected') aPeers.push(e.id); });
  await a.start();
  await until(() => aPeers.length === 1, 'A conectar ao ponto');
  await a.send(aPeers[0]!, env.bytes);
  await until(() => svc.state().stats!.stored === 1, 'ponto guardar o envelope');
  await a.stop();
  // Celular B chega depois e recebe.
  const b = new LnnpLanTransport({ node: deriveNodeKey(newSeed()), port: 0, discoveryPort: null, listen: '127.0.0.1', peers: [`127.0.0.1:${port}`] });
  phones.push(b);
  const got: Uint8Array[] = [];
  b.subscribe(e => { if (e.type === 'envelope') got.push(e.data); });
  await b.start();
  await until(() => got.length === 1, 'B receber do ponto');
  const opened = openDirect(got[0]!, bob, Math.floor(Date.now() / 1000));
  assert.ok(opened, 'B abre a carta (o ponto só repassou os bytes cifrados)');
  const st = svc.state().stats!;
  assert.equal(st.forwarded, 1);
  assert.equal(st.receipts, 1, 'recibo de repasse assinado pela chave do ponto');
  assert.equal(st.peersToday, 2, 'dois aparelhos hoje (só a contagem)');
  assert.ok(st.bytesToday >= env.bytes.length * 2);
  assert.ok(st.storedBytes > 0 && st.maxBytes === 512 * 2 ** 20);
  assert.equal(st.gatewayOnline, null);
  // Nada de id de aparelho no estado que vai à interface.
  const json = JSON.stringify(svc.state());
  assert.equal(aPeers[0], svc.state().point!.id, 'o celular vê o id do PONTO (chave própria)');
  for (const p of [a.nodeId, b.nodeId]) assert.ok(!json.includes(p), 'id dos aparelhos não aparece');
});

test('pausar, QR com a senha digitada, rede caiu/mudou e encerrar (apaga chave e envelopes)', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-end-'));
  const { svc, setNet } = await service(dir);
  t.after(async () => { await svc.close(); rmSync(dir, { recursive: true, force: true }); });
  await svc.test();
  await svc.activate({ name: 'Piu · Casa', level: 'guardian', storageMB: 256, days: 3, gateway: false, autoStart: true });
  assert.throws(() => svc.setWifi({ password: '123' }), /8 caracteres/);
  const q = svc.setWifi({ password: 'senha;forte', open: false });
  assert.equal(q.point!.qr, 'WIFI:T:WPA;S:Escritório-Wi-Fi;P:senha\\;forte;;');
  assert.equal(q.point!.wifi.set, true);
  // Arquivo do ponto cifrado: nem a senha nem a semente aparecem em claro.
  const raw = readFileSync(join(dir, 'point.bin'));
  assert.ok(!raw.includes(Buffer.from('senha;forte')) && !raw.includes(Buffer.from('Piu · Casa')));
  assert.equal((await svc.pause(true)).status, 'paused');
  assert.equal((await svc.pause(false)).status, 'active');
  // E5b: a rede caiu → para; voltou → liga sozinho.
  setNet({ ...NET, up: false, cidr: null, ssid: null, label: 'Sem rede local' });
  await svc.watch();
  assert.equal(svc.state().status, 'down');
  assert.match(svc.state().reason!, /Escritório-Wi-Fi caiu/);
  setNet({ ...NET, address: '127.0.0.1' });
  await svc.watch();
  assert.equal(svc.state().status, 'active');
  // Outra rede: pergunta antes de continuar.
  setNet({ ...NET, ssid: 'Vizinho', label: 'Vizinho', cidr: '10.0.0.0/24', address: '127.0.0.1' });
  await svc.watch();
  assert.equal(svc.state().status, 'changed');
  const adopted = await svc.adoptNetwork();
  assert.equal(adopted.status, 'active');
  assert.equal(adopted.point!.network.ssid, 'Vizinho');
  assert.equal(adopted.point!.qr, null, 'a senha era da rede antiga');
  await svc.pause(true);
  assert.ok(existsSync(join(dir, 'point.bin')));
  const end = await svc.end();
  assert.equal(end.status, 'off');
  assert.equal(end.point, null);
  assert.ok(!existsSync(join(dir, 'point.bin')) && !existsSync(join(dir, 'store.bin')), 'chave e envelopes apagados');
  // Reabrir: não há ponto.
  const again = await service(dir);
  t.after(() => again.svc.close());
  assert.equal(again.svc.state().point, null);
});

test('sem cofre do sistema o ponto não ativa; "Guardião + app" sem APK conferido fica de fora com o motivo; gateway só com internet', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-nokey-'));
  const { svc } = await service(dir, { key: null });
  t.after(async () => { await svc.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(svc.state().canStore, false);
  await assert.rejects(svc.activate({ name: 'x', level: 'guardian' }), /cofre/);
  const dir2 = mkdtempSync(join(tmpdir(), 'piu-guardian-apk-'));
  const s2 = await service(dir2);
  t.after(async () => { await s2.svc.close(); rmSync(dir2, { recursive: true, force: true }); });
  assert.equal(s2.svc.state().apk.available, false);
  assert.match(s2.svc.state().apk.reason, /conferido/);
  await assert.rejects(s2.svc.activate({ name: 'x', level: 'guardian-app' }), /conferido/);
  await assert.rejects(s2.svc.activate({ name: 'x', level: 'guardian', gateway: true }), /internet/, 'sem teste com internet');
  // Reabrir com o ponto salvo e "manter ativo": liga sozinho, com os mesmos números.
  await s2.svc.test();
  const on = await s2.svc.activate({ name: 'Piu · Reabre', level: 'multiplier', autoStart: true });
  assert.equal(on.stats!.maxBytes, 16 * 2 ** 20, 'multiplicador: só um buffer em memória');
  await s2.svc.close();
  const s3 = await service(dir2);
  t.after(() => s3.svc.close());
  assert.equal(s3.svc.state().status, 'active');
  assert.equal(s3.svc.state().point!.name, 'Piu · Reabre');
  assert.equal(s3.svc.state().point!.id, on.point!.id, 'mesma chave do ponto depois de reabrir');
});

test('gateway do ponto (com internet): carga de transação → Lunes falsa → recibo volta ao celular pela LAN', async t => {
  const { CarryChain, CarryKind, openCarryReceipt, returnIdentity, sealCarry } = await import('../../mobile/src/protocol/carry');
  const { buildTransferKeepAlive, IMMORTAL_PERIOD } = await import('../../mobile/src/lib/extrinsic');
  const { LunesRpc } = await import('../../mobile/src/lib/lunesRpc');
  const { withWalletKey } = await import('../../mobile/src/lib/walletKey');
  const { ALICE_57, fakeConnect, substrate } = await import('../../piu-node/test/lunes-fake.js');
  const { DEV_MNEMONIC } = await import('../../piu-node/test/wallet-fixture.js');
  const { GuardianNode } = await import('../src/main/guardian/guardianNode');
  const GENESIS = '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac';
  const fake = substrate({ finalized: 1000, storage: {} });
  const { connect } = fakeConnect(fake.handle);
  const key = pointKey(newSeed());
  const lan = new LnnpLanTransport({ node: key, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null });
  const node = new GuardianNode({ key, transport: lan, limits: { maxBytes: 16 * 2 ** 20, retentionSec: 3600 }, tickMs: 100,
    gateway: { rpc: () => new LunesRpc({ endpoints: ['ws://lunes-falsa'], connect, timeoutMs: 2000 }), probeMs: 100, tickMs: 100 } });
  await node.start();
  const phone = new LnnpLanTransport({ node: deriveNodeKey(newSeed()), listen: '127.0.0.1', port: 0, discoveryPort: null, peers: [`127.0.0.1:${lan.port}`] });
  const got: Uint8Array[] = []; let peer = '';
  phone.subscribe(e => { if (e.type === 'envelope') got.push(e.data); if (e.type === 'connected') peer = e.id; });
  await phone.start();
  t.after(async () => { await phone.stop(); await node.stop(); });
  await until(() => !!peer && node.gatewayOnline === true, 'enlace e Lunes alcançável');
  const tx = withWalletKey(DEV_MNEMONIC.split(' '), k => buildTransferKeepAlive(k, { dest: ALICE_57, value: 100_000_000n,
    ctx: { specVersion: 107, transactionVersion: 2, genesisHash: GENESIS, blockHash: GENESIS, blockNumber: 1000, nonce: 3, tip: 0n, period: IMMORTAL_PERIOD } }));
  const c = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: tx.extrinsic }, now: Math.floor(Date.now() / 1000) });
  await phone.send(peer, c.bytes);
  await until(() => fake.submitted.length === 1, 'ponto enviar à Lunes');
  assert.equal(fake.submitted[0], tx.hex, 'os mesmos bytes assinados no celular');
  const me = returnIdentity(c.returnSeed);
  await until(() => got.some(b => openCarryReceipt(b, me, Math.floor(Date.now() / 1000))?.status === 'pool'), 'recibo "pool" voltar ao celular');
  assert.equal(node.gatewaySent, 1);
  assert.equal(node.stats().stored, 1, 'só o recibo (para o celular) ficou guardado; a carga não');
});

test('ponto: envelopes vencidos descartados ao religar saem do store.bin na hora (não ficam no disco)', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-guardian-purge-'));
  let nowMs = Date.now();
  const svc = new GuardianService({
    dir, hostname: 'mac-do-lucas', onState: () => {}, dataKey: async () => Buffer.alloc(32, 7), now: () => nowMs,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1' }, tickMs: 3_600_000, watchMs: 3_600_000,
    net: { ifaces: () => ({}) as never }, check: { beacons: async () => 2, probe: async h => (h === '1.1.1.1' ? 'open' : 'none'), freeBytes: async () => 50 * 2 ** 30 },
  });
  let net: GuardianNetwork = { ...NET, address: '127.0.0.1' };
  (svc as unknown as { network: () => Promise<GuardianNetwork> }).network = async () => net;
  t.after(async () => { await svc.close(); rmSync(dir, { recursive: true, force: true }); });
  await svc.init();
  await svc.test();
  await svc.activate({ name: 'Piu · Casa', level: 'guardian', storageMB: 256, days: 1, gateway: false, autoStart: true });
  const alice = deriveIdentity(newSeed(), 'public'), bob = deriveIdentity(newSeed(), 'public');
  const env = sealDirect({ from: alice, to: toPublic(bob), type: MsgType.Text, body: utf8('vence'), now: Math.floor(nowMs / 1000) });
  (svc as unknown as { node: { receive: (f: string, d: Uint8Array) => void } }).node.receive('a1b2c3d4e5f60718', env.bytes);
  // A rede cai (o ponto para e grava) e volta depois do prazo: o vigia religa sozinho.
  net = { ...NET, up: false, cidr: null, ssid: null, label: 'Sem rede local' };
  await svc.watch();
  const full = readFileSync(join(dir, 'store.bin')).length;
  nowMs += 2 * 86400_000; // passou do prazo de 1 dia
  net = { ...NET, address: '127.0.0.1' };
  await svc.watch();
  assert.equal(svc.state().status, 'active');
  assert.ok(readFileSync(join(dir, 'store.bin')).length < full, 'store.bin regravado sem o vencido');
});
