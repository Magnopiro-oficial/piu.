/// <reference types="node" />
/**
 * Ponto Piu (docs/rede/pontos-piu-roteadores.md, fase 2; design "Piu 13", P1–P9): níveis e limites,
 * chave do ponto, teste de compatibilidade → verde/amarelo/vermelho, QR de Wi-Fi, visitante, painel.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivePhoneOperatorKey } from '../../protocol/phoneNode';
import { deriveIdentity, deriveNodeKey, newSeed } from '../../protocol/keys';
import { toHex } from '../../protocol/bytes';
import { MAX_TTL_SEC } from '../../protocol/envelope';
import { classifyLanCheck, type LanCheckInputs } from '../../transport/lan/lanCheck';
import {
  accumulateStats, DAYS_STEPS, DEFAULT_DAYS, DEFAULT_SPACE_MB, SPACE_STEPS_MB, emptyStats, groupId, isolationOnset, isPiuSsid, looksSeparated, mergePolicy, NO_POINT, nearbyList, parseWifiQr,
  pointCheckView, pointHealth, pointName, pointRuntime, pointWifiQr, proofsSince, reviveConfig, seenKey, shouldNotifyPoint, signalBars, stepDays, stepSpace,
  validWpaPassword, type PointConfig,
} from '../pointCore';
import { derivePointKey, newPointSecret, pointIdOf, POINT_KEY_LABEL } from '../pointKey';

const cfg = (o: Partial<PointConfig> = {}): PointConfig => ({
  v: 1, id: '0123456789abcdef', name: 'Piu · Padaria do Zé', level: 'guardian', spaceMb: DEFAULT_SPACE_MB, days: DEFAULT_DAYS, createdAt: 1, paused: false,
  network: { kind: 'wifi', ssid: 'Casa-Visitantes', security: 'WPA', password: null, separated: true }, ...o,
});

// ---------- chave do ponto ----------

test('chave do ponto: rótulo próprio, determinística pelo segredo, sem ligação com identidades/nó/operador', () => {
  const s = newPointSecret();
  const a = derivePointKey(s), b = derivePointKey(s);
  assert.deepEqual(a.pk, b.pk);
  assert.equal(POINT_KEY_LABEL, 'piu/point/v1/sign');
  assert.notDeepEqual(derivePointKey(newPointSecret()).pk, a.pk, 'outro segredo, outra chave');
  // Mesmo usando a semente do Piu como segredo, a chave do ponto não coincide com nenhuma outra (rótulo próprio).
  const seed = newSeed();
  const p = derivePointKey(seed).pk;
  for (const other of [derivePhoneOperatorKey(seed).pk, deriveNodeKey(seed, 0).pk, deriveIdentity(seed, 'public').signPk, deriveIdentity(seed, 'anon').signPk]) assert.notEqual(toHex(other), toHex(p));
  assert.match(pointIdOf(a.pk), /^[0-9a-f]{16}$/);
  assert.throws(() => derivePointKey(new Uint8Array(16)));
});

// ---------- níveis e limites ----------

test('níveis: multiplicador não guarda; guardião guarda com os limites do ponto; app serve a página; gateway só no nível dele', () => {
  assert.deepEqual(pointRuntime(null), NO_POINT);
  assert.deepEqual(pointRuntime(cfg({ paused: true })), NO_POINT, 'pausado não atende ninguém');
  const m = pointRuntime(cfg({ level: 'multiplier' }));
  assert.ok(m.active && !m.relay && m.maxBytes === null && !m.serveApp && !m.gateway && m.background);
  const g = pointRuntime(cfg({ level: 'guardian', spaceMb: 2048, days: 14 }));
  assert.ok(g.relay && !g.serveApp && !g.gateway);
  assert.equal(g.maxBytes, 2048 * 1024 * 1024);
  assert.equal(g.retentionSec, 14 * 86400);
  assert.ok(pointRuntime(cfg({ level: 'guardianApp' })).serveApp);
  assert.ok(pointRuntime(cfg({ level: 'gateway' })).gateway);
});

test('política: o ponto só aumenta os limites escolhidos no modo nó', () => {
  const base = { maxBytes: 512 * 1024 * 1024, retentionSec: 48 * 3600 };
  assert.deepEqual(mergePolicy(base, NO_POINT), base);
  assert.deepEqual(mergePolicy(base, pointRuntime(cfg({ spaceMb: 256, days: 1 }))), { maxBytes: base.maxBytes, retentionSec: 48 * 3600 });
  assert.deepEqual(mergePolicy(base, pointRuntime(cfg({ spaceMb: 1024, days: 7 }))), { maxBytes: 1024 * 1024 * 1024, retentionSec: 7 * 86400 });
});

test('passos do − / + (P5): espaço e dias, com teto e piso', () => {
  assert.equal(stepSpace(512, 1), 1024);
  assert.equal(stepSpace(512, -1), 256);
  assert.equal(stepSpace(1024, 1), 1024);
  assert.equal(stepSpace(256, -1), 256);
  assert.equal(stepSpace(700, 1), 1024, 'valor fora da lista vai para o próximo passo');
  assert.equal(stepSpace(700, -1), 512);
  assert.equal(stepDays(3, 1), 7);
  assert.equal(stepDays(1, -1), 1);
  assert.equal(stepDays(7, 1), 7);
});

test('regra única: até 1 GB e até a validade máxima do envelope (7 dias); padrão 512 MB · 7 dias', () => {
  assert.equal(Math.max(...SPACE_STEPS_MB), 1024);
  assert.equal(Math.max(...DAYS_STEPS) * 86_400, MAX_TTL_SEC);
  assert.equal(DEFAULT_SPACE_MB, 512);
  assert.equal(DEFAULT_DAYS, 7);
  const old = reviveConfig({ ...cfg(), spaceMb: 4096, days: 30 })!;
  assert.deepEqual([old.spaceMb, old.days], [DEFAULT_SPACE_MB, DEFAULT_DAYS], 'ponto salvo com 4 GB · 30 dias volta ao padrão');
});

test('configuração salva: valida e corrige; hotspot é sempre separado; senha só válida', () => {
  assert.equal(reviveConfig(null), null);
  assert.equal(reviveConfig({ ...cfg(), id: 'xx' }), null);
  assert.equal(reviveConfig({ ...cfg(), level: 'outro' }), null);
  const r = reviveConfig({ ...cfg(), spaceMb: 3, days: 99, network: { kind: 'hotspot', ssid: 'AndroidShare_1', security: 'WPA', password: 'curta', separated: false } })!;
  assert.equal(r.spaceMb, DEFAULT_SPACE_MB);
  assert.equal(r.days, DEFAULT_DAYS);
  assert.equal(r.network.separated, true);
  assert.equal(r.network.password, null, 'senha WPA com menos de 8 caracteres não entra');
});

test('nome do ponto: prefixo "Piu · " uma vez só, sem quebras, com reserva', () => {
  assert.equal(pointName('Padaria do Zé', 'x'), 'Piu · Padaria do Zé');
  assert.equal(pointName('Piu · Padaria', 'x'), 'Piu · Padaria');
  assert.equal(pointName('piu - Praça\nCentral', 'x'), 'Piu · Praça Central');
  assert.equal(pointName('   ', 'Casa-Visitantes'), 'Piu · Casa-Visitantes');
});

// ---------- teste de compatibilidade (P4) ----------

const inputs = (o: Partial<LanCheckInputs> = {}): LanCheckInputs => ({
  wifi: { connected: true, internet: false, ip: '192.168.0.20', prefix: 24, gateway: '192.168.0.1' }, lanRunning: true,
  seen: { broadcast: 2, mdns: 0, scan: 0, links: 1 }, gatewayAdmin: ['timeout', 'timeout'], otherLans: {}, knownPeer: null, ...o,
});

test('P4a verde: rede separada, aparelhos se veem, casa protegida, sem página do roteador', () => {
  const v = pointCheckView(classifyLanCheck(inputs()), { separated: true, hotspot: false });
  assert.equal(v.verdict, 'green');
  assert.ok(!v.blocks);
  assert.deepEqual(v.rows.map(r => [r.key, r.state]), [['peers', 'ok'], ['home', 'ok'], ['internet', 'ok'], ['capacity', 'ok']]);
  assert.equal(v.peers, 3);
  assert.equal(v.rows.find(r => r.key === 'capacity')!.count, 254);
});

test('P4b amarelo: página do roteador abre (comum em casa) e isolamento entre visitantes — segue com instrução', () => {
  const admin = pointCheckView(classifyLanCheck(inputs({ gatewayAdmin: ['open', 'refused'] })), { separated: true, hotspot: false });
  assert.equal(admin.verdict, 'yellow');
  assert.ok(!admin.blocks, 'roteador respondendo sozinho não bloqueia');
  assert.ok(admin.rows.some(r => r.key === 'routerAdmin' && r.state === 'warn'));
  const iso = pointCheckView(classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 }, gatewayAdmin: ['open'], knownPeer: { probe: 'timeout', discovered: false } })), { separated: true, hotspot: false });
  assert.equal(iso.verdict, 'yellow', 'design P4b: isolamento é amarelo ("Continuar assim")');
  assert.ok(iso.rows.some(r => r.key === 'isolation' && r.state === 'warn'));
  const none = pointCheckView(classifyLanCheck(inputs({ seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 } })), { separated: true, hotspot: false });
  assert.equal(none.verdict, 'yellow', 'ninguém respondeu: não dá para confirmar, mas não bloqueia');
});

test('P4c vermelho bloqueia: aparelhos da casa alcançáveis numa rede marcada como separada, ou rede da casa', () => {
  const exposed = pointCheckView(classifyLanCheck(inputs({ otherLans: { '192.168.1.1': 'open', '10.0.0.1': 'timeout' } })), { separated: true, hotspot: false });
  assert.equal(exposed.verdict, 'red');
  assert.ok(exposed.blocks);
  assert.ok(exposed.rows.some(r => r.key === 'home' && r.state === 'bad' && r.count === 1));
  const home = pointCheckView(classifyLanCheck(inputs()), { separated: false, hotspot: false });
  assert.equal(home.verdict, 'red', 'rede principal da casa: visitantes veriam os aparelhos');
  assert.ok(home.rows.some(r => r.key === 'homeNetwork'));
  const noWifi = pointCheckView(classifyLanCheck(inputs({ wifi: { connected: false, internet: false, ip: null, prefix: null, gateway: null } })), { separated: true, hotspot: false });
  assert.ok(noWifi.blocks);
});

test('hotspot deste celular: separado por construção (ignora a página do "roteador", que é ele mesmo)', () => {
  const v = pointCheckView(classifyLanCheck(inputs({ gatewayAdmin: ['refused'] })), { separated: false, hotspot: true });
  assert.ok(!v.blocks);
  assert.ok(!v.rows.some(r => r.key === 'routerAdmin' || r.key === 'homeNetwork'));
});

test('pré-marcar "rede de visitante" pelo nome (o dono confirma)', () => {
  assert.ok(looksSeparated('Casa-Visitantes'));
  assert.ok(looksSeparated('Loja Guest'));
  assert.ok(looksSeparated('Piu · Praça'));
  assert.ok(!looksSeparated('Casa-5G'));
  assert.ok(!looksSeparated(null));
});

// ---------- QR ----------

test('QR de Wi-Fi padrão: WPA com senha digitada, sem senha (câmera pede), aberta; escape; nunca senha curta', () => {
  assert.equal(pointWifiQr({ ssid: 'Casa-Visitantes', security: 'WPA', password: 'abcd1234' }), 'WIFI:T:WPA;S:Casa-Visitantes;P:abcd1234;;');
  assert.equal(pointWifiQr({ ssid: 'Casa-Visitantes', security: 'WPA', password: null }), 'WIFI:T:WPA;S:Casa-Visitantes;;');
  assert.equal(pointWifiQr({ ssid: 'Padaria do Zé', security: 'nopass', password: 'ignorada' }), 'WIFI:T:nopass;S:Padaria do Zé;;');
  assert.equal(pointWifiQr({ ssid: 'a;b:c', security: 'WPA', password: 'p\\"x,;12' }), 'WIFI:T:WPA;S:a\\;b\\:c;P:p\\\\\\"x\\,\\;12;;');
  assert.throws(() => pointWifiQr({ ssid: '', security: 'nopass', password: null }));
  assert.ok(validWpaPassword('12345678') && !validWpaPassword('1234567') && !validWpaPassword('x'.repeat(64)));
});

test('QR lido de volta (visitante): campos, escape e ordem qualquer', () => {
  for (const n of [{ ssid: 'a;b:c', security: 'WPA' as const, password: 'p\\"x,;12' }, { ssid: 'Padaria do Zé', security: 'nopass' as const, password: null }]) {
    assert.deepEqual(parseWifiQr(pointWifiQr(n)), n);
  }
  assert.deepEqual(parseWifiQr('WIFI:S:Piu · Praça;T:WPA;P:segredo12;H:false;;'), { ssid: 'Piu · Praça', security: 'WPA', password: 'segredo12' });
  assert.equal(parseWifiQr('piu://invite/accept?c=x'), null);
  assert.equal(parseWifiQr('WIFI:T:WPA;;'), null);
});

test('rede com nome de ponto Piu', () => {
  assert.ok(isPiuSsid('Piu · Padaria do Zé'));
  assert.ok(isPiuSsid('piu - praça'));
  assert.ok(!isPiuSsid('Piupiu'));
  assert.ok(!isPiuSsid('Casa'));
});

// ---------- redes por perto ----------

test('P3: redes por perto sem a atual, uma por nome (a mais forte), pontos Piu primeiro; barras pelo dBm', () => {
  const l = nearbyList([
    { ssid: 'Casa-5G', level: -40, secure: true }, { ssid: 'Padaria do Zé', level: -80, secure: false }, { ssid: 'Padaria do Zé', level: -60, secure: false },
    { ssid: '', level: -30, secure: false }, { ssid: 'Piu · Praça', level: -85, secure: false }, { ssid: 'Casa-Visitantes', level: -50, secure: true },
  ], 'Casa-5G');
  assert.deepEqual(l.map(n => [n.ssid, n.level]), [['Piu · Praça', -85], ['Casa-Visitantes', -50], ['Padaria do Zé', -60]]);
  assert.deepEqual([-50, -60, -70, -90].map(signalBars), [3, 2, 1, 0]);
});

// ---------- visitante ----------

test('P8n: uma notificação por ponto por dia; registro curto', () => {
  const day = 86_400_000;
  let r = shouldNotifyPoint({}, 'Piu · Praça', 1000);
  assert.ok(r.notify);
  r = shouldNotifyPoint(r.log, 'Piu · Praça', 1000 + day - 1);
  assert.ok(!r.notify, 'mesmo ponto, mesmo dia');
  assert.ok(shouldNotifyPoint(r.log, 'Piu · Outro', 2000).notify, 'outro ponto avisa');
  assert.ok(shouldNotifyPoint(r.log, 'Piu · Praça', 1000 + day).notify, 'no dia seguinte avisa de novo');
  const old = shouldNotifyPoint({ velho: 0 }, 'x', 3 * day);
  assert.ok(!('velho' in old.log), 'registros antigos saem');
});

// ---------- painel ----------

test('P7: contagens reais — vizinhos distintos do dia (sem guardar ids), repassadas somando o contador diário', () => {
  let s = emptyStats(100);
  s = accumulateStats(s, { day: 100, peerIds: ['a', 'b'], relayedToday: 5 });
  s = accumulateStats(s, { day: 100, peerIds: ['a', 'c'], relayedToday: 9 });
  assert.equal(s.seenToday.length, 3);
  assert.ok(!s.seenToday.includes('a'), 'só o resumo do id');
  assert.equal(s.relayed, 9);
  s = accumulateStats(s, { day: 101, peerIds: ['a'], relayedToday: 2 });
  assert.equal(s.seenToday.length, 1, 'virou o dia: contagem nova');
  assert.equal(s.relayed, 11);
  s = accumulateStats(s, { day: 101, peerIds: [], relayedToday: 1 });
  assert.equal(s.relayed, 11, 'contador que voltou (mensageiro reiniciou) não desconta');
  s = accumulateStats(s, { day: 101, peerIds: [], relayedToday: null });
  assert.equal(s.relayed, 11, 'sem mensageiro: nada muda');
  assert.notEqual(seenKey('a', 1), seenKey('a', 2), 'o mesmo aparelho não se liga entre dias');
});

test('P7: entregas comprovadas desde a ativação (com prova; recusadas e antigas fora)', () => {
  const since = 1_000_000 * 1000;
  const n = proofsSince([
    { at: 1_000_010, state: 'validado' }, { at: 1_000_020, state: 'pendente', sealed: ['ab'] }, { at: 1_000_030, state: 'pendente' },
    { at: 1_000_040, state: 'rejeitado', proof: 'x' }, { at: 999_999, state: 'validado' },
  ], since);
  assert.equal(n, 2);
});

test('P7c: isolamento só quando 2+ vizinhos somem de uma vez, na mesma rede, com o roteador vivo e sem resposta direta', () => {
  const prev = { ip: '10.0.0.5', linked: ['10.0.0.6', '10.0.0.7'], routerUp: true, redial: [] };
  assert.ok(isolationOnset(prev, { ip: '10.0.0.5', linked: [], routerUp: true, redial: ['timeout', 'unreachable'] }));
  assert.ok(!isolationOnset(prev, { ip: '10.0.0.5', linked: [], routerUp: true, redial: ['timeout', 'open'] }), 'um respondeu: não é isolamento');
  assert.ok(!isolationOnset(prev, { ip: '10.0.0.9', linked: [], routerUp: true, redial: ['timeout'] }), 'outra rede');
  assert.ok(!isolationOnset(prev, { ip: '10.0.0.5', linked: [], routerUp: false, redial: ['timeout'] }), 'roteador caiu: é a rede, não isolamento');
  assert.ok(!isolationOnset({ ...prev, linked: ['10.0.0.6'] }, { ip: '10.0.0.5', linked: [], routerUp: true, redial: ['timeout'] }), 'um só saindo é gente indo embora');
  assert.ok(!isolationOnset(null, { ip: '10.0.0.5', linked: [], routerUp: true, redial: ['timeout'] }));
});

test('P7a–b: pausado, rede caiu (Wi-Fi ou hotspot), isolando', () => {
  assert.equal(pointHealth(cfg({ paused: true }), { wifiUp: false, hotspotUp: false, isolating: true }), 'paused');
  assert.equal(pointHealth(cfg(), { wifiUp: false, hotspotUp: true, isolating: false }), 'netDown');
  assert.equal(pointHealth(cfg({ network: { ...cfg().network, kind: 'hotspot' } }), { wifiUp: true, hotspotUp: false, isolating: false }), 'netDown');
  assert.equal(pointHealth(cfg(), { wifiUp: true, hotspotUp: false, isolating: true }), 'isolating');
  assert.equal(pointHealth(cfg(), { wifiUp: true, hotspotUp: false, isolating: false }), 'ok');
  assert.equal(groupId('0123456789abcdef'), '0123 4567 89AB CDEF');
});
