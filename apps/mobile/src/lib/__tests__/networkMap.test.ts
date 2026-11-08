/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Peer } from '../../transport/types';
import {
  addLoraStep, applyFilters, bearingDir, connectChannel, connectSteps, distanceText, farMissing, filterCounts, gainedCount, isOnline, labelAbove,
  layoutPoints, listGroups, mapMode, mapSummary, peerPoints, placeDistance, pointA11y, polar, radarRadius, ringsFor, signalOf, sortByDistance,
  STALE_MS, superNodePoints, toggleFilter, trackPoints, visiblePoints, wifiDistance, wifiPhase, wifiPoints, type MapPoint,
} from '../networkMap';

const NOW = 1_800_000_000_000;
const pt = (p: Partial<MapPoint> & { id: string }): MapPoint => ({
  name: p.id, kind: 'pessoa', channels: ['ble'], distM: null, distBy: null, bearing: null, inRange: true, connected: false,
  signal: null, hops: null, reachedVia: null, lastSeen: NOW, why: 'announces', connectable: false, ...p,
});
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ── escala do radar ──────────────────────────────────────

test('escala log: 10 m no anel de dentro (0,26), 10 km na borda (0,96), 1 km a 2/3 do caminho', () => {
  close(radarRadius(10), 0.26);
  close(radarRadius(100), 0.26 + 0.7 / 3);
  close(radarRadius(1000), 0.26 + 1.4 / 3);
  close(radarRadius(10_000), 0.96);
  // Fora da escala fica preso nas pontas (nunca sai do radar nem cai no "você").
  close(radarRadius(2), 0.26);
  close(radarRadius(50_000), 0.96);
});

test('posição pelo rumo: 0° = norte (em cima), 90° = leste, 180° = sul', () => {
  const n = polar(0.5, 0), e = polar(0.5, 90), s = polar(0.5, 180), w = polar(0.5, 270);
  close(n.x, 50); close(n.y, 25);
  close(e.x, 75); close(e.y, 50);
  close(s.x, 50); close(s.y, 75);
  close(w.x, 25); close(w.y, 50);
});

test('rótulo acima só para ponto a menos de 100 m na metade de cima', () => {
  assert.equal(labelAbove(40, 12), true);
  assert.equal(labelAbove(40, 300), true);
  assert.equal(labelAbove(40, 180), false); // metade de baixo
  assert.equal(labelAbove(120, 12), false); // longe do "você"
  assert.equal(labelAbove(99, 90), false); // na linha do meio: embaixo
});

test('anéis: 30 m, 100 m e 5 km de alcance (5 km só com rádio LoRa); 1 km e 10 km tracejados; rótulos no rumo 162°, o de 10 km sem rótulo', () => {
  const all = ringsFor({ lora: true, offline: false });
  assert.deepEqual(all.map(r => [r.d, r.kind]), [[10_000, 'ref'], [5000, 'reach'], [1000, 'ref'], [100, 'reach'], [30, 'reach']]);
  assert.deepEqual(all.map(r => r.label), [null, '5 km', '1 km', null, null]);
  const one = all.find(r => r.d === 1000)!;
  const at = polar(one.r, 162);
  close(one.lx, at.x); close(one.ly, at.y);
  assert.ok(!ringsFor({ lora: false, offline: false }).some(r => r.d === 5000), 'sem rádio LoRa o anel de 5 km nem aparece');
  // Offline: sem anéis de alcance (nenhum canal ligado), só a referência.
  assert.ok(ringsFor({ lora: true, offline: true }).every(r => r.kind === 'ref'));
});

// ── sem localização ──────────────────────────────────────

test('sem distância: o ponto fica dentro do alcance do canal (Bluetooth < 30 m < Wi-Fi < 100 m < LoRa)', () => {
  const ble = placeDistance(pt({ id: 'a', channels: ['ble'] }));
  const wd = placeDistance(pt({ id: 'b', channels: ['nearby'] }));
  const lan = placeDistance(pt({ id: 'c', channels: ['lan'] }));
  const lora = placeDistance(pt({ id: 'd', channels: ['piulora'] }));
  assert.ok(ble > 10 && ble < 30);
  assert.ok(wd > 30 && wd < 100);
  assert.equal(lan, wd);
  assert.ok(lora > 100 && lora < 5000);
  // Com distância (pelo sinal ou posição), vale ela.
  assert.equal(placeDistance(pt({ id: 'e', distM: 250, distBy: 'signal' })), 250);
});

