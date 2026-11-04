/// <reference types="node" />
/**
 * Leitura real da Lunes Mainnet: xxHash64/twox128, SS58, AccountInfo e o cliente JSON-RPC com troca
 * de endereço. Os vetores de hash e de endereço foram conferidos com @polkadot/util-crypto
 * (`xxhashAsHex`, `encodeAddress`, `blake2AsHex`) e com os vetores publicados do xxHash.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountBalance, chainInfo, checkSettlement, decodeAccountInfo, extrinsicHash, formatLunes, fromHex,
  LUNES_ENDPOINTS, LunesOffline, LunesRpc, planckToLunes, RpcError, systemAccountKey,
} from '../lunesRpc';
import { decodeSs58, encodeSs58, isLunesAddress } from '../ss58';
import { twox, twox128, xxh64 } from '../xxhash';
import { ALICE_42, ALICE_57, ALICE_PK, accountInfoHex, fakeSockets, hashOf, hex, substrateHandler } from './lunesFake';

const utf8 = (s: string) => new TextEncoder().encode(s);
const h = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('xxHash64: vetores publicados (semente 0) e entradas com mais de 32 bytes', () => {
  assert.equal(xxh64(utf8('')).toString(16), 'ef46db3751d8e999');
  assert.equal(xxh64(utf8('a')).toString(16), 'd24ec4f1a98c6e5b');
  assert.equal(xxh64(utf8('Nobody inspects the spammish repetition')).toString(16), 'fbcea83c8a378bf1');
  // 46 bytes: passa pelas 4 faixas de 32 bytes, pelo bloco de 8 e pelo de 4 e pelos bytes soltos.
  assert.equal(h(twox(utf8('abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'), 64)), '9150f9d922b6fd4e');
});

test('twox128: prefixos de armazenamento do Substrate', () => {
  assert.equal(h(twox128('System')), '26aa394eea5630e07c48ae0c9558cef7');
  assert.equal(h(twox128('Account')), 'b99d880ec681799c0cf30e8886371da9');
  assert.equal(h(twox128('Balances')), 'c2261276cc9d1f8598ea4b6a74b15c2f');
  assert.equal(h(twox128('TotalIssuance')), '57c875e4cff74148e4628f264b974c80');
});

test('SS58: aceita 57 (Lunes) e 42, recusa soma errada, outra rede e caracteres inválidos', () => {
  const a = decodeSs58(ALICE_42);
  assert.ok(a.ok);
  assert.equal(a.prefix, 42);
  assert.equal(h(a.publicKey), ALICE_PK);
  const b = decodeSs58(ALICE_57);
  assert.ok(b.ok && b.prefix === 57 && h(b.publicKey) === ALICE_PK);
  assert.equal(encodeSs58(fromHex(ALICE_PK)), ALICE_57, 'padrão: prefixo 57');
  assert.equal(encodeSs58(fromHex(ALICE_PK), 42), ALICE_42);
  assert.ok(isLunesAddress(`  ${ALICE_57} `), 'espaços nas pontas não importam');

  const typo = ALICE_57.slice(0, -1) + (ALICE_57.endsWith('r') ? 's' : 'r');
  const t = decodeSs58(typo);
  assert.ok(!t.ok && /soma de verificação/.test(t.error));
  const other = decodeSs58(encodeSs58(fromHex(ALICE_PK), 0));
  assert.ok(!other.ok && /outra rede \(prefixo 0\)/.test(other.error));
  assert.ok(!isLunesAddress(ALICE_57.replace(/.$/, '0')), '0 não existe em base58');
  assert.ok(!isLunesAddress(ALICE_57.slice(0, 20)));
  assert.ok(!isLunesAddress(''));
});

test('System.Account: chave de armazenamento da conta', () => {
  assert.equal(systemAccountKey(fromHex(ALICE_PK)),
    '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9' + 'de1e86a9a8c739864cf3cc5ec2bea59f' + ALICE_PK);
});

test('AccountInfo: formato atual (frozen/flags) e antigo (misc_frozen/fee_frozen)', () => {
  const now = decodeAccountInfo(fromHex(accountInfoHex({ nonce: 3, free: 1_234_567_890_123n, reserved: 500n, frozen: 10n })));
  assert.deepEqual(now, { nonce: 3, consumers: 1, providers: 1, sufficients: 0, free: 1_234_567_890_123n, reserved: 500n, frozen: 10n, layout: 'frozen' });
  // Gerado com @polkadot/types `AccountInfoWithTripleRefCount` (nonce 7, free 123456789012, reserved 500).
  const old = decodeAccountInfo(fromHex('0x07000000010000000100000000000000141a99be1c0000000000000000000000f40100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'));
  assert.equal(old.layout, 'misc_fee');
  assert.equal(old.nonce, 7);
  assert.equal(old.free, 123_456_789_012n);
  assert.equal(old.reserved, 500n);
  assert.equal(old.frozen, 0n);
  assert.throws(() => decodeAccountInfo(new Uint8Array(33)), /Formato de conta desconhecido/);
});

test('valores: 8 casas, sem arredondar para cima', () => {
  assert.equal(formatLunes(123_456_789_012n), '1.234,56789012');
  assert.equal(formatLunes(0n), '0,00');
  assert.equal(formatLunes(150_000_000n), '1,50');
  assert.equal(formatLunes(500n), '0,000005');
  assert.equal(formatLunes(199_999_999n, 2), '1,99');
  assert.equal(planckToLunes(123_456_789_012n), 1234.56789012);
});

const ALICE_KEY = systemAccountKey(fromHex(ALICE_PK));
const chain = () => substrateHandler({ finalized: 4_200_000, best: 4_200_002, storage: { [ALICE_KEY]: accountInfoHex({ nonce: 2, free: 2_550_000_000n }) } });

test('RPC: endereços de produção na ordem confirmada', () => {
  assert.deepEqual(LUNES_ENDPOINTS, ['wss://ws.lunes.io', 'wss://ws-lunes-main-01.lunes.io', 'wss://ws-lunes-main-02.lunes.io', 'wss://ws-archive.lunes.io']);
});

test('RPC: saldo no bloco finalizado, com o endereço que respondeu', async () => {
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, chain());
  const rpc = new LunesRpc({ connect: f.connect });
  const b = await accountBalance(rpc, ALICE_57);
  rpc.close();
  assert.equal(b.free, 2_550_000_000n);
  assert.equal(b.exists, true);
  assert.equal(b.block, 4_200_000);
  assert.equal(b.blockHash, hashOf('bloco 4200000'));
  assert.equal(b.endpoint, 'wss://ws.lunes.io');
  // Lido no bloco finalizado (não no melhor, que ainda pode mudar).
  const st = f.log.find(x => x.method === 'state_getStorage')!;
  assert.deepEqual(st.params, [ALICE_KEY, hashOf('bloco 4200000')]);
  // Ids únicos e crescentes.
  const ids = f.log.map(x => x.id);
  assert.deepEqual(ids, [...ids].sort((a, c) => a - c));
  assert.equal(new Set(ids).size, ids.length);
});

test('RPC: conta sem nada no estado tem saldo 0 (não é erro)', async () => {
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, substrateHandler({ finalized: 10, best: 10, storage: {} }));
  const rpc = new LunesRpc({ connect: f.connect });
  const b = await accountBalance(rpc, ALICE_42);
  rpc.close();
  assert.equal(b.exists, false);
  assert.equal(b.free, 0n);
  await assert.rejects(accountBalance(new LunesRpc({ connect: f.connect }), 'xyz'), /caracteres|tamanho/);
});

test('RPC: troca de endereço quando um cai, não abre ou fica mudo', async () => {
  const f = fakeSockets({ 'wss://ws.lunes.io': 'down', 'wss://ws-lunes-main-01.lunes.io': 'silent', 'wss://ws-lunes-main-02.lunes.io': 'drop-after-open', 'wss://ws-archive.lunes.io': 'ok' }, chain());
  const rpc = new LunesRpc({ connect: f.connect, timeoutMs: 50 });
  const info = await chainInfo(rpc);
  assert.equal(rpc.endpoint, 'wss://ws-archive.lunes.io');
  assert.deepEqual(f.opened, [...LUNES_ENDPOINTS]);
  assert.equal(info.chain, 'Cadeia de teste');
  assert.equal(info.specVersion, 107);
  assert.equal(info.best, 4_200_002);
  assert.equal(info.finalized, 4_200_000);
  assert.equal(info.genesisHash, hashOf('bloco 0'));
  // Continua no que respondeu: a próxima chamada não reabre os outros.
  await rpc.call('system_chain');
  assert.equal(f.opened.length, 4);
  rpc.close();
});

test('RPC: nenhum endereço responde → LunesOffline com o motivo de cada um', async () => {
  const f = fakeSockets({}, chain());
  const rpc = new LunesRpc({ connect: f.connect, timeoutMs: 50 });
  await assert.rejects(rpc.call('system_chain'), (e: unknown) => e instanceof LunesOffline && /ws\.lunes\.io: não conectou/.test(e.message) && /ws-archive\.lunes\.io/.test(e.message));
});

test('RPC: erro do nó não troca de endereço; respostas fora de ordem casam pelo id', async () => {
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok', 'wss://ws-lunes-main-01.lunes.io': 'ok' }, chain(), { latencyMs: m => (m === 'system_chain' ? 30 : 1) });
  const rpc = new LunesRpc({ connect: f.connect });
  await assert.rejects(rpc.call('metodo_inexistente'), (e: unknown) => e instanceof RpcError && e.code === -32601);
  assert.deepEqual(f.opened, ['wss://ws.lunes.io']);
  const [a, b] = await Promise.all([rpc.call<string>('system_chain'), rpc.call<string>('chain_getFinalizedHead')]);
  assert.equal(a, 'Cadeia de teste');
  assert.equal(b, hashOf('bloco 4200000'));
  rpc.close();
});

test('lote liquidado: bloco existe, é canônico e finalizado, e a transação está nele', async () => {
  // Extrínsecos com prefixo de tamanho (compacto SCALE): 0x0c = 3 bytes.
  const tx = '0x0c010203';
  const other = '0x08aabb';
  const f = fakeSockets({ 'wss://ws.lunes.io': 'ok' }, substrateHandler({ finalized: 100, best: 102, storage: {}, extrinsics: { 99: [other, tx], 101: [tx] } }));
  const rpc = new LunesRpc({ connect: f.connect });
  const txHash = extrinsicHash(fromHex(tx));
  assert.equal(txHash, '0xcafaf4adaf3920beca6db486d8ee24759066fcc25bd7953e2a4bd4f71c36f9cd', 'BLAKE2b-256, igual ao @polkadot');
  assert.deepEqual(await checkSettlement(rpc, { blockHash: hashOf('bloco 99'), txHash }), { blockFound: true, blockNumber: 99, finalized: true, txIndex: 1, endpoint: 'wss://ws.lunes.io' });
  // Depois do finalizado: existe mas ainda pode mudar.
  assert.equal((await checkSettlement(rpc, { blockHash: hashOf('bloco 101') })).finalized, false);
  // Transação que não está no bloco.
  assert.equal((await checkSettlement(rpc, { blockHash: hashOf('bloco 99'), txHash: hex(new Uint8Array(32)) })).txIndex, -1);
  // Bloco que o nó não conhece.
  assert.deepEqual(await checkSettlement(rpc, { blockHash: hashOf('outra cadeia') }), { blockFound: false, blockNumber: null, finalized: false, txIndex: null, endpoint: 'wss://ws.lunes.io' });
  await assert.rejects(checkSettlement(rpc, { blockHash: '0x12' }), /Hash de bloco inválido/);
  rpc.close();
});
