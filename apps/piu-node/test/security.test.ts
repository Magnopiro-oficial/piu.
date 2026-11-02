import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { loadPackages, releaseKey, signedPayload } from '../src/packages.js';
import { Pairing } from '../src/security/pairing.js';
import { Store } from '../src/store.js';

const HOST = 'piu-node.local:8420';
const ORIGIN = `https://${HOST}`;
const MIN = 60_000;

/** Nó de teste: painel falso, pacotes assinados por uma chave de release gerada aqui, relógio controlável. */
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'piu-node-'));
  const panelDir = join(dir, 'panel');
  const pkgDir = join(dir, 'packages');
  execFileSync('mkdir', ['-p', panelDir, pkgDir]);
  writeFileSync(join(panelDir, 'index.html'), '<!doctype html><title>painel</title>');
  writeFileSync(join(dir, 'state.json'), '{"segredo":"não pode vazar"}');

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const signPkg = (file: string, bytes: Buffer, version = '0.4.3') => {
    writeFileSync(join(pkgDir, file), bytes);
    const base = { name: 'piu-node-openwrt', version, file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const m = { ...base, signature: sign(null, signedPayload(base), privateKey).toString('base64') };
    writeFileSync(join(pkgDir, `${file}.manifest.json`), JSON.stringify(m));
    return m;
  };
  signPkg('piu-node-openwrt.ipk', Buffer.from('pacote legítimo'));
  // Manifesto com assinatura de outra chave: não pode ser oferecido.
  const evil = generateKeyPairSync('ed25519').privateKey;
  const forgedBytes = Buffer.from('pacote do atacante');
  const forgedBase = { name: 'piu-node-openwrt', version: '9.9.9', file: 'forjado.ipk', size: forgedBytes.length, sha256: createHash('sha256').update(forgedBytes).digest('hex') };
  writeFileSync(join(pkgDir, 'forjado.ipk'), forgedBytes);
  writeFileSync(join(pkgDir, 'forjado.ipk.manifest.json'), JSON.stringify({ ...forgedBase, signature: sign(null, signedPayload(forgedBase), evil).toString('base64') }));
  // Manifesto legítimo, arquivo trocado depois de assinar: também não.
  signPkg('trocado.ipk', Buffer.from('original'));
  writeFileSync(join(pkgDir, 'trocado.ipk'), Buffer.from('ORIGINAL'));

  const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: dir, panelDir, releasePubKey: spki };
  let clock = 1_800_000_000_000;
  const pairing = new Pairing();
  const spent: string[] = [];
  const packages = loadPackages(pkgDir, releaseKey(spki));
  const app = await buildApp({ config, store: new Store(null), pairing, packages, packagesDir: pkgDir, now: () => clock, onCodeSpent: r => spent.push(r) });

  const req = (method: string, url: string, o: { cookie?: string; csrf?: string; origin?: string | null; body?: unknown; host?: string; ip?: string } = {}) =>
    app.inject({
      method: method as 'GET', url, remoteAddress: o.ip ?? '10.0.0.2', payload: o.body as object | undefined,
      headers: {
        host: o.host ?? HOST,
        ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }),
        ...(o.cookie ? { cookie: o.cookie } : {}),
        ...(o.csrf ? { 'x-csrf-token': o.csrf } : {}),
      },
    });

  /** Pareia um operador (como o navegador faria) e devolve cookie + token CSRF. */
  const pair = async (name: string, ip?: string) => {
    const code = pairing.issue(clock);
    const r = await req('POST', '/api/pair', { body: { code, name }, ip });
    assert.equal(r.statusCode, 200, r.body);
    const setCookie = String(r.headers['set-cookie']);
    return { cookie: setCookie.split(';')[0]!, csrf: (r.json() as { csrf: string }).csrf, setCookie, body: r.json() };
  };

  /** Código emitido no relógio do teste (como o console do nó faria). */
  const issueCode = () => pairing.issue(clock);
  return { app, req, pair, pairing, issueCode, spent, packages, pkgDir, spki, advance: (ms: number) => { clock += ms; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('headers de segurança (Helmet) em todas as respostas, sem fingerprinting', async () => {
  const t = await setup();
  const r = await t.req('GET', '/');
  assert.equal(r.statusCode, 200);
  const h = r.headers;
  assert.match(String(h['content-security-policy']), /default-src 'none'.*script-src 'self'.*frame-ancestors 'none'/);
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.match(String(h['strict-transport-security']), /max-age=31536000; includeSubDomains/);
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.match(String(h['permissions-policy']), /camera=\(\)/);
  assert.equal(h['x-powered-by'], undefined);
  assert.equal(h['server'], undefined);
  assert.equal(h['access-control-allow-origin'], undefined, 'CORS fechado: nenhuma origem externa');
  t.cleanup();
});

test('anti DNS rebinding: Host fora da lista é recusado', async () => {
  const t = await setup();
  assert.equal((await t.req('GET', '/', { host: 'evil.example:8420' })).statusCode, 421);
  assert.equal((await t.req('GET', '/api/devices', { host: '192.168.0.50:8420' })).statusCode, 421);
  t.cleanup();
});

test('rotas privadas exigem sessão (401 sem cookie ou com cookie inválido)', async () => {
  const t = await setup();
  for (const [m, u] of [['GET', '/api/devices'], ['GET', '/api/wallet'], ['GET', '/api/packages'], ['GET', '/api/session'], ['POST', '/api/logout'], ['POST', '/api/wallet/transfer'], ['DELETE', '/api/devices/00000000-0000-4000-8000-000000000000']]) {
    assert.equal((await t.req(m!, u!)).statusCode, 401, `${m} ${u}`);
    assert.equal((await t.req(m!, u!, { cookie: '__Host-piu_session=forjado' })).statusCode, 401, `${m} ${u} cookie forjado`);
  }
  t.cleanup();
});

test('pareamento: cookie __Host-, HttpOnly, Secure, SameSite=Strict; token nunca no corpo; código de uso único', async () => {
  const t = await setup();
  const code = t.issueCode();
  const bad = await t.req('POST', '/api/pair', { body: { code: code === '00000000' ? '11111111' : '00000000', name: 'X' } });
  assert.equal(bad.statusCode, 401);
  assert.deepEqual(bad.json(), { error: 'Código inválido ou expirado.' });
  const ok = await t.req('POST', '/api/pair', { body: { code, name: 'Cardeal' } });
  assert.equal(ok.statusCode, 200);
  const sc = String(ok.headers['set-cookie']);
  assert.match(sc, /^__Host-piu_session=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(sc.includes(flag), flag);
  const token = sc.split(';')[0]!.split('=')[1]!;
  assert.ok(!ok.body.includes(token), 'o token da sessão não aparece no JSON (só no cookie HttpOnly)');
  assert.deepEqual(Object.keys(ok.json()).sort(), ['csrf', 'operator']);
  assert.deepEqual(t.spent, ['used']);
  assert.equal((await t.req('POST', '/api/pair', { body: { code, name: 'Outro' }, ip: '10.0.0.9' })).statusCode, 429, 'código já usado: não há código ativo');
  t.cleanup();
});

test('força bruta: 5 erros destroem o código (mesmo trocando de IP) e o limite por IP corta antes', async () => {
  const t = await setup();
  const code = t.issueCode();
  const wrong = code === '12345678' ? '87654321' : '12345678';
  const res = [];
  for (let i = 0; i < 5; i++) res.push((await t.req('POST', '/api/pair', { body: { code: wrong, name: 'x' }, ip: `10.0.1.${i}` })).statusCode);
  assert.deepEqual(res, [401, 401, 401, 401, 429]);
  assert.deepEqual(t.spent, ['locked']);
  assert.equal((await t.req('POST', '/api/pair', { body: { code, name: 'x' }, ip: '10.0.2.1' })).statusCode, 429, 'nem o código certo funciona depois do bloqueio');
  // Limite por IP: 5 tentativas a cada 10 min.
  t.issueCode();
  const ip = '10.0.3.3';
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await t.req('POST', '/api/pair', { body: { code: 'abc', name: 'x' }, ip })).statusCode);
  assert.deepEqual(codes, [400, 400, 400, 400, 400, 429]);
  t.cleanup();
});

test('CSRF: mudança de estado exige token da sessão e a mesma origem', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const devs = (await t.req('GET', '/api/devices', { cookie: a.cookie })).json() as { id: string }[];
  const url = `/api/devices/${devs[0]!.id}/pause`;
  assert.equal((await t.req('POST', url, { cookie: a.cookie })).statusCode, 403, 'sem token');
  assert.equal((await t.req('POST', url, { cookie: a.cookie, csrf: 'x'.repeat(43) })).statusCode, 403, 'token errado');
  assert.equal((await t.req('POST', url, { cookie: a.cookie, csrf: a.csrf, origin: 'https://evil.example' })).statusCode, 403, 'origem de outro site');
  assert.equal((await t.req('POST', url, { cookie: a.cookie, csrf: a.csrf, origin: null })).statusCode, 403, 'sem Origin nem Sec-Fetch-Site');
  assert.equal((await t.req('POST', '/api/pair', { body: { code: '12345678', name: 'x' }, origin: 'https://evil.example' })).statusCode, 403, 'pareamento só da própria origem');
  const ok = await t.req('POST', url, { cookie: a.cookie, csrf: a.csrf });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, 'paused');
  t.cleanup();
});