test('sem rumo: pontos do mesmo anel espalhados por igual; com rumo, na direção real', () => {
  const ps = ['a', 'b', 'c', 'd'].map(id => pt({ id, channels: ['ble'] }));
  const l = layoutPoints(ps);
  const ang = l.map(p => p.angle).sort((a, b) => a - b);
  for (let i = 1; i < ang.length; i++) close(ang[i]! - ang[i - 1]!, 90);
  // Todos no mesmo raio (o anel do Bluetooth).
  assert.ok(l.every(p => Math.abs(p.r - l[0]!.r) < 1e-9));
  // Estável: a mesma entrada dá a mesma posição.
  assert.deepEqual(layoutPoints(ps), l);
  const real = layoutPoints([pt({ id: 'x', distM: 4200, distBy: 'pos', bearing: 12 })])[0]!;
  close(real.angle, 12);
  close(real.r, radarRadius(4200));
});

test('sem rumo: faixas vizinhas intercaladas (o ponto de fora cai no meio do vão da faixa de dentro)', () => {
  const l = layoutPoints([
    pt({ id: 'a', distM: 40, distBy: 'signal' }), pt({ id: 'b', distM: 75, distBy: 'signal' }),
    pt({ id: 'c', distM: 228, distBy: 'signal' }),
  ]);
  const at = (id: string) => l.find(p => p.id === id)!.angle;
  const gap = (x: number, y: number) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
  close(gap(at('a'), at('b')), 180);
  close(Math.min(gap(at('c'), at('a')), gap(at('c'), at('b'))), 90);
});

test('sem rumo: anéis diferentes não se misturam (Bluetooth e LoRa cada um no seu)', () => {
  const l = layoutPoints([pt({ id: 'a', channels: ['ble'] }), pt({ id: 'b', channels: ['piulora'] })]);
  assert.notEqual(l[0]!.r, l[1]!.r);
});

// ── filtros ──────────────────────────────────────────────

const SAMPLE: MapPoint[] = [
  pt({ id: 'marina', kind: 'pessoa' }), pt({ id: 'ana', kind: 'pessoa' }),
  pt({ id: 'padaria', kind: 'ponto' }), pt({ id: 'biblio', kind: 'wifi' }),
  pt({ id: 'praca', kind: 'gateway', inRange: false }), pt({ id: 'torre', kind: 'super' }),
  pt({ id: 'r77', kind: 'rnode' }), pt({ id: 'a4c1', kind: 'mesh', inRange: false }),
];

test('filtros somam; "Todos" limpa; a contagem de cada filtro não muda com a seleção', () => {
  const counts = filterCounts(SAMPLE);
  assert.deepEqual(counts, { all: 8, pessoa: 2, ponto: 1, wifi: 1, gateway: 1, super: 1, lora: 2 });
  let on = toggleFilter([], 'super');
  on = toggleFilter(on, 'lora');
  assert.deepEqual(on, ['super', 'lora']);
  assert.deepEqual(applyFilters(SAMPLE, on).map(p => p.id), ['torre', 'r77', 'a4c1']);
  assert.deepEqual(filterCounts(applyFilters(SAMPLE, on)).all, 3);
  assert.deepEqual(filterCounts(SAMPLE), counts, 'contagem fixa');
  assert.deepEqual(toggleFilter(on, 'all'), []);
  assert.deepEqual(toggleFilter(['super'], 'super'), [], 'tirar o último volta para Todos');
  assert.equal(applyFilters(SAMPLE, []).length, 8);
});

