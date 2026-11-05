/**
 * "Assinar no celular": o nó monta o pedido de transferência com o contexto lido da Mainnet, o celular
 * pareado devolve o extrinsic assinado e o nó CONFERE (call, assinante, era/nonce, assinatura sr25519,
 * validação pelo runtime) antes de enviar e acompanhar até o bloco. O nó nunca tem a chave: nos testes,
 * o "celular" é a cópia de walletKey/extrinsic derivando `//piu-provider` da mnemônica pública de
 * desenvolvimento (sem fundos). RPC falso (lunes-fake.ts): nada vai à Mainnet.
 */
import assert from 'node:assert/strict';
import { executionEvents, SIGNING_METADATA } from './lunes-signing-fixture.js';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { buildTransferKeepAlive, type SigningContext } from '../src/lunes/extrinsic.js';
import { fromHex, toHex } from '../src/lunes/lunesRpc.js';
import { LunesReader } from '../src/lunes/reader.js';
import { CHECKED_RUNTIME, checkSignedExtrinsic, LunesSigner, SigningError, transferView } from '../src/lunes/signing.js';
import { deriveHard, walletKeyFromPhrase, wipe } from '../src/lunes/walletKey.js';
import { pairCode } from '../src/security/approval.js';
import { Pairing } from '../src/security/pairing.js';
import { Store } from '../src/store.js';
import { ALICE_57, extrinsicHashOf, type FakeChain, fakeConnect, hashOf, INVALID_BAD_PROOF, INVALID_PAYMENT, substrate } from './lunes-fake.js';
import { ALICE_PUB, CTX, DEV_ADDR_57, DEV_MNEMONIC, EXTRINSIC, EXTRINSIC_HASH, RANDOM, VALUE } from './wallet-fixture.js';

const HOST = 'piu-node.local:8420';
const config: Config = { port: 8420, host: '127.0.0.1', allowedHosts: [HOST], dataDir: '/nao-usado', panelDir: '/nao-usado', releasePubKey: null };

/** O que o celular faz: deriva `//piu-provider` da frase do backup, assina e zera o segredo. */
function phone(words = DEV_MNEMONIC.split(' ')) {
  const root = walletKeyFromPhrase(words);
  const key = deriveHard(root.secret, 'piu-provider');
  wipe(root.secret);
  return {
    address: key.address,
    publicKey: key.publicKey,
    sign: (dest: string, value: bigint, ctx: SigningContext) => buildTransferKeepAlive(key, { dest, value, ctx, random: fromHex(RANDOM) }).hex,
    signWithRoot: (dest: string, value: bigint, ctx: SigningContext) => buildTransferKeepAlive(walletKeyFromPhrase(words), { dest, value, ctx, random: fromHex(RANDOM) }).hex,
  };
}
const flip = (hex: string, byteFromEnd: number) => {
  const b = fromHex(hex); const i = b.length - byteFromEnd; b[i] = b[i]! ^ 1; return toHex(b);
};

// ── conferência pura, com a fixture conferida contra @polkadot/types ──────────
test('checkSignedExtrinsic: aceita o extrinsic da fixture e recusa cada adulteração com motivo claro', () => {
  const req = { from: DEV_ADDR_57, dest: ALICE_57, value: VALUE.toString(), ctx: { ...CTX, tip: undefined } };
  const ok = checkSignedExtrinsic(req, EXTRINSIC);
  assert.equal(ok.ok, true, (ok as { error?: string }).error);
  if (ok.ok) { assert.equal(ok.hash, EXTRINSIC_HASH); assert.equal(ok.length, 144); }

  const bad = (r: typeof req, hex: string, re: RegExp) => { const c = checkSignedExtrinsic(r, hex); assert.equal(c.ok, false); assert.match((c as { error: string }).error, re); };
  bad(req, '0x12', /curto|tamanho/i);
  bad(req, 'zz', /hex/i);
  bad(req, '0x' + EXTRINSIC.slice(4), /tamanho/i);
  bad(req, EXTRINSIC.replace('840046eb', '040046eb'), /assinado|versão/i);
  bad({ ...req, from: ALICE_57 }, EXTRINSIC, /assinante/i);
  bad({ ...req, value: (VALUE + 1n).toString() }, EXTRINSIC, /valor/i);
  bad({ ...req, dest: DEV_ADDR_57 }, EXTRINSIC, /destino/i);
  bad({ ...req, ctx: { ...req.ctx, nonce: 8 } }, EXTRINSIC, /nonce/i);
  bad({ ...req, ctx: { ...req.ctx, blockNumber: 1234568 } }, EXTRINSIC, /era/i);
  // Chave pública igual, contexto igual, mas a assinatura não bate (último byte do call trocado = valor; da assinatura = sig).
  bad(req, flip(EXTRINSIC, 60), /assinatura/i);
  bad({ ...req, ctx: { ...req.ctx, genesisHash: hashOf('outra') } }, EXTRINSIC, /assinatura/i);
  bad({ ...req, ctx: { ...req.ctx, specVersion: 108 } }, EXTRINSIC, /assinatura/i);
  // Call diferente do pedido (transfer em vez de transfer_keep_alive), mesmo que assinado: recusa.
  bad(req, EXTRINSIC.replace('0403' + '00d435', '0400' + '00d435'), /transfer_keep_alive/i);
});