test('IDOR: um operador não vê nem mexe nos equipamentos de outro (404, sem revelar que existem)', async () => {
  const t = await setup();
  const a = await t.pair('Dono');
  const b = await t.pair('Vizinho', '10.0.0.7');
  const devsA = (await t.req('GET', '/api/devices', { cookie: a.cookie })).json() as { id: string }[];
  assert.equal(devsA.length, 3);
  assert.deepEqual((await t.req('GET', '/api/devices', { cookie: b.cookie, ip: '10.0.0.7' })).json(), []);
  const target = devsA[0]!.id;
  assert.equal((await t.req('POST', `/api/devices/${target}/pause`, { cookie: b.cookie, csrf: b.csrf, ip: '10.0.0.7' })).statusCode, 404);
  assert.equal((await t.req('DELETE', `/api/devices/${target}`, { cookie: b.cookie, csrf: b.csrf, ip: '10.0.0.7' })).statusCode, 404);
  assert.equal((await t.req('GET', '/api/devices', { cookie: a.cookie })).json().length, 3, 'nada foi alterado');
  assert.equal((await t.req('DELETE', `/api/devices/${target}`, { cookie: a.cookie, csrf: a.csrf })).statusCode, 204);
  t.cleanup();
});

test('IDs não previsíveis e respostas sem dados internos', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const devs = (await t.req('GET', '/api/devices', { cookie: a.cookie })).json() as Record<string, unknown>[];
  for (const d of devs) {
    assert.match(String(d.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v4');
    assert.deepEqual(Object.keys(d).sort(), ['cls', 'id', 'name', 'status', 'today'], 'sem ownerId nem campos internos');
  }
  assert.equal((await t.req('POST', '/api/devices/1/pause', { cookie: a.cookie, csrf: a.csrf })).statusCode, 400, 'id fora do formato');
  const s = (await t.req('GET', '/api/session', { cookie: a.cookie })).json() as Record<string, unknown>;
  assert.ok(!JSON.stringify(s).includes('tokenHash'));
  t.cleanup();
});

test('transferência de LUNES: exige reautenticação recente e valida o valor', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const transfer = (amount: unknown) => t.req('POST', '/api/wallet/transfer', { cookie: a.cookie, csrf: a.csrf, body: { amount } });
  assert.equal((await transfer(10.5)).statusCode, 200, 'logo depois do pareamento');
  assert.equal((await transfer(1.234)).statusCode, 400, 'mais de 2 casas');
  assert.equal((await transfer(-5)).statusCode, 400);
  assert.equal((await transfer(999_999)).statusCode, 400, 'saldo insuficiente');
  assert.equal((await transfer('10')).statusCode, 400, 'tipo errado');
  t.advance(16 * MIN);
  const late = await transfer(10);
  assert.equal(late.statusCode, 403);
  assert.equal(late.json().reauth, true);
  const code = t.issueCode();
  assert.equal((await t.req('POST', '/api/reauth', { cookie: a.cookie, csrf: a.csrf, body: { code } })).statusCode, 200);
  assert.equal((await transfer(10)).statusCode, 200);
  const w = (await t.req('GET', '/api/wallet', { cookie: a.cookie })).json() as { balance: number; txs: unknown[] };
  assert.equal(w.balance, 1264.1);
  assert.equal(w.txs.length, 2);
  t.cleanup();
});

