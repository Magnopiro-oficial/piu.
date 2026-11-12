// Auditoria de 09/11/2026 (docs/seguranca/auditoria-2026-11-09.md, achados 8 e 9): item com assinatura
// inválida não pode anular nem ocupar o lugar de um item honesto, em nenhuma ordem de leitura.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAddress } from '@polkadot/util-crypto';
import { toHex } from '../src/protocol/bytes.js';
import { deriveNodeKey, newSeed } from '../src/protocol/keys.js';
import { derivePhoneOperatorKey, makePhoneExit, makePhoneRegistration } from '../src/protocol/phoneNode.js';
import { makeRelayReceipt } from '../src/protocol/receipts.js';
import { collectPhones } from '../src/phone-nodes.js';
import { makeCertJson, makeRotationJson, NodeRegistry } from '../src/registry.js';
import { epochEnd, epochStart, type EvidenceFile, toEvidence } from '../src/validator.js';
import { buildLedger, delivery, evidence, node, operatorKey, operators } from './v2-helpers.js';

const E1 = '2026-S40';
const AT = epochStart(E1) + 12 * 3600;
const NOW = epochEnd(E1) + 7 * 86400 + 60;
const states = (ev: EvidenceFile[]) => [...buildLedger(ev, [], NOW).entries()].map(x => [x.state, x.reason ?? ''] as const);

test('achado 8: recibo forjado (assinatura lixo) do mesmo (envelope, nó) não tira o crédito do honesto, nas duas ordens', () => {
  const n = node();
  const d = delivery([n], AT);
  const forged = { ...d.receipts[0]!, sig: new Uint8Array(64).fill(7) };
  const evil = toEvidence([forged]);
  assert.deepEqual(states([evidence([d]), evil]), [['validado', '']], 'honesto antes do forjado');
  assert.deepEqual(states([evil, evidence([d])]), [['validado', '']], 'forjado antes do honesto');
  // Forjado com outro conteúdo (horário trocado, assinatura copiada do honesto): também sem efeito.
  const moved = toEvidence([{ ...d.receipts[0]!, at: d.receipts[0]!.at + 3600 }]);
  assert.deepEqual(states([moved, evidence([d])]), [['validado', '']]);
  assert.deepEqual(states([evidence([d]), moved]), [['validado', '']]);
  // Sozinho, o forjado segue aparecendo no relatório (uma vez, por mais que se repita).
  assert.deepEqual(states([evil, moved, evil]), [['rejeitado', 'assinatura inválida']]);
  // Conflito continua valendo entre dois recibos validamente assinados e diferentes, com ou sem forjado junto.
  const twin = makeRelayReceipt(n, d.envelopeId, d.receipts[0]!.ackHash, AT + 3600);
  assert.deepEqual(states([evil, evidence([d], [twin])]), [['rejeitado', 'recibos conflitantes do mesmo nó']]);
});

test('achado 9: cópia do certificado com a mesma assinatura e campo trocado não suprime o certificado honesto', () => {
  const op = operatorKey();
  const n = deriveNodeKey(newSeed());
  const cert = makeCertJson(op, n.pk, 1000);
  const evil = { ...cert, nodePk: '00'.repeat(32) };
  for (const files of [[{ v: 1 as const, certs: [evil] }, { v: 1 as const, certs: [cert] }], [{ v: 1 as const, certs: [cert] }, { v: 1 as const, certs: [evil] }]]) {
    const reg = NodeRegistry.build([operators], files);
    assert.equal(reg.operatorOf(toHex(n.pk), 5000), toHex(op.pk));
    assert.equal(reg.stats.badCerts, 1);
  }
  // Cópia idêntica do certificado sem a cadeia de rotação, lida antes: os passos do honesto continuam valendo.
  const next = operatorKey(false);
  const rotated = { ...makeCertJson(next, n.pk, 2000), chain: [makeRotationJson(op, next.pk, 1500)] };
  const bare = { ...rotated, chain: [] };
  assert.equal(NodeRegistry.build([operators], [{ v: 1, certs: [bare] }, { v: 1, certs: [rotated] }]).operatorOf(toHex(n.pk), 5000), toHex(op.pk));
});

test('achado 9: registro e saída de celular com a mesma assinatura e campo trocado não suprimem os honestos', () => {
  const op = derivePhoneOperatorKey(newSeed());
  const wallet = encodeAddress(new Uint8Array(32).fill(5), 42);
  const bond = { txHash: '0x' + 'ab'.repeat(32), block: 10 };
  const reg = makePhoneRegistration(op, wallet, bond, new Uint8Array(64).fill(3));
  const evilReg = { ...reg, wallet: encodeAddress(new Uint8Array(32).fill(6), 42) };
  const exit = makePhoneExit(op, bond.txHash, AT);
  const evilExit = { ...exit, at: AT + 1 };
  for (const files of [[{ v: 1 as const, phones: [evilReg], exits: [evilExit] }, { v: 1 as const, phones: [reg], exits: [exit] }], [{ v: 1 as const, phones: [reg], exits: [exit] }, { v: 1 as const, phones: [evilReg], exits: [evilExit] }]]) {
    const c = collectPhones(files);
    assert.deepEqual(c.regs.get(toHex(op.pk)), [reg]);
    assert.deepEqual([...c.exits.values()], [AT]);
  }
  // Repetido válido continua entrando uma vez só.
  assert.equal(collectPhones([{ v: 1, phones: [reg, reg] }, { v: 1, phones: [reg] }]).regs.get(toHex(op.pk))!.length, 1);
});