test('CHECKED_RUNTIME é o conferido em extrinsic.ts (107/2); mudar exige reconferir as signed extensions', () => {
  assert.deepEqual(CHECKED_RUNTIME, { specVersion: 107, transactionVersion: 2 });
});

// ── fluxo completo pela API ─────────────────────────────────────────────────
async function setup(t: { after: (f: () => unknown) => void }, chain: FakeChain, o: { now?: () => number } = {}) {
  const pairing = new Pairing();
  const store = new Store(null);
  const c = substrate(chain);
  const connect = fakeConnect(c.handle).connect;
  const now = o.now ?? Date.now;
  const signer = new LunesSigner({ store, connect, now, timeoutMs: 500 });
  const lunes = new LunesReader({ connect, now });
  const app = await buildApp({ config, store, pairing, packages: [], packagesDir: '/nao-usado', lunes, lunesSigner: signer, now });
  t.after(() => app.close());
  const headers = { host: HOST, origin: `https://${HOST}` };
  const login = async (name: string) => {
    const p = await app.inject({ method: 'POST', url: '/api/pair', headers, payload: { code: pairing.issue(now()), name } });
    const cookie = String(p.headers['set-cookie']).split(';')[0]!;
    const h = { ...headers, cookie, 'x-csrf-token': (p.json() as { csrf: string }).csrf };
    return {
      h,
      get: (url: string) => app.inject({ method: 'GET', url, headers: { ...headers, cookie } }),
      post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: h, payload }),
      del: (url: string) => app.inject({ method: 'DELETE', url, headers: h }),
      setAddress: (address: string) => app.inject({ method: 'PUT', url: '/api/wallet/lunes', headers: h, payload: { address } }),
      pairPhone: async () => {
        const r = await app.inject({ method: 'POST', url: '/api/phones', headers: h, payload: { name: 'Celular' } });
        const { id } = r.json() as { id: string };
        const ph = store.phonesOf(store.owner()!.id).find(x => x.id === id)!;
        await app.inject({ method: 'POST', url: `/api/phones/${id}/confirm`, headers: h, payload: { code: pairCode(Buffer.from(ph.secret, 'base64url')) } });
      },
    };
  };
  return { app, store, pairing, chain: c, signer, login };
}
type Transfer = { id: string; status: string; from: string; dest: string; value: string; fee: string | null; ctx: SigningContext & { tip: string }; expiresAt: number; validUntil: number; txHash: string | null; block: { number: number; hash: string; index: number } | null; error: string | null; extrinsic: string | null };
const ctxOf = (tr: Transfer): SigningContext => ({ ...tr.ctx, tip: BigInt(tr.ctx.tip) });