test('sessão expira por inatividade e o logout a invalida no servidor', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  t.advance(29 * MIN);
  assert.equal((await t.req('GET', '/api/devices', { cookie: a.cookie })).statusCode, 200);
  t.advance(31 * MIN);
  assert.equal((await t.req('GET', '/api/devices', { cookie: a.cookie })).statusCode, 401, 'inativa > 30 min');
  const b = await t.pair('Cardeal');
  assert.equal((await t.req('POST', '/api/logout', { cookie: b.cookie, csrf: b.csrf })).statusCode, 200);
  assert.equal((await t.req('GET', '/api/devices', { cookie: b.cookie })).statusCode, 401, 'cookie antigo não vale mais');
  t.cleanup();
});

test('limites por rota são independentes (hooks não vazam entre rotas)', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const r = await t.req('POST', '/api/wallet/transfer', { cookie: a.cookie, csrf: a.csrf, body: { amount: 1 } });
  assert.equal(r.headers['x-ratelimit-limit'], '10', 'transferência: 10/min');
  const d = await t.req('GET', '/api/devices', { cookie: a.cookie });
  assert.equal(d.headers['x-ratelimit-limit'], '300', 'demais rotas: limite global');
  t.cleanup();
});

test('erros sem stack trace nem detalhes internos', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const bad = await t.req('POST', '/api/wallet/transfer', { cookie: a.cookie, csrf: a.csrf, body: { amount: 1, extra: '<script>' } });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json(), { error: 'Requisição inválida.' });
  // Pacote listado cujo arquivo sumiu do disco: 500 genérico.
  rmSync(join(t.pkgDir, 'piu-node-openwrt.ipk'));
  const err = await t.req('GET', '/pkg/piu-node-openwrt.ipk');
  assert.equal(err.statusCode, 500);
  assert.deepEqual(err.json(), { error: 'Erro interno.' });
  assert.ok(!/at |\/home\/|node_modules|ENOENT/.test(err.body));
  t.cleanup();
});

