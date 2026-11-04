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

/**
 * Imita as rotas de provider do piu-node (apps/piu-node/src/app.ts): regras, revogação, vizinhos por
 * endereço, carteira e declaração do lote, com o step-up (`/api/reauth`) que o nó exige.
 */
function providerNode() {
  const log: NodeRequest[] = [];
  const base = 'https://piu-node.local:8420';
  let stepUp = false;
  let lunes: string | null = null;
  const devices: Record<string, unknown>[] = [
    { id: 'd-self', name: 'Galpão', cls: 'Home Node', status: 'active', self: true },
    { id: 'd-viz', name: 'Vizinho', cls: 'Home Node', status: 'active', self: false, nodeId: 'ab'.repeat(8) },
    { id: 'd-reg', name: 'Registro', cls: 'Ponto de Acesso', status: 'active', self: false },
  ];
  let peers = [{ address: '192.168.0.12:8422', source: 'config', state: 'connected', error: null as string | null, errorAt: null as number | null, nodeId: 'cd'.repeat(8) as string | null, pk: 'cd'.repeat(32) as string | null, since: 1 as number | null, attempts: 1 }];
  const claims: { epoch: string; address: string; at: number }[] = [];
  const send = async (r: NodeRequest) => {
    log.push(r);
    const path = r.url.slice(base.length);
    const json = (s: number, b?: unknown) => ({ status: s, headers: { 'content-type': 'application/json' }, body: b === undefined ? '' : JSON.stringify(b) });
    if (r.headers.Cookie !== `${SESSION_COOKIE}=tok123`) return json(401, { error: 'Sessão necessária.' });
    if (r.method !== 'GET' && (r.headers.Origin !== base || r.headers['X-CSRF-Token'] !== 'csrf9')) return json(403, { error: 'Token CSRF inválido.' });
    const body = r.body ? JSON.parse(r.body) : undefined;
    const need = () => json(403, { error: 'Confirme com um código novo do equipamento.', reauth: true });
    if (r.method === 'POST' && path === '/api/reauth') { if (body.code !== '87654321') return json(401, { error: 'Código inválido ou expirado.' }); stepUp = true; return json(200, { ok: true }); }
    const lim = path.match(/^\/api\/devices\/([^/]+)\/limits$/);
    if (r.method === 'PUT' && lim) {
      const d = devices.find(x => x.id === lim[1]); if (!d) return json(404, { error: 'Não encontrado.' });
      if ('clear' in body) delete d.limits; else d.limits = body;
      return json(200, d);
    }
    const del = path.match(/^\/api\/devices\/([^/]+)$/);
    if (r.method === 'DELETE' && del) {
      const d = devices.find(x => x.id === del[1]); if (!d) return json(404, { error: 'Não encontrado.' });
      if (d.self) return json(409, { error: 'Este é o equipamento que serve o painel.' });
      devices.splice(devices.indexOf(d), 1);
      return d.nodeId ? json(200, { revoked: true, appliedHere: true }) : json(204);
    }
    if (path === '/api/relay/peers' && r.method === 'GET') return json(200, { enabled: true, max: 16, peers });
    if (path === '/api/relay/peers' && r.method === 'POST') {
      const p = { address: body.address, source: 'panel', state: 'failed', error: 'recusou a conexão', errorAt: 2, nodeId: null, pk: null, since: null, attempts: 1 };
      peers = [...peers, p]; return json(201, { peer: p });
    }
    const pd = path.match(/^\/api\/relay\/peers\/(.+)$/);
    if (r.method === 'DELETE' && pd) { const a = decodeURIComponent(pd[1]); if (!peers.some(p => p.address === a)) return json(404, { error: 'Não encontrado.' }); peers = peers.filter(p => p.address !== a); return json(204); }
    if (path === '/api/wallet') return json(200, { balance: 7.5, txs: [{ id: 't1', amount: 12.5, at: 10, to: 'provider', kind: 'in', from: 'lote 2026-S44' }, { id: 't2', amount: 5, at: 11, to: 'personal' }] });
    if (path === '/api/wallet/lunes' && r.method === 'GET') return json(200, { address: lunes, setAt: lunes ? 5 : null, explorer: 'x', endpoints: [], onchain: null, error: null, cached: false });
    if (path === '/api/wallet/lunes' && r.method === 'PUT') { if (!stepUp) return need(); lunes = body.address; return json(200, { address: lunes, setAt: 5 }); }
    if (path === '/api/wallet/lunes' && r.method === 'DELETE') { if (!stepUp) return need(); lunes = null; return json(204); }
    if (path === '/api/payout-claims' && r.method === 'GET') return json(200, { enabled: true, epochs: ['2026-S45', '2026-S46'], claims });
    if (path === '/api/payout-claims' && r.method === 'POST') { if (!stepUp) return need(); claims.push({ epoch: body.epoch, address: body.address, at: 9 }); return json(201, { enabled: true, epochs: ['2026-S45', '2026-S46'], claims }); }
    return json(404, { error: 'Não encontrado.' });
  };
  return { send, log, base };
}
const session = { token: 'tok123', csrf: 'csrf9', at: 0 };