test('API: pedido → celular assina → nó confere, valida, envia e acompanha até finalizar', async t => {
  let now = 1_700_000_000_000;
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, nonce: { [cel.address]: 3 }, extrinsics: {} };
  const { store, chain, signer, login } = await setup(t, fake, { now: () => now });
  const dona = await login('Dona');

  // Pré-condições: endereço configurado e celular pareado (quem mais assinaria?).
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).statusCode, 409);
  await dona.setAddress(cel.address);
  const noPhone = await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  assert.equal(noPhone.statusCode, 409);
  assert.match((noPhone.json() as { error: string }).error, /celular/i);
  await dona.pairPhone();

  // Entrada conferida no servidor.
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57.slice(0, -1) + 's', value: '1' })).statusCode, 400);
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '0' })).statusCode, 400);
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '1.5' })).statusCode, 400);
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: 100 })).statusCode, 400, 'planck em texto, não número');
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: cel.address, value: '1' })).statusCode, 400, 'para a própria conta não');

  // Sem step-up recente: pede código novo (como as transferências de hoje).
  store.sessionsOf(store.owner()!.id).forEach(s => { s.authAt = 0; });
  const noStep = await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  assert.equal(noStep.statusCode, 403);
  assert.equal((noStep.json() as { reauth: boolean }).reauth, true);
  store.sessionsOf(store.owner()!.id).forEach(s => { s.authAt = now; });

  const created = await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  assert.equal(created.statusCode, 201, created.body);
  const tr = created.json() as Transfer;
  assert.equal(tr.status, 'pending');
  assert.equal(tr.from, cel.address);
  assert.equal(tr.dest, ALICE_57);
  assert.equal(tr.value, '100000000');
  assert.equal(tr.fee, '144000', 'taxa estimada com um extrinsic do mesmo tamanho (assinatura zerada)');
  assert.deepEqual(tr.ctx, { specVersion: 107, transactionVersion: 2, genesisHash: hashOf('bloco 0'), blockHash: hashOf('bloco 500'), blockNumber: 500, nonce: 3, period: 64, tip: '0' });
  assert.equal(tr.expiresAt, now + 5 * 60_000);
  assert.equal(tr.validUntil, 564);
  assert.equal(tr.extrinsic, null, 'nada assinado ainda');
  assert.ok(!('operatorId' in tr));
  assert.equal(chain.submitted.length, 0);

  // Só um pedido em andamento por operador (o nonce é um só).
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '1' })).statusCode, 409);

  // O celular (sessão própria) lista os pendentes e recebe o contexto.
  const pend = (await dona.get('/api/wallet/lunes/transfers?status=pending')).json() as Transfer[];
  assert.deepEqual(pend.map(x => x.id), [tr.id]);
  assert.deepEqual((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json(), tr);

  // Adulterações: assinado por outra chave (a raiz da frase, não //piu-provider), valor trocado, assinatura corrompida.
  const ctx = ctxOf(tr);
  const wrongKey = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.signWithRoot(ALICE_57, 100_000_000n, ctx) });
  assert.equal(wrongKey.statusCode, 400);
  assert.match((wrongKey.json() as { error: string }).error, /assinante/i);
  const wrongValue = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_001n, ctx) });
  assert.match((wrongValue.json() as { error: string }).error, /valor/i);
  const good = cel.sign(ALICE_57, 100_000_000n, ctx);
  const corrupted = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: flip(good, 60) });
  assert.match((corrupted.json() as { error: string }).error, /assinatura/i);
  assert.equal(chain.submitted.length, 0, 'nada foi enviado');
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'pending', 'continua esperando a assinatura certa');

  // Assinatura certa: valida no runtime, envia, e o pedido passa a `submitted` com o hash.
  const sent = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  assert.equal(sent.statusCode, 202, sent.body);
  const sub = sent.json() as Transfer;
  assert.equal(sub.status, 'submitted');
  assert.equal(sub.txHash, extrinsicHashOf(good));
  assert.equal(sub.extrinsic, good);
  assert.deepEqual(chain.submitted, [good]);
  assert.ok(chain.calls.includes('state_call'), 'validateTransaction antes de enviar');
  // Reenviar o mesmo pedido: já não está pendente.
  assert.equal((await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good })).statusCode, 409);

  // Acompanhamento: ainda não entrou em bloco; depois entra no 503 (melhor), e finaliza quando o finalizado passa dele.
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'submitted');
  fake.extrinsics![503] = ['0x08aabb', good];
  fake.metadata = SIGNING_METADATA;
  fake.events = { 503: executionEvents([{ index: 1, success: true }]) };
  await signer.tick();
  const inBlock = (await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer;
  assert.equal(inBlock.status, 'in_block');
  assert.deepEqual(inBlock.block, { number: 503, hash: hashOf('bloco 503'), index: 1 });
  fake.finalized = 504;
  await signer.tick();
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'finalized');
  // Finalizado: dá para abrir outro pedido.
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '1' })).statusCode, 201);
  const all = (await dona.get('/api/wallet/lunes/transfers')).json() as Transfer[];
  assert.deepEqual(all.map(x => x.status), ['pending', 'finalized'], 'mais recente primeiro');

  // Outro operador não vê nem assina os pedidos da dona.
  const outra = await login('Outra pessoa');
  assert.deepEqual((await outra.get('/api/wallet/lunes/transfers')).json(), []);
  assert.equal((await outra.get(`/api/wallet/lunes/transfers/${tr.id}`)).statusCode, 404);
  assert.equal((await outra.post(`/api/wallet/lunes/transfers/${all[0]!.id}/signed`, { extrinsic: good })).statusCode, 404);
});

