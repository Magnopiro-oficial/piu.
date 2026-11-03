/**
 * Alertas oficiais em CAP 1.2: leitor de XML defensivo, coletor do feed RSS (INMET) com fetch
 * injetado e fixtures no formato do INMET, vigência, cancelamento, persistência e `GET /api/alerts`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AlertCollector, alertsFile, DEFAULT_ALERT_FEEDS, isLocalHost, safeLink } from '../src/alerts/collector.js';
import { parseCap } from '../src/alerts/cap.js';
import { parseXml, XmlError } from '../src/alerts/xml.js';
import { buildApp } from '../src/app.js';
import { type Config, loadAlertsConfig } from '../src/config.js';
import { Pairing } from '../src/security/pairing.js';
import { Store } from '../src/store.js';

const FIX = join(import.meta.dirname, 'fixtures', 'cap');
const fixture = (f: string) => readFileSync(join(FIX, f), 'utf8');
const FEED = DEFAULT_ALERT_FEEDS[0]!;
const BASE = 'http://alert-as.inmet.gov.br/cap_12/';
/** 2026-11-03 12:00 em Brasília: tempestade e umidade vigentes. */
const T0 = Date.parse('2026-11-03T12:00:00-03:00');

/** Servidor falso: cada URL devolve uma fixture; registra o que foi pedido. */
function fakeFetch(routes: Record<string, string | (() => Response)>) {
  const log: string[] = [];
  const f = async (url: string) => {
    log.push(url);
    const r = routes[url];
    if (r === undefined) return new Response('não encontrado', { status: 404 });
    return typeof r === 'function' ? r() : new Response(r, { status: 200, headers: { 'content-type': 'application/xml' } });
  };
  return { fetch: f, log };
}

const inmetRoutes = () => ({
  [FEED]: fixture('alert-as.rss'),
  [BASE + 'xml/2026/11/03/tempestade-teste.xml']: fixture('tempestade.xml'),
  [BASE + 'rss/xml/2026/11/03/umidade-teste.xml']: fixture('umidade.xml'),
  [BASE + 'xml/2026/11/03/exercicio-teste.xml']: fixture('exercicio.xml'),
});

test('XML: recusa DTD, entidade externa e "billion laughs"; decodifica entidades padrão e CDATA', () => {
  const xxe = '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
  assert.throws(() => parseXml(xxe), XmlError);
  const lol = '<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><l>&b;</l>';
  assert.throws(() => parseXml(lol), XmlError);
  assert.throws(() => parseXml('<a>&x;</a>'), /Entidade não permitida/);
  assert.throws(() => parseXml('<a><b></a>'), XmlError);
  assert.throws(() => parseXml('<a/><b/>'), /Mais de um/);
  assert.throws(() => parseXml('<a>' + 'x'.repeat(2000) + '</a>', { maxBytes: 1000, maxDepth: 8, maxElements: 10 }), /grande demais/);
  assert.throws(() => parseXml('<a>'.repeat(40) + '</a>'.repeat(40)), /profundo/);
  const n = parseXml('<?xml version="1.0"?><!-- c --><x:r xmlns:x="u" k=\'v&amp;w\'>a &lt;b&gt; &#233;&#xE9;<![CDATA[<cru> & ]]></x:r>');
  assert.equal(n.name, 'r');
  assert.equal(n.attrs.k, 'v&w');
  assert.equal(n.text, 'a <b> éé<cru> & ');
});