test('resumo: "N pontos · M no alcance", filtrado "X de N pontos · nomes", procurando e vistos antes', () => {
  assert.equal(mapSummary({ all: SAMPLE, shown: SAMPLE, filters: [], mode: 'full' }), '8 pontos · 6 no alcance');
  const shown = applyFilters(SAMPLE, ['super', 'lora']);
  assert.equal(mapSummary({ all: SAMPLE, shown, filters: ['super', 'lora'], mode: 'full' }), '3 de 8 pontos · Super Nodes, Rádios LoRa');
  assert.equal(mapSummary({ all: [], shown: [], filters: [], mode: 'empty' }), 'procurando · 0 pontos');
  assert.equal(mapSummary({ all: SAMPLE, shown: SAMPLE, filters: [], mode: 'offline' }), '8 vistos antes · 0 no alcance');
  assert.equal(mapSummary({ all: [SAMPLE[0]!], shown: [SAMPLE[0]!], filters: [], mode: 'full' }), '1 ponto · 1 no alcance');
});

// ── lista ────────────────────────────────────────────────

test('lista: ordem de distância, grupos "No alcance" e "Longe" (offline: "Vistos antes")', () => {
  const ps = [
    pt({ id: 'far', inRange: false, distM: 650, distBy: 'signal' }),
    pt({ id: 'lora', channels: ['piulora'] }),
    pt({ id: 'near2', distM: 120, distBy: 'signal' }),
    pt({ id: 'near1', channels: ['ble'] }),
  ];
  assert.deepEqual(sortByDistance(ps).map(p => p.id), ['near1', 'near2', 'far', 'lora']);
  const g = listGroups(ps, { offline: false });
  assert.deepEqual(g.map(x => [x.key, x.points.map(p => p.id)]), [['near', ['near1', 'near2', 'lora']], ['far', ['far']]]);
  assert.deepEqual(listGroups(ps.map(p => ({ ...p, inRange: false })), { offline: true }).map(x => x.key), ['seen']);
  assert.deepEqual(listGroups([], { offline: false }), []);
});

// ── pontos sumidos ───────────────────────────────────────

test('ponto que sumiu fica vazado por 2 min e depois sai do mapa', () => {
  const a = pt({ id: 'a', connected: true }), b = pt({ id: 'b' });
  let mem = trackPoints({}, [a, b], NOW);
  // 1 min depois, "b" sumiu: continua, vazado.
  mem = trackPoints(mem, [{ ...a, lastSeen: NOW + 60_000 }], NOW + 60_000);
  let v = visiblePoints(mem, [{ ...a, lastSeen: NOW + 60_000 }], NOW + 60_000, { offline: false });
  assert.deepEqual(v.map(p => [p.id, p.inRange]), [['a', true], ['b', false]]);
  // Passou de 2 min: some.
  const t2 = NOW + STALE_MS + 1;
  v = visiblePoints(mem, [{ ...a, lastSeen: t2 }], t2, { offline: false });
  assert.deepEqual(v.map(p => p.id), ['a']);
});

test('offline: os últimos pontos vistos, todos vazados e sem conexão', () => {
  const mem = trackPoints({}, [pt({ id: 'a', connected: true }), pt({ id: 'b', lastSeen: NOW - 3_600_000 })], NOW);
  const v = visiblePoints(mem, [], NOW + 10 * 60_000, { offline: true });
  assert.deepEqual(v.map(p => [p.id, p.inRange, p.connected]).sort(), [['a', false, false], ['b', false, false]]);
  assert.equal(v.find(p => p.id === 'b')!.lastSeen, NOW - 3_600_000, 'guarda quando foi visto');
});

test('memória tem teto e esquece o muito antigo', () => {
  const many = Array.from({ length: 80 }, (_, i) => pt({ id: 'p' + i, lastSeen: NOW + i }));
  const mem = trackPoints({}, many, NOW + 100);
  assert.equal(Object.keys(mem).length, 64);
  assert.ok(!('p0' in mem) && 'p79' in mem, 'fica com os mais recentes');
  const old = trackPoints({ x: pt({ id: 'x', lastSeen: NOW - 25 * 3_600_000 }) }, [], NOW);
  assert.deepEqual(Object.keys(old), []);
});

