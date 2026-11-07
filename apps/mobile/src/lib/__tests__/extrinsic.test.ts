/// <reference types="node" />
/**
 * Etapa 2 da carteira própria: SCALE à mão (compact, era mortal, call, payload, extrinsic v4).
 * Bytes idênticos aos do @polkadot/types com a metadata da Lunes (walletFixture.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  additionalSigned, BALANCES_PALLET, buildTransferKeepAlive, compact, decodeCompact, decodeEra, decodeSignedTransfer, decodeTransferKeepAlive,
  encodeSignedExtrinsic, IMMORTAL_PERIOD, mortalEra, signedExtra, signingPayload, TRANSFER_KEEP_ALIVE, transferKeepAliveCall,
} from '../extrinsic';
import { extrinsicHash, fromHex, toHex } from '../lunesRpc';
import { walletKeyFromPhrase, wipe } from '../walletKey';
import {
  ADDITIONAL, BIG_CALL, BIG_PAYLOAD_HASH, CALL, COMPACTS, CTX, DEST, DEV_MNEMONIC, DEV_PUB, ERA, ERAS, EXTRA, EXTRINSIC, EXTRINSIC_HASH,
  PAYLOAD, RANDOM, SIG, VALUE,
} from './walletFixture';

const WORDS = DEV_MNEMONIC.split(' ');

test('compact: todas as faixas (1, 2, 4 bytes e big-integer até u128), igual ao Compact<u128>', () => {
  for (const [v, hex] of COMPACTS) {
    assert.equal(toHex(compact(BigInt(v))), hex, `compact(${v})`);
    const d = decodeCompact(fromHex(hex), 0);
    assert.equal(d.value, BigInt(v), `decodeCompact(${hex})`);
    assert.equal(d.length, fromHex(hex).length);
  }
  assert.equal(toHex(compact(142)), '0x3902', 'number também serve');
  assert.throws(() => compact(-1n), /negativo/);
  assert.throws(() => compact(2n ** 128n), /u128/);
  // decodeCompact com deslocamento e com entrada curta.
  assert.equal(decodeCompact(fromHex('0xff0284d717'), 1).value, 100_000_000n);
  assert.throws(() => decodeCompact(fromHex('0x02'), 0), /curto/);
});

test('era mortal: período arredondado para potência de 2, fase quantizada, igual ao ExtrinsicEra', () => {
  for (const [current, period, hex] of ERAS) {
    assert.equal(toHex(mortalEra(current, period)), hex, `mortalEra(${current}, ${period})`);
    const d = decodeEra(fromHex(hex));
    assert.equal(d.period, Math.min(65536, Math.max(4, 2 ** Math.ceil(Math.log2(period)))));
    assert.ok(d.phase <= d.period);
  }
  assert.deepEqual(decodeEra(fromHex(ERA)), { period: 64, phase: 7 });
  assert.equal(toHex(mortalEra(CTX.blockNumber)), ERA, 'padrão: período 64');
  assert.throws(() => mortalEra(-1), /bloco/);
});

test('call balances.transfer_keep_alive (pallet 4, índice 3) e sua decodificação', () => {
  assert.equal(BALANCES_PALLET, 4);
  assert.equal(TRANSFER_KEEP_ALIVE, 3);
  const call = transferKeepAliveCall(fromHex(DEST), VALUE);
  assert.equal(toHex(call), CALL);
  const d = decodeTransferKeepAlive(call);
  assert.ok(d);
  assert.equal(toHex(d.dest), DEST);
  assert.equal(d.value, VALUE);
  assert.equal(decodeTransferKeepAlive(fromHex('0x0400' + DEST.slice(2) + '00')), null, 'transfer (índice 0) não é keep_alive');
  assert.equal(decodeTransferKeepAlive(fromHex(CALL).slice(0, 10)), null, 'curto');
  assert.equal(decodeTransferKeepAlive(fromHex(CALL + '00')), null, 'sobra byte');
  assert.throws(() => transferKeepAliveCall(new Uint8Array(31), 1n), /32 bytes/);
  assert.throws(() => transferKeepAliveCall(fromHex(DEST), 0n), /maior que zero/);
});

test('extra e additional seguem as signed extensions da Lunes Mainnet (era ‖ nonce ‖ tip; spec ‖ tx ‖ gênese ‖ bloco)', () => {
  assert.equal(toHex(signedExtra(CTX)), EXTRA);
  assert.equal(toHex(additionalSigned(CTX)), ADDITIONAL);
  // tip opcional (padrão 0) e período opcional (padrão 64).
  const { tip: _t, period: _p, ...min } = CTX;
  assert.equal(toHex(signedExtra(min)), EXTRA);
  assert.equal(toHex(signedExtra({ ...CTX, tip: 1000n })), '0x75001c' + 'a10f', 'compact(1000) = 0xa10f');
  assert.throws(() => additionalSigned({ ...CTX, genesisHash: '0x12' }), /gênese/);
  assert.throws(() => additionalSigned({ ...CTX, blockHash: '0x12' }), /bloco/);
});

test('payload de assinatura: bytes crus até 256, blake2b-256 acima (igual ao ExtrinsicPayload v4)', () => {
  const p = signingPayload(fromHex(CALL), CTX);
  assert.equal(p.length, 115);
  assert.equal(toHex(p), PAYLOAD);
  const big = signingPayload(fromHex(BIG_CALL), CTX);
  assert.equal(big.length, 32);
  assert.equal(toHex(big), BIG_PAYLOAD_HASH);
});

test('extrinsic v4 assinado: bytes idênticos à fixture (compact(len) ‖ 0x84 ‖ Id ‖ Sr25519 ‖ extra ‖ call)', () => {
  const xt = encodeSignedExtrinsic(fromHex(DEV_PUB), fromHex(SIG), fromHex(EXTRA), fromHex(CALL));
  assert.equal(xt.length, 144);
  assert.equal(toHex(xt), EXTRINSIC);
  assert.equal(extrinsicHash(xt), EXTRINSIC_HASH);
  assert.throws(() => encodeSignedExtrinsic(new Uint8Array(31), fromHex(SIG), fromHex(EXTRA), fromHex(CALL)), /32 bytes/);
  assert.throws(() => encodeSignedExtrinsic(fromHex(DEV_PUB), new Uint8Array(63), fromHex(EXTRA), fromHex(CALL)), /64 bytes/);
});

test('buildTransferKeepAlive: da chave ao extrinsic, com random fixo reproduz a fixture inteira', () => {
  const k = walletKeyFromPhrase(WORDS);
  const tx = buildTransferKeepAlive(k, { dest: fromHex(DEST), value: VALUE, ctx: CTX, random: fromHex(RANDOM) });
  assert.equal(toHex(tx.call), CALL);
  assert.equal(toHex(tx.payload), PAYLOAD);
  assert.equal(toHex(tx.signature), SIG);
  assert.equal(tx.hex, EXTRINSIC);
  assert.equal(tx.hash, EXTRINSIC_HASH);
  assert.equal(tx.length, 144);
  assert.equal(tx.era.period, 64);
  assert.equal(tx.validUntil, CTX.blockNumber + 64, 'expira ao fim da era');
  // Sem random: bytes diferentes mas sempre válidos para o nó (assinatura confere com a pública).
  const tx2 = buildTransferKeepAlive(k, { dest: fromHex(DEST), value: VALUE, ctx: CTX });
  assert.notEqual(tx2.hex, EXTRINSIC);
  assert.equal(tx2.length, 144);
  assert.equal(toHex(tx2.payload), PAYLOAD);
  // Destino em SS58 também é aceito (57 ou 42).
  const tx3 = buildTransferKeepAlive(k, { dest: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', value: VALUE, ctx: CTX, random: fromHex(RANDOM) });
  assert.equal(tx3.hex, EXTRINSIC);
  assert.throws(() => buildTransferKeepAlive(k, { dest: 'xyz', value: VALUE, ctx: CTX }), /caracteres|tamanho/);
  wipe(k.secret);
});

test('era imortal (transação levada pela malha): 1 byte 0x00, bloco da era = gênese, sem prazo em blocos', () => {
  const ctx = { ...CTX, period: IMMORTAL_PERIOD, blockHash: CTX.genesisHash };
  assert.equal(toHex(signedExtra(ctx)), '0x001c00', 'era 0x00 ‖ compact(nonce 7) ‖ compact(tip 0)');
  assert.equal(toHex(additionalSigned(ctx)), '0x6b00000002000000' + CTX.genesisHash.slice(2) + CTX.genesisHash.slice(2));
  assert.deepEqual(decodeEra(fromHex('0x00')), { period: 0, phase: 0 });
  // A mortal nunca começa com o nibble baixo 0 (período ≥ 4): o 0x00 não é ambíguo.
  assert.notEqual(mortalEra(5, 4)[0]! & 15, 0);
  const key = walletKeyFromPhrase(WORDS);
  try {
    const s = buildTransferKeepAlive(key, { dest: fromHex(DEST), value: VALUE, ctx, random: fromHex(RANDOM) });
    assert.deepEqual(s.era, { period: 0, phase: 0 });
    assert.equal(s.validUntil, Number.MAX_SAFE_INTEGER, 'sem fim de era: só o nonce (ou uma troca de runtime) a invalida');
    assert.equal(s.hash, extrinsicHash(s.extrinsic));
    // Mesmo formato do extrinsic v4: só o byte da era muda de tamanho.
    assert.equal(s.length, fromHex(EXTRINSIC).length - 1);
  } finally { wipe(key.secret); }
  // Era imortal com outro bloco seria BadProof na Lunes (conferido em leitura ao vivo): recusada antes de assinar.
  assert.throws(() => additionalSigned({ ...CTX, period: IMMORTAL_PERIOD }), /gênese/);
});

test('decodeSignedTransfer: lê a transferência assinada (mortal e imortal) e recusa o resto', () => {
  const key = walletKeyFromPhrase(WORDS);
  try {
    for (const ctx of [CTX, { ...CTX, period: IMMORTAL_PERIOD, blockHash: CTX.genesisHash }]) {
      const s = buildTransferKeepAlive(key, { dest: fromHex(DEST), value: VALUE, ctx, random: fromHex(RANDOM) });
      const d = decodeSignedTransfer(s.extrinsic);
      assert.ok(d);
      assert.equal(toHex(d.signer), DEV_PUB);
      assert.equal(d.nonce, 7n); assert.equal(d.tip, 0n); assert.equal(d.value, VALUE);
      assert.equal(toHex(d.dest), DEST);
      assert.equal(d.era.period, ctx.period === IMMORTAL_PERIOD ? 0 : 64);
      assert.equal(decodeSignedTransfer(Uint8Array.of(...s.extrinsic, 0)), null, 'tamanho não bate');
      const unsigned = s.extrinsic.slice(); unsigned[2] = 0x04;
      assert.equal(decodeSignedTransfer(unsigned), null, 'não assinado');
    }
  } finally { wipe(key.secret); }
  assert.equal(decodeSignedTransfer(new Uint8Array(0)), null);
  assert.equal(decodeSignedTransfer(fromHex('0x0400')), null);
});
