/// <reference types="node" />
/** Textos e números das telas de provider a partir das respostas do piu-node (9.3–9.6). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeApiError, type PeerView } from '../nodeApi';
import {
  addPeerMessage, claimNote, epochLabel, LIMIT_BW, LIMIT_HOURS, LIMIT_STO, limitsLabel, limitsNote, looksLikePeerAddress, lunesWalletLine, needsReauth, nodeEarnings,
  peerConfirmCode, peerLine, revokeMessage,
} from '../providerCore';

const peer = (p: Partial<PeerView> = {}): PeerView => ({ address: '10.0.0.2:8422', source: 'panel', state: 'connected', error: null, errorAt: null, nodeId: 'ab'.repeat(8), pk: 'ab'.repeat(32), since: 1, attempts: 1, ...p });

test('9.3 regras: as mesmas opções do nó e onde valem', () => {
  assert.deepEqual(LIMIT_BW.map(o => o.value), [5, 20, 50]);
  assert.deepEqual(LIMIT_STO.map(o => o.value), [1, 4, 8]);
  assert.deepEqual(LIMIT_HOURS.map(o => o.value), ['always', 'night', 'day']);
  assert.equal(limitsLabel({ bw: 5, sto: 1, hours: 'night' }), '5 Mbps · 1 GB · 22h–7h');
  assert.equal(limitsLabel(undefined), 'sem regras próprias');
  assert.match(limitsNote({ self: true, limits: { bw: 5, sto: 1, hours: 'day' } }), /Valem neste nó agora/);
  assert.match(limitsNote({ self: false, limits: { bw: 5, sto: 1, hours: 'day' } }), /Ficam registradas/);
  assert.match(limitsNote({ self: false }), /limites globais/);
});

test('9.4 revogar: texto do resultado real', () => {
  assert.match(revokeMessage('X', { revoked: true, appliedHere: true }).body, /Vale neste nó agora/);
  assert.match(revokeMessage('X', { revoked: true, appliedHere: false }).body, /quando chegar ao nó do dono/);
  assert.equal(revokeMessage('X', { revoked: false, appliedHere: false }).title, 'Equipamento removido');
});

test('vizinhos: código de confirmação do enlace, estado e endereço', () => {
  const nb = [{ id: 'ab'.repeat(8), pk: 'ab'.repeat(32), link: 'tcp', confirmCode: '123456' }, { id: 'cd'.repeat(8), link: 'tcp', confirmCode: null }];
  assert.equal(peerConfirmCode(peer(), nb), '123456');
  assert.equal(peerConfirmCode(peer({ pk: null }), nb), '123456', 'pelo id do nó');
  assert.equal(peerConfirmCode(peer({ state: 'connecting' }), nb), null, 'só conectado');
  assert.equal(peerConfirmCode(peer({ nodeId: 'cd'.repeat(8), pk: null }), nb), null);
  assert.equal(peerConfirmCode(peer(), undefined), null);
  assert.equal(peerLine(peer({ state: 'failed', error: 'recusou', source: 'config' })), `falhou · nó ${'ab'.repeat(8)} · recusou · PIU_LNNP_PEERS`);
  for (const a of ['192.168.0.12:8422', 'piu-node.local:8422', '[fe80::1]:8422']) assert.ok(looksLikePeerAddress(a), a);
  for (const a of ['', 'http://x:1', 'x', 'x:0', 'x:99999', 'a b:1', 'x:1/y']) assert.ok(!looksLikePeerAddress(a), a);
  assert.equal(addPeerMessage(null).ok, false);
  assert.equal(addPeerMessage(peer()).ok, true);
  assert.match(addPeerMessage(peer({ state: 'failed', error: 'tempo esgotado' })).text, /tempo esgotado/);
});

test('9.5 ganhos: só liquidações registradas pelo nó; sem dado, zero e lista vazia', () => {
  assert.deepEqual(nodeEarnings(null, null), { received: 0, balance: 0, lots: [], receipts: null });
  const e = nodeEarnings(
    { balance: 7.5, txs: [{ id: 'a', amount: 12.5, at: 10, to: 'provider', kind: 'in', from: 'lote 2026-S44' }, { id: 'b', amount: 5, at: 11, to: 'personal' }, { id: 'c', amount: 0.25, at: 20, to: 'provider', kind: 'in' }] },
    { enabled: true, kept: 9, keptOwn: 4 },
  );
  assert.equal(e.received, 12.75);
  assert.equal(e.balance, 7.5);
  assert.deepEqual(e.lots.map(l => l.id), ['c', 'a']);
  assert.deepEqual(e.receipts, { kept: 9, keptOwn: 4 });
  assert.equal(nodeEarnings(null, { enabled: false }).receipts, null);
});

test('9.6 carteira e lote: textos honestos e step-up', () => {
  assert.equal(epochLabel('2026-S45', 0), 'Esta semana · 2026-S45');
  assert.equal(epochLabel('2026-S46', 1), 'Próxima · 2026-S46');
  const claims = { enabled: true, epochs: ['2026-S45'], claims: [{ epoch: '2026-S45', address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', at: 1 }] };
  assert.match(claimNote(claims, '2026-S45'), /Já declarada para 2026-S45: 5Grwva/);
  assert.match(claimNote({ enabled: false, epochs: [], claims: [] }, ''), /desligada/);
  assert.match(lunesWalletLine(null), /Lendo/);
  const lw = { address: 'X', setAt: 1, explorer: '', endpoints: [], onchain: null, error: null, cached: false };
  assert.match(lunesWalletLine({ ...lw, address: null }), /Sem endereço/);
  assert.match(lunesWalletLine(lw), /ainda não leu/);
  assert.match(lunesWalletLine({ ...lw, error: 'sem rede' }), /sem rede/);
  const reading = { address: 'X', exists: true, free: '1234500000', reserved: '0', frozen: '0', block: 42, blockHash: '0x', endpoint: 'wss://ws.lunes.io/x', at: 1 };
  assert.equal(lunesWalletLine({ ...lw, onchain: reading }), 'Na Lunes Mainnet: 12,345 LUNES · bloco #42 · ws.lunes.io');
  assert.match(lunesWalletLine({ ...lw, onchain: reading, error: 'caiu' }), /^Sem conexão agora · última leitura: 12,345/);
  assert.equal(needsReauth(new NodeApiError(403, 'x', true)), true);
  assert.equal(needsReauth(new NodeApiError(403, 'x')), false);
  assert.equal(needsReauth(new Error('x')), false);
});