// ── conectar ─────────────────────────────────────────────

test('canal para conectar: Wi-Fi local > Wi-Fi Direct > Bluetooth > LoRa (Piu) > LoRa (Meshtastic)', () => {
  assert.equal(connectChannel(['ble', 'lan', 'nearby'], 'auto'), 'lan');
  assert.equal(connectChannel(['ble', 'nearby'], 'auto'), 'nearby');
  assert.equal(connectChannel(['lora', 'ble'], 'auto'), 'ble');
  assert.equal(connectChannel(['lora', 'piulora'], 'auto'), 'piulora');
  assert.equal(connectChannel(['lora'], 'auto'), 'lora');
  assert.equal(connectChannel([], 'auto'), null);
});

test('canal para conectar respeita o modo LoRa (Só Piu, Só Meshtastic)', () => {
  assert.equal(connectChannel(['lora', 'piulora'], 'mesh'), 'lora');
  assert.equal(connectChannel(['lora', 'piulora'], 'piu'), 'piulora');
  assert.equal(connectChannel(['lora'], 'piu'), null);
  assert.equal(connectChannel(['piulora'], 'mesh'), null);
  assert.equal(connectChannel(['ble', 'lora'], 'piu'), 'ble', 'o modo LoRa não mexe nos outros canais');
});

test('conectar pelo Wi-Fi do ponto: entrando no Wi-Fi → trocando chaves → na malha; erro volta para tentar de novo', () => {
  const base = { ssid: 'Piu · Padaria', joining: false, joinedSsid: null as string | null, error: false, lanPeers: 0, joinedAt: null as number | null, now: NOW };
  assert.equal(wifiPhase({ ...base }), 'idle');
  assert.equal(wifiPhase({ ...base, joining: true }), 'link');
  assert.equal(wifiPhase({ ...base, joinedSsid: 'Piu · Padaria', joinedAt: NOW - 2000 }), 'keys');
  assert.equal(wifiPhase({ ...base, joinedSsid: 'Piu · Padaria', joinedAt: NOW - 2000, lanPeers: 2 }), 'done');
  assert.equal(wifiPhase({ ...base, joinedSsid: 'Piu · Padaria', joinedAt: NOW - 20_000 }), 'done', 'sem vizinho ainda, mas o Wi-Fi entrou');
  assert.equal(wifiPhase({ ...base, joinedSsid: 'Outra rede', joinedAt: NOW - 2000 }), 'idle');
  assert.equal(wifiPhase({ ...base, error: true }), 'failed');
  assert.deepEqual(connectSteps('link'), ['now', 'wait', 'wait']);
  assert.deepEqual(connectSteps('keys'), ['done', 'now', 'wait']);
  assert.deepEqual(connectSteps('mesh'), ['done', 'done', 'now']);
  assert.deepEqual(connectSteps('done'), ['done', 'done', 'done']);
});

test('aviso de conectado: quantos pontos entraram no alcance desde que começou', () => {
  const before = new Set(['a', 'b']);
  assert.equal(gainedCount(before, [pt({ id: 'a' }), pt({ id: 'b' }), pt({ id: 'c' }), pt({ id: 'd', inRange: false })]), 1);
});

test('ponto longe: quanto falta para o alcance do canal (só com distância conhecida)', () => {
  assert.equal(farMissing(pt({ id: 'p', channels: ['lan'], distM: 650, distBy: 'signal', inRange: false })), 550);
  assert.equal(farMissing(pt({ id: 'p', channels: ['lan'], inRange: false })), null);
  assert.equal(farMissing(pt({ id: 'p', channels: ['lan'], distM: 60, distBy: 'signal' })), 0);
});

// ── estados ──────────────────────────────────────────────