test('arquivos do painel: sem path traversal', async () => {
  const t = await setup();
  for (const u of ['/../state.json', '/..%2fstate.json', '/%2e%2e/state.json', '/index.html%00.js', '/../../etc/passwd']) {
    const r = await t.req('GET', u);
    assert.notEqual(r.statusCode, 200, u);
    assert.ok(!r.body.includes('não pode vazar'), u);
  }
  t.cleanup();
});

test('pacotes: só os assinados pela chave fixada e com o arquivo íntegro; o instalador confere de novo', async () => {
  const t = await setup();
  assert.deepEqual(t.packages.map(p => p.file), ['piu-node-openwrt.ipk'], 'forjado e trocado ficam de fora');
  assert.equal((await t.req('GET', '/pkg/forjado.ipk')).statusCode, 404);
  assert.equal((await t.req('GET', '/pkg/trocado.ipk')).statusCode, 404);
  const dl = await t.req('GET', '/pkg/piu-node-openwrt.ipk', { origin: null });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-type'], 'application/octet-stream');
  assert.match(String(dl.headers['content-disposition']), /attachment/);
  const verify = (file: string) => {
    try {
      return execFileSync('node', ['scripts/verify-package.mjs', join(t.pkgDir, file), join(t.pkgDir, `${file}.manifest.json`)], { env: { ...process.env, PIU_RELEASE_PUBKEY: t.spki }, stdio: 'pipe' }).toString();
    } catch (e) { return 'FALHOU: ' + String((e as { stderr: Buffer }).stderr); }
  };
  assert.match(verify('piu-node-openwrt.ipk'), /^OK:/);
  assert.match(verify('forjado.ipk'), /assinatura do manifesto não confere/);
  assert.match(verify('trocado.ipk'), /SHA-256 diferente|tamanho diferente/);
  t.cleanup();
});

test('sessões: lista só as do operador, sem token; encerrar as outras exige step-up', async () => {
  const t = await setup();
  const a1 = await t.pair('Ana', '10.0.3.1');
  await t.pair('Beto', '10.0.3.2'); // outro operador: suas sessões não aparecem para Ana
  const list = await t.req('GET', '/api/sessions', { cookie: a1.cookie });
  assert.equal(list.statusCode, 200);
  const items = list.json() as { id: string; label: string; current: boolean }[];
  assert.equal(items.length, 1, 'não vê sessões de outro operador');
  assert.equal(items[0]!.current, true);
  assert.ok(!list.body.includes(a1.cookie.split('=')[1]!), 'token não aparece');
  assert.ok(!/tokenHash|csrf/.test(list.body), 'nem hash nem CSRF');
  // Sem CSRF: recusado antes de tudo.
  assert.equal((await t.req('POST', '/api/sessions/revoke-others', { cookie: a1.cookie })).statusCode, 403);
  t.advance(16 * MIN);
  const late = await t.req('POST', '/api/sessions/revoke-others', { cookie: a1.cookie, csrf: a1.csrf });
  assert.equal(late.statusCode, 403);
  assert.equal((late.json() as { reauth?: boolean }).reauth, true);
  t.cleanup();
});