test('API: recusas honestas — runtime diferente do conferido, runtime inválido (BadProof/Payment), nó recusa o envio, expiração e cancelamento', async t => {
  let now = 1_700_000_000_000;
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, nonce: { [cel.address]: 0 }, extrinsics: {} };
  const { store, chain, signer, login } = await setup(t, fake, { now: () => now });
  const dona = await login('Dona');
  await dona.setAddress(cel.address);
  await dona.pairPhone();
  const create = () => dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });

  // Runtime mudou: não monta pedido (as signed extensions podem ter mudado).
  fake.runtime = { specVersion: 108, transactionVersion: 2 };
  const upg = await create();
  assert.equal(upg.statusCode, 409);
  assert.match((upg.json() as { error: string }).error, /runtime|specVersion/i);
  fake.runtime = undefined;

  // Validação pelo runtime falha: o pedido vira `failed` com o motivo, nada é enviado.
  fake.validity = INVALID_PAYMENT;
  let tr = (await create()).json() as Transfer;
  let bad = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  assert.equal(bad.statusCode, 422, bad.body);
  assert.match((bad.json() as { error: string }).error, /Payment/);
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'failed');
  assert.equal(chain.submitted.length, 0);
  fake.validity = INVALID_BAD_PROOF;
  tr = (await create()).json() as Transfer;
  bad = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  assert.match((bad.json() as { error: string }).error, /BadProof/);
  fake.validity = undefined;

  // Runtime mudou entre o pedido e a assinatura: recusa antes de enviar.
  tr = (await create()).json() as Transfer;
  fake.runtime = { specVersion: 107, transactionVersion: 3 };
  bad = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  assert.equal(bad.statusCode, 409);
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'failed');
  fake.runtime = undefined;

  // Erro depois de tentar enviar é ambíguo: um endpoint anterior pode ter aceitado e perdido a resposta.
  fake.submitError = 'Invalid Transaction: Inability to pay some fees (e.g. account balance too low)';
  tr = (await create()).json() as Transfer;
  bad = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  assert.equal(bad.statusCode, 202);
  assert.match((bad.json() as Transfer).error ?? '', /Inability to pay/);
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'signed');
  assert.equal((await create()).statusCode, 409);
  fake.finalized = 570;
  await signer.tick();
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'failed', 'sem inclusão após conferir a era finalizada');
  fake.submitError = undefined;

  // Pendente que ninguém assinou: expira em 5 min; assinar depois disso é recusado; cancelar antes funciona.
  tr = (await create()).json() as Transfer;
  now += 5 * 60_000 + 1;
  const late = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  assert.equal(late.statusCode, 409);
  assert.equal(((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer).status, 'expired');
  assert.deepEqual((await dona.get('/api/wallet/lunes/transfers?status=pending')).json(), []);
  tr = (await create()).json() as Transfer;
  assert.equal((await dona.del(`/api/wallet/lunes/transfers/${tr.id}`)).statusCode, 204);
  assert.equal((await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).statusCode, 404);

  // Enviado mas a era passou sem entrar em bloco: `failed` (reassinar com nonce/bloco novos).
  tr = (await create()).json() as Transfer;
  assert.equal((await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) })).statusCode, 202);
  fake.finalized += 70;
  await signer.tick();
  const gone = (await dona.get(`/api/wallet/lunes/transfers/${tr.id}`)).json() as Transfer;
  assert.equal(gone.status, 'failed');
  assert.match(gone.error ?? '', /era|bloco/i);
  // Cancelar o que já foi enviado não dá.
  assert.equal((await dona.del(`/api/wallet/lunes/transfers/${tr.id}`)).statusCode, 409);
  assert.equal(store.lunesTransfers(store.owner()!.id).length, 6, 'tudo (menos o cancelado) fica registrado no estado');
});