test('estado: offline (nenhum canal ligado) vem antes de vazio; vazio só sem pontos', () => {
  assert.equal(isOnline({ transport: 'off', lan: false, lora: false }), false);
  assert.equal(isOnline({ transport: 'unavailable', lan: false, lora: false }), false);
  assert.equal(isOnline({ transport: 'running', lan: false, lora: false }), true);
  assert.equal(isOnline({ transport: 'off', lan: true, lora: false }), true);
  assert.equal(isOnline({ transport: 'off', lan: false, lora: true }), true);
  assert.equal(mapMode({ online: false, count: 0 }), 'offline');
  assert.equal(mapMode({ online: false, count: 3 }), 'offline');
  assert.equal(mapMode({ online: true, count: 0 }), 'empty');
  assert.equal(mapMode({ online: true, count: 3 }), 'full');
});

// ── textos ───────────────────────────────────────────────

test('distância: exata, "~" pelo sinal, "até" o alcance do canal quando não há distância', () => {
  assert.equal(distanceText(pt({ id: 'a', distM: 40, distBy: 'pos' })), '40 m');
  assert.equal(distanceText(pt({ id: 'a', distM: 4200, distBy: 'pos' })), '4,2 km');
  assert.equal(distanceText(pt({ id: 'a', distM: 1000, distBy: 'pos' })), '1 km');
  assert.equal(distanceText(pt({ id: 'a', distM: 120, distBy: 'signal' })), '~120 m');
  assert.equal(distanceText(pt({ id: 'a', channels: ['ble'] })), 'até 30 m');
  assert.equal(distanceText(pt({ id: 'a', channels: ['piulora'] })), 'até 5 km');
});

test('leitor de tela: nome, tipo, distância com direção e estado', () => {
  assert.equal(pointA11y(pt({ id: 't', name: 'piu.torre-serra', kind: 'super', distM: 4200, distBy: 'pos', bearing: 4, channels: ['piulora'] })),
    'piu.torre-serra, Super Node, 4,2 quilômetros ao norte, no alcance');
  assert.equal(pointA11y(pt({ id: 'p', name: 'piu-a1b2c3', kind: 'pessoa', channels: ['ble'], connected: true })),
    'piu-a1b2c3, Pessoa com Piu, até 30 metros, sem direção, conectado');
  assert.equal(pointA11y(pt({ id: 'w', name: 'Piu · Biblioteca', kind: 'wifi', distM: 650, distBy: 'signal', inRange: false, channels: ['lan'] })),
    'Piu · Biblioteca, Wi-Fi compatível, cerca de 650 metros, sem direção, longe');
  assert.equal(bearingDir(0), 'n'); assert.equal(bearingDir(44), 'ne'); assert.equal(bearingDir(181), 's'); assert.equal(bearingDir(350), 'n');
});

// ── fontes reais ─────────────────────────────────────────

test('vizinhos do transporte: pessoas com Piu, sem a malha LoRa virtual; meio desligado = longe', () => {
  const peers: Peer[] = [
    { id: 'n:piu-a1b2c3', name: 'piu-a1b2c3', via: 'ble', connected: true },
    { id: 'n:piu-0f0f0f', name: 'piu-0f0f0f', via: 'nearby', connected: false },
    { id: 'n:Malha LoRa', name: 'Malha LoRa', via: 'piulora', connected: true },
    { id: 'lora:mesh', name: 'Malha LoRa', via: 'lora', connected: true },
  ];
  const ps = peerPoints(peers, { live: p => p.via !== 'nearby', now: NOW });
  assert.deepEqual(ps.map(p => p.id), ['n:piu-a1b2c3', 'n:piu-0f0f0f']);
  const [a, b] = ps;
  assert.equal(a!.kind, 'pessoa'); assert.deepEqual(a!.channels, ['ble']);
  assert.equal(a!.connected, true); assert.equal(a!.inRange, true);
  assert.equal(a!.distM, null, 'o transporte não mede distância: não inventa'); assert.equal(a!.bearing, null);
  assert.equal(a!.why, 'announces'); assert.equal(a!.connectable, false);
  assert.equal(b!.inRange, false); assert.equal(b!.connected, false);
});

test('vizinho com vários meios: o meio mostrado vem primeiro, e o conectar escolhe pela ordem do desenho', () => {
  const [p] = peerPoints([{ id: 'n:piu-a1b2c3', name: 'piu-a1b2c3', via: 'ble', media: ['nearby', 'ble'], connected: false }], { live: () => true, now: NOW });
  assert.deepEqual(p!.channels, ['ble', 'nearby']);
  assert.equal(connectChannel(p!.channels, 'auto'), 'nearby');
});