test('9.3 regras do equipamento por PUT (e limpar), com CSRF e mesma origem', async () => {
  const n = providerNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send, session });
  const d = await api.setLimits('d-viz', { bw: 5, sto: 8, hours: 'night' });
  assert.deepEqual(d.limits, { bw: 5, sto: 8, hours: 'night' });
  const req = n.log.at(-1)!;
  assert.equal(req.method, 'PUT');
  assert.equal(req.headers.Origin, n.base);
  assert.equal(req.headers['X-CSRF-Token'], 'csrf9');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.equal((await api.setLimits('d-viz', null)).limits, undefined);
  assert.deepEqual(JSON.parse(n.log.at(-1)!.body!), { clear: true });
});

test('9.4 revogar por DELETE: resultado do nó (revoked, appliedHere), 204 sem identidade e recusa do próprio nó', async () => {
  const n = providerNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send, session });
  assert.deepEqual(await api.revoke('d-viz'), { revoked: true, appliedHere: true });
  assert.equal(n.log.at(-1)!.method, 'DELETE');
  assert.equal(n.log.at(-1)!.body, undefined, 'DELETE sem corpo');
  assert.deepEqual(await api.revoke('d-reg'), { revoked: false, appliedHere: false }, '204: só saiu da lista');
  await assert.rejects(api.revoke('d-self'), (e: unknown) => e instanceof NodeApiError && e.status === 409);
});

test('vizinhos por endereço: listar, adicionar (estado do handshake) e remover', async () => {
  const n = providerNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send, session });
  assert.equal((await api.peers()).peers.length, 1);
  const r = await api.addPeer(' 10.0.0.9:8422 ');
  assert.equal(r.peer?.state, 'failed');
  assert.deepEqual(JSON.parse(n.log.at(-1)!.body!), { address: '10.0.0.9:8422' });
  await api.removePeer('10.0.0.9:8422');
  assert.ok(n.log.at(-1)!.url.endsWith('/api/relay/peers/10.0.0.9%3A8422'), 'endereço codificado na rota');
  assert.equal((await api.peers()).peers.length, 1);
  await assert.rejects(api.removePeer('1.2.3.4:1'), /Não encontrado/);
});

test('9.6 carteira de provider e declaração do lote exigem step-up (reauth com código novo)', async () => {
  const n = providerNode();
  const api = new NodeApi({ base: n.base, pin: PIN, operator: 'Ana', send: n.send, session });
  const addr = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  await assert.rejects(api.setLunesAddress(addr), (e: unknown) => e instanceof NodeApiError && e.status === 403 && e.reauth);
  await assert.rejects(api.declareClaim('2026-S45', addr), (e: unknown) => e instanceof NodeApiError && e.reauth);
  await assert.rejects(api.reauth('123'), /8 dígitos/);
  await assert.rejects(api.reauth('11111111'), /Código inválido/);
  assert.ok(api.session, 'código errado no step-up não derruba a sessão');
  await api.reauth('87654321');
  assert.equal(n.log.at(-1)!.url, n.base + '/api/reauth');
  assert.deepEqual(await api.setLunesAddress(addr), { address: addr, setAt: 5 });
  assert.equal((await api.lunesWallet()).address, addr);
  const c = await api.declareClaim('2026-S45', addr);
  assert.deepEqual(c.claims.map(x => [x.epoch, x.address]), [['2026-S45', addr]]);
  assert.deepEqual((await api.claims()).epochs, ['2026-S45', '2026-S46']);
  await api.clearLunesAddress();
  assert.equal((await api.lunesWallet()).address, null);
  assert.equal((await api.wallet()).balance, 7.5);
});