test('CAP 1.2: lê os campos do INMET, escolhe o bloco em português e descarta o que não é Actual', () => {
  const a = parseCap(fixture('tempestade.xml'))!;
  assert.equal(a.identifier, 'urn:oid:2.49.0.1.76.0.2026.11.3.1.1');
  assert.equal(a.sender, 'cap@inmet.gov.br');
  assert.equal(a.msgType, 'Alert');
  assert.equal(a.info.severity, 'Severe');
  assert.equal(a.info.urgency, 'Immediate');
  assert.equal(a.info.senderName, 'INMET');
  assert.equal(a.info.event, 'Tempestade');
  assert.match(a.info.instruction, /árvores & não estacione/);
  assert.deepEqual(a.info.areas[0]!.geocodes.map(g => g.value), ['3550308', '3549904']);
  assert.match(a.info.areas[0]!.areaDesc, /Metropolitana de São Paulo/);
  const u = parseCap(fixture('umidade.xml'))!;
  assert.equal(u.info.language, 'pt-BR', 'prefixo de namespace e dois idiomas: fica o português');
  assert.equal(u.info.headline, 'Aviso de Baixa Umidade');
  assert.match(u.info.instruction, /líquido.*físico/);
  assert.equal(parseCap(fixture('exercicio.xml')), null, 'exercício não é alerta real');
  assert.equal(parseCap('<rss/>'), null);
});

test('links do feed: só http(s) público (nada da rede local do nó)', () => {
  assert.equal(safeLink('xml/a.xml', FEED), BASE + 'rss/xml/a.xml');
  for (const bad of ['http://192.168.0.1/x', 'http://127.0.0.1/x', 'http://localhost:8420/api', 'http://[::1]/x', 'file:///etc/passwd', 'http://u:p@exemplo.gov.br/x', 'http://10.1.2.3/']) assert.equal(safeLink(bad, FEED), null, bad);
  assert.equal(isLocalHost('alert-as.inmet.gov.br'), false);
});