test('Super Nodes ouvidos (anúncio PN): um ponto por chave, nos dois rádios; gateway separado; sem distância', () => {
  const sec = NOW / 1000;
  const ps = superNodePoints([
    { medium: 'piulora', nodes: [{ id: '3f2a9c00aa', gateway: false, last: sec - 20 }, { id: '77c1aa00bb', gateway: true, last: sec - 90 }] },
    { medium: 'lora', nodes: [{ id: '3f2a9c00aa', gateway: false, last: sec - 5 }] },
  ]);
  assert.deepEqual(ps.map(p => [p.id, p.name, p.kind]), [['pn:3f2a9c00aa', 'piu.3f2a', 'super'], ['pn:77c1aa00bb', 'piu.77c1', 'gateway']]);
  assert.deepEqual(ps[0]!.channels, ['piulora', 'lora']);
  assert.equal(ps[0]!.lastSeen, NOW - 5000, 'o anúncio mais recente');
  assert.equal(ps[0]!.distM, null); assert.equal(ps[0]!.why, 'beacon'); assert.equal(ps[0]!.connectable, false);
});

test('Wi-Fi: só redes "Piu · …", distância e sinal pelo dBm; a rede em que está = conectado', () => {
  const ps = wifiPoints([
    { ssid: 'Piu · Padaria', level: -50, secure: false },
    { ssid: 'Casa da Ana', level: -40, secure: true },
    { ssid: 'Piu · Biblioteca', level: -82, secure: true },
  ], { joinedSsid: 'Piu · Praça', scannedAt: NOW, canJoin: true });
  assert.deepEqual(ps.map(p => p.name), ['Piu · Padaria', 'Piu · Biblioteca', 'Piu · Praça']);
  const [pad, bib, praca] = ps;
  assert.equal(pad!.kind, 'wifi'); assert.deepEqual(pad!.channels, ['lan']);
  assert.equal(pad!.distBy, 'signal'); assert.equal(pad!.signal, 'strong'); assert.equal(pad!.why, 'ssid');
  assert.equal(pad!.connectable, true);
  assert.ok(bib!.distM! > pad!.distM!, 'sinal mais fraco = mais longe');
  assert.equal(bib!.signal, 'weak');
  assert.equal(praca!.connected, true); assert.equal(praca!.distM, null); assert.equal(praca!.connectable, false);
  assert.equal(wifiPoints([{ ssid: 'Piu · Padaria', level: -50, secure: false }], { joinedSsid: null, scannedAt: NOW, canJoin: false })[0]!.connectable, false);
});

test('sinal Wi-Fi: forte/médio/fraco e distância crescente com o dBm, sempre entre 10 m e 10 km', () => {
  assert.equal(signalOf(-50), 'strong'); assert.equal(signalOf(-60), 'medium'); assert.equal(signalOf(-75), 'weak'); assert.equal(signalOf(-95), 'weak');
  const ds = [-40, -60, -70, -80, -90].map(wifiDistance);
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i]! >= ds[i - 1]!);
  assert.ok(ds.every(d => d >= 10 && d <= 10_000));
  assert.equal(wifiDistance(-20), 10);
});

test('conectar rádio LoRa (mapa vazio): o mesmo primeiro passo do "+" da linha LoRa', () => {
  assert.equal(addLoraStep({ piu: true, mesh: true, region: true }), 'type');
  assert.equal(addLoraStep({ piu: true, mesh: true, region: false }), 'type');
  assert.equal(addLoraStep({ piu: true, mesh: false, region: true }), 'piu');
  assert.equal(addLoraStep({ piu: true, mesh: false, region: false }), 'regionFirst');
  assert.equal(addLoraStep({ piu: false, mesh: true, region: false }), 'mesh');
  assert.equal(addLoraStep({ piu: false, mesh: false, region: false }), null, 'sem módulo de rádio: sem botão');
});
