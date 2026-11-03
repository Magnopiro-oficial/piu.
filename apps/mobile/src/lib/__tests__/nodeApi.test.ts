/// <reference types="node" />
/**
 * Provider no celular (mapa de regras, 9.1/9.4/9.5): cliente da API local do piu-node, com o
 * certificado fixado pela impressão digital, sessão pelo código do equipamento e pausa real.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePair } from '../approvals';
import { cookieValue, NodeApi, NodeApiError, nodeBaseUrl, type NodeRequest, normalizePin, SESSION_COOKIE } from '../nodeApi';

const PIN = 'AB:'.repeat(31) + 'AB';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Imita as regras do piu-node (apps/piu-node/src/app.ts): mesma origem, sessão e CSRF. */
function fakeNode() {
  const log: NodeRequest[] = [];
  let status = 'active';
  const base = 'https://piu-node.local:8420';
  const send = async (r: NodeRequest) => {
    log.push(r);
    if (r.pin !== PIN) throw new Error('A impressão digital do certificado não confere.');
    const path = r.url.slice(base.length);
    const cookie = r.headers.Cookie === `${SESSION_COOKIE}=tok123`;
    const json = (s: number, b: unknown, h: Record<string, string> = {}) => ({ status: s, headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
    if (r.method === 'POST' && r.headers.Origin !== base) return json(403, { error: 'Origem não permitida.' });
    if (path === '/api/pair') {
      const b = JSON.parse(r.body!);
      if (b.code !== '12345678') return json(401, { error: 'Código inválido ou expirado.' });
      return json(200, { operator: { id: 'op', name: b.name }, csrf: 'csrf9' }, { 'Set-Cookie': `${SESSION_COOKIE}=tok123; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Strict` });
    }
    if (!cookie) return json(401, { error: 'Sessão necessária. Pareie este navegador com o código do equipamento.' });
    if (r.method === 'POST' && r.headers['X-CSRF-Token'] !== 'csrf9') return json(403, { error: 'Token CSRF inválido.' });
    if (path === '/api/relay') return json(200, { enabled: true, relaying: status === 'active', paused: status === 'paused', neighbors: [{ id: 'aa', link: 'tcp' }], store: { envelopes: 3, bytes: 4096, maxBytes: 1 }, counters: { received: 9, stored: 3, forwarded: 7, delivered: 2, duplicates: 1, rejected: 0, receipts: 7 } });
    if (path === '/api/relay/receipts') return json(200, { enabled: true, kept: 7, keptOwn: 5, recent: [] });
    if (path === '/api/devices') return json(200, [{ id: 'd-self', name: 'Galpão', cls: 'Home Node', status, self: true }]);
    if (path === '/api/devices/d-self/pause') { status = status === 'paused' ? 'active' : 'paused'; return json(200, { id: 'd-self', status }); }
    return json(404, { error: 'Não encontrado.' });
  };
  return { send, log, base };
}

test('9.1 QR de pareamento: impressão digital e endereço opcionais (proposta f/u)', () => {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  const old = parsePair('piup:' + b64({ v: 1, i: 'p1', s: secret, n: 'piu-node.local', o: 'Ana' }));
  assert.equal(old.pin, undefined, 'QR atual: sem pino, o app não conecta');
  const fp = 'ab'.repeat(32);
  const novo = parsePair('piup:' + b64({ v: 1, i: 'p1', s: secret, n: 'piu-node.local', o: 'Ana', f: fp, u: 'https://192.168.0.10:8420' }));
  assert.equal(novo.pin, PIN);
  assert.equal(novo.url, 'https://192.168.0.10:8420');
  assert.equal(parsePair('piup:' + b64({ v: 1, i: 'p1', s: secret, n: 'x', f: 'curto', u: 'http://x' })).pin, undefined);
  assert.equal(normalizePin('ab'.repeat(32)), PIN);
  assert.equal(normalizePin('zz'), null);
  assert.equal(nodeBaseUrl({ node: 'piu-node.local' }), 'https://piu-node.local:8420', 'porta padrão');
  assert.equal(nodeBaseUrl({ node: 'x', url: 'https://10.0.0.2:9000' }), 'https://10.0.0.2:9000');
  assert.equal(nodeBaseUrl({ node: 'x', url: 'http://10.0.0.2' }), null, 'só HTTPS');
});

test('9.1 pareia com o código do equipamento, guarda a sessão e lê estado e recibos reais', async () => {
  const n = fakeNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send });
  await assert.rejects(api.relay(), (e: unknown) => e instanceof NodeApiError && e.status === 401);
  await assert.rejects(api.pair('00000000'), /Código inválido/);
  await assert.rejects(api.pair('123'), /8 dígitos/);
  const s = await api.pair('12345678');
  assert.deepEqual([s.token, s.csrf], ['tok123', 'csrf9']);
  const pairReq = n.log.find(r => r.url.endsWith('/api/pair'))!;
  assert.equal(pairReq.headers.Origin, n.base, 'mesma origem, como o navegador');
  assert.equal(JSON.parse(pairReq.body!).name, 'Ana', 'mesma conta do operador do QR');
  const relay = await api.relay();
  assert.equal(relay.counters?.forwarded, 7);
  assert.equal((await api.receipts()).keptOwn, 5);
  // Reabrir o app: a sessão guardada volta.
  const again = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send, session: s });
  assert.equal((await again.devices())[0].self, true);
});

test('9.4 pausar e retomar o equipamento com efeito real (CSRF e mesma origem)', async () => {
  const n = fakeNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send });
  await api.pair('12345678');
  assert.equal((await api.togglePause('d-self')).status, 'paused');
  assert.equal((await api.relay()).paused, true);
  const req = n.log.at(-2)!;
  assert.equal(req.headers['X-CSRF-Token'], 'csrf9');
  assert.equal(req.headers.Origin, n.base);
  assert.equal((await api.togglePause('d-self')).status, 'active');
});

test('9.1 certificado diferente do pino: nada é enviado de volta como sucesso', async () => {
  const n = fakeNode();
  const api = new NodeApi({ base: n.base, pin: 'CD:'.repeat(31) + 'CD', operator: 'Ana', send: n.send });
  await assert.rejects(api.pair('12345678'), /impressão digital/);
});

test('cookie da sessão lido do Set-Cookie (vários cookies, caixa diferente)', () => {
  assert.equal(cookieValue({ 'set-cookie': `a=1; Path=/, ${SESSION_COOKIE}=xyz; HttpOnly` }, SESSION_COOKIE), 'xyz');
  assert.equal(cookieValue({ 'Set-Cookie': `${SESSION_COOKIE}=; Max-Age=0` }, SESSION_COOKIE), null);
});