test('LunesSigner: Mainnet fora do ar ao montar o pedido → erro 503 honesto, nada registrado', async () => {
  const store = new Store(null);
  const c = substrate({ finalized: 1, storage: {} });
  const signer = new LunesSigner({ store, connect: fakeConnect(c.handle, ['wss://a', 'wss://b']).connect, endpoints: ['wss://a', 'wss://b'], timeoutMs: 200 });
  await assert.rejects(signer.create('op', DEV_ADDR_57, ALICE_57, 1n), (e: unknown) => e instanceof SigningError && e.status === 503 && /Lunes/.test(e.message));
  assert.deepEqual(store.lunesTransfers('op'), []);
  assert.equal(transferView({ id: 'x', operatorId: 'op' } as never).operatorId, undefined);
  assert.equal(ALICE_PUB.length, 66);
});

test('envio sem resposta: Stale não é falha definitiva; bloqueia novo pedido e reconcilia pelo hash', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, dropSubmitResponses: true, metadata: SIGNING_METADATA };
  const { signer, login, store, chain } = await setup(t, fake);
  const dona = await login('Dona');
  await dona.setAddress(cel.address); await dona.pairPhone();
  const create = () => dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  const tr = (await create()).json() as Transfer;
  const good = cel.sign(ALICE_57, 100_000_000n, ctxOf(tr));
  const sent = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  assert.equal(sent.statusCode, 503);
  assert.ok(chain.submitted.includes(good), 'servidor recebeu os bytes, mas não respondeu');
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'signed');
  assert.ok(store.lunesTransfer(tr.id)!.submitAttemptedAt, 'tentativa persistida antes de enviar');
  fake.dropSubmitResponses = false;
  fake.validity = '0x010003'; // Invalid(Stale): pode ter sido incluída depois da resposta perdida.
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'signed');
  assert.doesNotMatch(signer.get(tr.id, store.owner()!.id)!.error ?? '', /Nada foi enviado/);
  assert.equal((await create()).statusCode, 409, 'resultado incerto bloqueia novo pagamento');
  fake.extrinsics![503] = [good];
  fake.events = { 503: executionEvents([{ index: 0, success: true }]) };
  fake.finalized = 503;
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'finalized', 'reconcilia sem reassinar nem pagar de novo');
});

test('Already Imported preserva resultado incerto e bloqueio até encontrar execução finalizada', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, submitError: 'Transaction Already Imported', submitErrorCode: 1013, metadata: SIGNING_METADATA };
  const { signer, login, store } = await setup(t, fake);
  const dona = await login('Dona'); await dona.setAddress(cel.address); await dona.pairPhone();
  const tr = (await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).json() as Transfer;
  const good = cel.sign(ALICE_57, 100_000_000n, ctxOf(tr));
  const sent = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  assert.equal(sent.statusCode, 202);
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'signed');
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).statusCode, 409);
  fake.extrinsics![501] = [good]; fake.finalized = 501;
  fake.events = { 501: executionEvents([{ success: true }]) };
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'finalized');
});