test('ajustes: validação estrita, persistem por operador', async () => {
  const t = await setup();
  const a = await t.pair('Ana');
  const b = await t.pair('Beto', '10.0.4.2');
  const good = { limits: { bw: 100, sto: 4, hours: 'night' }, policies: { media: false, unknown: true, community: true } };
  assert.equal((await t.req('PUT', '/api/settings', { cookie: a.cookie, body: good })).statusCode, 403, 'sem CSRF');
  for (const bad of [
    { ...good, limits: { ...good.limits, bw: 1000 } },
    { ...good, limits: { ...good.limits, bw: '100' } },
    { ...good, extra: 1 },
    { ...good, policies: { ...good.policies, alerts: false } },
  ]) assert.equal((await t.req('PUT', '/api/settings', { cookie: a.cookie, csrf: a.csrf, body: bad })).statusCode, 400, JSON.stringify(bad));
  assert.equal((await t.req('PUT', '/api/settings', { cookie: a.cookie, csrf: a.csrf, body: good })).statusCode, 200);
  assert.deepEqual((await t.req('GET', '/api/settings', { cookie: a.cookie })).json(), good);
  assert.notDeepEqual((await t.req('GET', '/api/settings', { cookie: b.cookie })).json(), good, 'outro operador não é afetado');
  t.cleanup();
});

test('novo equipamento: campos validados, fica com o operador que criou', async () => {
  const t = await setup();
  const a = await t.pair('Ana');
  const b = await t.pair('Beto', '10.0.5.2');
  const body = { name: 'Roteador da varanda', cls: 'Home Node', family: 'router', pub: 'piu.varanda-4' };
  for (const bad of [{ ...body, cls: 'Admin' }, { ...body, pub: 'piu.Ab' }, { ...body, pub: 'piu.-x' }, { ...body, name: '' }, { ...body, ownerId: 'x' }])
    assert.equal((await t.req('POST', '/api/devices', { cookie: a.cookie, csrf: a.csrf, body: bad })).statusCode, 400, JSON.stringify(bad));
  const r = await t.req('POST', '/api/devices', { cookie: a.cookie, csrf: a.csrf, body });
  assert.equal(r.statusCode, 201);
  const id = (r.json() as { id: string }).id;
  assert.ok((await t.req('GET', '/api/devices', { cookie: a.cookie })).json().some((d: { id: string }) => d.id === id));
  assert.ok(!(await t.req('GET', '/api/devices', { cookie: b.cookie })).json().some((d: { id: string }) => d.id === id));
  assert.equal((await t.req('DELETE', `/api/devices/${id}`, { cookie: b.cookie, csrf: b.csrf })).statusCode, 404, 'IDOR');
  t.cleanup();
});

test('transferência para outro endereço: formato LUNES validado', async () => {
  const t = await setup();
  const a = await t.pair('Ana');
  const send = (to: unknown) => t.req('POST', '/api/wallet/transfer', { cookie: a.cookie, csrf: a.csrf, body: { amount: 1, to } });
  for (const bad of ['lunes:0OIl', 'lunes:', 'bitcoin:3P8xK2mVt9abcdefghijkmnopqr', 'lunes:3P8xK2mVt9abcdefghijkmnopqr<script>', 42])
    assert.equal((await send(bad)).statusCode, 400, String(bad));
  const ok = await send('lunes:3P8xK2mVt9abcdefghijkmnopqrsQ7nM');
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { to: string }).to, 'lunes:3P8xK2mVt9abcdefghijkmnopqrsQ7nM');
  assert.equal((await send('personal')).statusCode, 200);
  t.cleanup();
});

test('parear de novo com o mesmo nome volta à mesma conta (equipamentos continuam)', async () => {
  const t = await setup();
  const a = await t.pair('Cardeal');
  const devs = (await t.req('GET', '/api/devices', { cookie: a.cookie })).json() as { id: string }[];
  assert.ok(devs.length > 0);
  const again = await t.pair('cardeal', '10.0.6.2');
  assert.equal((again.body as { operator: { id: string } }).operator.id, (a.body as { operator: { id: string } }).operator.id);
  assert.deepEqual(((await t.req('GET', '/api/devices', { cookie: again.cookie })).json() as { id: string }[]).map(d => d.id), devs.map(d => d.id));
  const other = await t.pair('Outra pessoa', '10.0.6.3');
  assert.notEqual((other.body as { operator: { id: string } }).operator.id, (a.body as { operator: { id: string } }).operator.id);
  t.cleanup();
});