test('coletor: RSS → CAP, vigentes com a origem, sem baixar de novo, vencimento e cancelamento persistidos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-alerts-'));
  try {
    let now = T0;
    const srv = fakeFetch(inmetRoutes());
    const c = new AlertCollector({ feeds: [FEED], file: alertsFile(dir), fetch: srv.fetch, now: () => now });
    await c.poll();
    const v = c.view();
    assert.equal(v.enabled, true);
    assert.deepEqual(v.alerts.map(a => a.info.event), ['Tempestade', 'Baixa Umidade'], 'mais recente primeiro, sem o exercício');
    const t = v.alerts[0]!;
    assert.equal(t.id, 'cap@inmet.gov.br|urn:oid:2.49.0.1.76.0.2026.11.3.1.1');
    assert.deepEqual(t.source, { feed: FEED, url: BASE + 'xml/2026/11/03/tempestade-teste.xml' });
    assert.equal(t.receivedAt, T0);
    assert.ok(!srv.log.some(u => u.includes('192.168')), 'link para a rede local nunca é buscado');
    assert.equal(v.feeds[0]!.lastOkAt, T0);
    assert.equal(v.feeds[0]!.items, 4);

    // Segunda volta: o feed é lido de novo, os alertas já lidos não.
    const before = srv.log.length;
    await c.poll();
    assert.deepEqual(srv.log.slice(before), [FEED]);

    // Reiniciar o nó: os vigentes voltam do disco.
    const again = new AlertCollector({ feeds: [FEED], file: alertsFile(dir), fetch: fakeFetch({}).fetch, now: () => now });
    assert.equal(again.view().alerts.length, 2);

    // Depois do `expires` da umidade (20h de Brasília), só a tempestade fica.
    now = Date.parse('2026-11-03T21:00:00-03:00');
    assert.deepEqual(c.view().alerts.map(a => a.info.event), ['Tempestade']);

    // O INMET cancela a tempestade: sai.
    const routes = inmetRoutes();
    routes[FEED] = fixture('alert-as.rss').replace('</channel>', `<item><link>${BASE}xml/2026/11/03/cancela.xml</link></item></channel>`);
    routes[BASE + 'xml/2026/11/03/cancela.xml'] = fixture('cancela-tempestade.xml');
    const c2 = new AlertCollector({ feeds: [FEED], file: alertsFile(dir), fetch: fakeFetch(routes).fetch, now: () => now });
    await c2.poll();
    assert.deepEqual(c2.view().alerts, []);
    const saved = JSON.parse(readFileSync(alertsFile(dir), 'utf8'));
    assert.deepEqual(saved.alerts, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('coletor: feed fora do ar, resposta grande demais e redirecionamento para a rede local viram erro do feed', async () => {
  const big = () => new Response('<rss>' + ' '.repeat(3 * 1024 * 1024) + '</rss>');
  const redirect = () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8420/api/session' } });
  const srv = fakeFetch({ 'https://a.example/rss': big, 'https://b.example/rss': redirect });
  const c = new AlertCollector({ feeds: ['https://a.example/rss', 'https://b.example/rss', 'https://c.example/rss'], file: null, fetch: srv.fetch, now: () => T0 });
  await c.poll();
  const st = c.view().feeds;
  assert.match(st[0]!.lastError!, /grande demais/);
  assert.match(st[1]!.lastError!, /redirecionamento recusado/);
  assert.match(st[2]!.lastError!, /HTTP 404/);
  assert.ok(!srv.log.some(u => u.includes('127.0.0.1')));
  assert.deepEqual(c.view().alerts, []);
});

test('coletor: URL que devolve um <alert> direto (feed configurável, ex.: IDAP)', async () => {
  const url = 'https://idap.example/cap/1.xml';
  const c = new AlertCollector({ feeds: [url], file: null, fetch: fakeFetch({ [url]: fixture('tempestade.xml') }).fetch, now: () => T0 });
  await c.poll();
  assert.deepEqual(c.view().alerts.map(a => a.source), [{ feed: url, url }]);
});

test('PIU_ALERT_FEEDS e PIU_ALERT_POLL_MS', () => {
  assert.deepEqual(loadAlertsConfig({}), { feeds: [FEED], pollMs: 600_000 });
  assert.deepEqual(loadAlertsConfig({ PIU_ALERT_FEEDS: '' }).feeds, [], 'vazio desliga');
  assert.deepEqual(loadAlertsConfig({ PIU_ALERT_FEEDS: 'https://alerts.inmet.gov.br/cap_12/rss/alert-as.rss, https://x.example/a.rss' }).feeds.length, 2);
  assert.throws(() => loadAlertsConfig({ PIU_ALERT_FEEDS: 'ftp://x' }), /PIU_ALERT_FEEDS/);
  assert.equal(loadAlertsConfig({ PIU_ALERT_POLL_MS: '120000' }).pollMs, 120_000);
  assert.throws(() => loadAlertsConfig({ PIU_ALERT_POLL_MS: '10' }), /PIU_ALERT_POLL_MS/);
});

test('GET /api/alerts: exige sessão e devolve os vigentes com a origem', async () => {
  const HOST = 'piu-node.local:8420';
  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };
  const c = new AlertCollector({ feeds: [FEED], file: null, fetch: fakeFetch(inmetRoutes()).fetch, now: () => T0 });
  await c.poll();
  const pairing = new Pairing();
  const mk = (alerts: AlertCollector | null) => buildApp({ config, store: new Store(null), pairing, packages: [], packagesDir: '/nao-usado', now: () => T0, alerts });
  for (const [app, expect] of [[await mk(c), 2], [await mk(null), 0]] as const) {
    const headers = { host: HOST, origin: `https://${HOST}` };
    assert.equal((await app.inject({ method: 'GET', url: '/api/alerts', headers })).statusCode, 401);
    const p = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(T0), name: 'Ana' } });
    const cookie = String(p.headers['set-cookie']).split(';')[0]!;
    const r = await app.inject({ method: 'GET', url: '/api/alerts', headers: { host: HOST, cookie } });
    assert.equal(r.statusCode, 200);
    const j = r.json() as { enabled: boolean; alerts: { sender: string; source: { feed: string } }[] };
    assert.equal(j.enabled, expect > 0);
    assert.equal(j.alerts.length, expect);
    if (expect) assert.deepEqual([j.alerts[0]!.sender, j.alerts[0]!.source.feed], ['cap@inmet.gov.br', FEED]);
    assert.equal(r.headers['cache-control'], 'no-store');
    await app.close();
  }
});