test('ExtrinsicFailed finalizado não vira pagamento concluído; evento é do índice exato', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, metadata: SIGNING_METADATA };
  const { signer, login, store } = await setup(t, fake);
  const dona = await login('Dona'); await dona.setAddress(cel.address); await dona.pairPhone();
  const tr = (await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).json() as Transfer;
  const good = cel.sign(ALICE_57, 100_000_000n, ctxOf(tr));
  await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  fake.extrinsics![501] = ['0x08aabb', good];
  fake.events = { 501: executionEvents([{ index: 0, success: true }, { index: 1, success: false }]) };
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'in_block', 'falha em bloco reorganizável ainda não é definitiva');
  assert.equal((await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).statusCode, 409);
  fake.finalized = 501; await signer.tick();
  const result = signer.get(tr.id, store.owner()!.id)!;
  assert.equal(result.status, 'failed'); assert.match(result.error ?? '', /execução.*Other/);
  assert.equal(result.block!.index, 1);
});

test('execução desconhecida, inválida ou contraditória continua bloqueada até prova de sucesso', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, metadata: SIGNING_METADATA };
  const { signer, login, store } = await setup(t, fake);
  const dona = await login('Dona'); await dona.setAddress(cel.address); await dona.pairPhone();
  const create = () => dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  const tr = (await create()).json() as Transfer;
  const good = cel.sign(ALICE_57, 100_000_000n, ctxOf(tr));
  await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  fake.extrinsics![501] = [good]; fake.finalized = 501;
  const variants = [undefined, '0x01', executionEvents([{ index: 1, success: true }]), executionEvents([{ phase: 'Finalization', success: true }]), executionEvents([{ success: true }, { success: false }])];
  for (const events of variants) {
    fake.events = events ? { 501: events } : {};
    await signer.tick();
    assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'in_block');
    assert.match(signer.get(tr.id, store.owner()!.id)!.error ?? '', /não refaça/);
    assert.equal((await create()).statusCode, 409);
  }
  fake.events = { 501: executionEvents([{ success: true }]) }; await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'finalized');
});

test('failover: A aceita e perde resposta, B responde Payment; resultado continua incerto e bloqueado', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, dropSubmitResponses: 1, metadata: SIGNING_METADATA };
  fake.submitError = () => fake.dropSubmitResponses === 0 ? 'Invalid Transaction: Inability to pay some fees' : undefined;
  const { signer, login, store, chain } = await setup(t, fake);
  const dona = await login('Dona'); await dona.setAddress(cel.address); await dona.pairPhone();
  const create = () => dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' });
  const tr = (await create()).json() as Transfer;
  const good = cel.sign(ALICE_57, 100_000_000n, ctxOf(tr));
  const sent = await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: good });
  assert.equal(sent.statusCode, 202);
  assert.deepEqual(chain.submitted, [good], 'A aceitou; a resposta Payment veio apenas do endpoint B');
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'signed');
  assert.equal((await create()).statusCode, 409);
  fake.extrinsics![501] = [good]; fake.finalized = 501;
  fake.events = { 501: executionEvents([{ success: true }]) };
  await signer.tick();
  assert.equal(signer.get(tr.id, store.owner()!.id)!.status, 'finalized');
});

test('signed persistido de versão anterior sem marcador não vira falha ao receber Stale', async t => {
  const cel = phone();
  const fake: FakeChain = { finalized: 500, storage: {}, extrinsics: {}, submitError: 'Transaction Already Imported', submitErrorCode: 1013 };
  const { signer, login, store } = await setup(t, fake);
  const dona = await login('Dona'); await dona.setAddress(cel.address); await dona.pairPhone();
  const tr = (await dona.post('/api/wallet/lunes/transfers', { dest: ALICE_57, value: '100000000' })).json() as Transfer;
  await dona.post(`/api/wallet/lunes/transfers/${tr.id}/signed`, { extrinsic: cel.sign(ALICE_57, 100_000_000n, ctxOf(tr)) });
  delete store.lunesTransfer(tr.id)!.submitAttemptedAt; // formato de estado da versão anterior
  fake.submitError = undefined; fake.validity = '0x010003';
  await signer.tick();
  const result = signer.get(tr.id, store.owner()!.id)!;
  assert.equal(result.status, 'signed');
  assert.ok(result.submitAttemptedAt, 'migração conservadora persiste marcador');
  assert.match(result.error ?? '', /não refaça/);
});
