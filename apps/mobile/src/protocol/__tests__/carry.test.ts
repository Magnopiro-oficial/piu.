/// <reference types="node" />
/**
 * Carga pela malha até um gateway (protocol/carry.ts; docs/carteira/transacoes-pela-malha.md):
 * formato, privacidade no fio, recibo de volta, compatibilidade com nós antigos e o pacote selado.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHex } from '../bytes';
import {
  BundleKind, bundleRefHex, CarryChain, CarryKind, CarryLimiter, decodeCarryItem, decodeCarryReceipt, encodeCarryItem, encodeCarryReceipt,
  GATEWAY_INBOX_IDENTITY, GATEWAY_TX_IDENTITY, gatewayKindOf, isGatewayBound, MAX_BUNDLE_BYTES, MAX_CARRIED_TX_BYTES, openBundle, openCarry, openCarryReceipt, returnIdentity, sealBundle,
  sealCarry, sealCarryReceipt,
} from '../carry';
import { HOP_OFFSET, MsgType, openDirect, parseHeader, sealDirect } from '../envelope';
import { deriveIdentity, deriveNodeKey, newSeed } from '../keys';
import { validatorProofKey } from '../proof';
import { Router } from '../router';
import { random } from '../suite';

const NOW = 1_800_000_000;
const xt = () => Uint8Array.from({ length: 145 }, (_, i) => (i * 7) & 255);
const has = (hay: Uint8Array, needle: Uint8Array) => toHex(hay).includes(toHex(needle));

test('carga de transação: o gateway abre, confere e sabe para quem responder', () => {
  const s = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt() }, now: NOW });
  assert.ok(isGatewayBound(s.bytes));
  assert.equal(parseHeader(s.bytes).expiresAt, NOW + 7 * 86400, 'vive o máximo de um envelope (7 dias)');
  const o = openCarry(s.bytes, NOW + 60);
  assert.ok(o);
  assert.equal(o.item.kind, CarryKind.Tx);
  assert.deepEqual(o.item.kind === CarryKind.Tx && o.item.extrinsic, xt());
  assert.deepEqual(o.replyTo.agreePk, returnIdentity(s.returnSeed).agreePk, 'responde para a identidade descartável');
  // Qualquer byte alterado (menos os saltos) invalida.
  const bad = s.bytes.slice(); bad[bad.length - 5] ^= 1;
  assert.equal(openCarry(bad, NOW), null);
  const hop = s.bytes.slice(); hop[HOP_OFFSET] = 2;
  assert.ok(openCarry(hop, NOW), 'saltos mudam no caminho');
  assert.equal(openCarry(s.bytes, NOW + 8 * 86400), null, 'vencida');
});

test('privacidade: nenhuma chave de mensagens da pessoa vai no fio; cada carga tem outra identidade', () => {
  const seed = newSeed();
  const pub = deriveIdentity(seed, 'public'), anon = deriveIdentity(seed, 'anon');
  const item = { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt() } as const;
  const a = sealCarry({ item, now: NOW }), b = sealCarry({ item, now: NOW });
  for (const k of [pub.signPk, pub.agreePk, anon.signPk, anon.agreePk, deriveNodeKey(seed).pk]) {
    assert.ok(!has(a.bytes, k), 'chave da pessoa não aparece nos bytes');
    // Nem dentro (quem abre é qualquer um que tenha a chave pública do gateway).
    assert.ok(!has(openDirect(a.bytes, GATEWAY_TX_IDENTITY, NOW)!.body, k));
  }
  assert.notDeepEqual(openCarry(a.bytes, NOW)!.replyTo.signPk, openCarry(b.bytes, NOW)!.replyTo.signPk, 'duas cargas não se ligam pelo remetente');
  assert.notEqual(a.id, b.id);
});

test('recibo: só a identidade descartável abre; o gateway e terceiros não', () => {
  const s = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt() }, now: NOW });
  const o = openCarry(s.bytes, NOW)!;
  const ref = random(32), bh = random(32);
  const r = sealCarryReceipt(o.replyTo, { about: CarryKind.Tx, ref, status: 'finalized', block: { number: 13_327_600, hash: bh, index: 2 }, reason: 'ok' }, NOW + 30);
  assert.ok(!isGatewayBound(r.bytes), 'o recibo não volta para os gateways');
  const got = openCarryReceipt(r.bytes, returnIdentity(s.returnSeed), NOW + 40);
  assert.deepEqual(got, { about: CarryKind.Tx, ref, status: 'finalized', block: { number: 13_327_600, hash: bh, index: 2 }, reason: 'ok' });
  assert.equal(openCarryReceipt(r.bytes, GATEWAY_TX_IDENTITY, NOW), null);
  assert.equal(openCarryReceipt(r.bytes, deriveIdentity(newSeed(), 'anon'), NOW), null);
  assert.equal(openCarry(r.bytes, NOW), null, 'recibo não é carga');
});

test('nó antigo (sem a chave do gateway): guarda e repassa como envelope de terceiros, sem abrir', () => {
  const old = new Router({ node: deriveNodeKey(newSeed()), identities: [deriveIdentity(newSeed(), 'public')], relay: true });
  const s = sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt() }, now: NOW });
  assert.equal(old.ingest(s.bytes, 'vizinho', NOW).status, 'stored');
  assert.equal(old.outgoing('outro', 'ble', NOW).length, 1);
  assert.equal(old.inbox.length, 0);
  const off = new Router({ node: deriveNodeKey(newSeed()), identities: [], relay: false });
  assert.equal(off.ingest(s.bytes, 'vizinho', NOW).status, 'relay-off', 'Modo nó desligado: não guarda');
  // Gateway: o roteador com a identidade do gateway entrega (e não repassa adiante).
  const gw = new Router({ node: deriveNodeKey(newSeed()), identities: [GATEWAY_TX_IDENTITY], relay: true });
  const r = gw.ingest(s.bytes, 'vizinho', NOW);
  assert.equal(r.status, 'delivered');
  assert.equal(r.status === 'delivered' && r.message.type, MsgType.Carry);
  // Gateway sem caixa do validador: o pacote de evidências segue adiante (outro gateway entrega).
  const sealed = sealBundle(BundleKind.Evidence, '{}', validatorProofKey(random(32)).pk);
  const ev = sealCarry({ item: { kind: CarryKind.Evidence, sealed }, now: NOW });
  assert.equal(gatewayKindOf(ev.bytes), CarryKind.Evidence);
  assert.equal(gw.ingest(ev.bytes, 'vizinho', NOW).status, 'stored');
  const inbox = new Router({ node: deriveNodeKey(newSeed()), identities: [GATEWAY_INBOX_IDENTITY], relay: true });
  assert.equal(inbox.ingest(ev.bytes, 'vizinho', NOW).status, 'delivered');
});

test('identidade comum não aceita tipo Carry como sessão; tipos fora da faixa continuam recusados', () => {
  const me = deriveIdentity(newSeed(), 'public'), other = deriveIdentity(newSeed(), 'public');
  const e = sealDirect({ from: other, to: me, type: MsgType.Carry, body: new Uint8Array(3), now: NOW });
  const m = openDirect(e.bytes, me, NOW);
  assert.equal(m?.type, MsgType.Carry, 'abre, mas o mensageiro só trata Carry vindo para gateway/identidade descartável');
  const six = sealDirect({ from: other, to: me, type: 6 as MsgType, body: new Uint8Array(3), now: NOW });
  assert.equal(openDirect(six.bytes, me, NOW), null);
});

test('limites de tamanho e formato estrito', () => {
  assert.throws(() => encodeCarryItem({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: new Uint8Array(MAX_CARRIED_TX_BYTES + 1) }), /grande/);
  assert.throws(() => encodeCarryItem({ kind: CarryKind.Evidence, sealed: new Uint8Array(MAX_BUNDLE_BYTES + 1) }), /grande/);
  const ok = encodeCarryItem({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: xt() });
  assert.ok(decodeCarryItem(ok));
  assert.equal(decodeCarryItem(Uint8Array.of(...ok, 0)), null, 'byte a mais');
  assert.equal(decodeCarryItem(ok.slice(0, -1)), null, 'truncado');
  const wrongChain = ok.slice(); wrongChain[2] = 9;
  assert.equal(decodeCarryItem(wrongChain), null, 'rede desconhecida');
  const v2 = ok.slice(); v2[0] = 2;
  assert.equal(decodeCarryItem(v2), null, 'versão futura');
  const rc = encodeCarryReceipt({ about: CarryKind.Evidence, ref: random(32), status: 'accepted' });
  assert.ok(decodeCarryReceipt(rc));
  const badStatus = rc.slice(); badStatus[35] = 77;
  assert.equal(decodeCarryReceipt(badStatus), null);
  assert.equal(decodeCarryReceipt(Uint8Array.of(...rc, 1)), null);
  assert.equal(decodeCarryReceipt(encodeCarryReceipt({ about: CarryKind.Tx, ref: random(32), status: 'error', reason: 'x'.repeat(500) }))!.reason!.length, 120);
});

test('pacote para o validador: selado para a chave dele, relays e gateways não leem', () => {
  const v = validatorProofKey(random(32)), other = validatorProofKey(random(32));
  const json = JSON.stringify({ v: 2, receipts: [], proofs: [], sealedProofs: [] });
  const sealed = sealBundle(BundleKind.Evidence, json, v.pk);
  assert.ok(!new TextDecoder().decode(sealed).includes('receipts'));
  assert.deepEqual(openBundle(sealed, v), { kind: BundleKind.Evidence, json });
  assert.equal(openBundle(sealed, other), null);
  const bad = sealed.slice(); bad[60] ^= 1;
  assert.equal(openBundle(bad, v), null);
  assert.equal(bundleRefHex(sealed).length, 64);
  assert.throws(() => sealBundle(BundleKind.Registry, 'x'.repeat(MAX_BUNDLE_BYTES), v.pk), /grande/);
  // Leva numa carga como qualquer outra.
  const c = sealCarry({ item: { kind: CarryKind.Evidence, sealed }, now: NOW });
  const o = openCarry(c.bytes, NOW)!;
  // Pacote enviado ao destino de transações (ou o contrário) não vale.
  const crossed = sealDirect({ from: deriveIdentity(newSeed(), 'anon'), to: GATEWAY_TX_IDENTITY, type: MsgType.Carry, body: encodeCarryItem({ kind: CarryKind.Evidence, sealed }), now: NOW });
  assert.equal(openCarry(crossed.bytes, NOW), null);
  assert.equal(o.item.kind, CarryKind.Evidence);
  assert.deepEqual(o.item.kind === CarryKind.Evidence && openBundle(o.item.sealed, v)?.json, json);
});

test('limite de cargas por enlace: rajada, depois espera a reposição', () => {
  const l = new CarryLimiter(30, 3);
  assert.deepEqual([1, 2, 3, 4].map(() => l.take('a', NOW)), [true, true, true, false]);
  assert.equal(l.take('b', NOW), true, 'outro vizinho tem o próprio balde');
  assert.equal(l.take('a', NOW + 60), false, '30/h: 1 a cada 2 min');
  assert.equal(l.take('a', NOW + 120), true);
});
