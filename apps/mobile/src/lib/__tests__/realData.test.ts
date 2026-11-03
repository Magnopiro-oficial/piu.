/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGACY_KEYS, legacyKeysIn } from '../legacyCore';
import { fmtBytes, meshStatus, radarPos, relayCard } from '../networkCore';
import { mediaBytes, storageBreakdown } from '../storageCore';
import { activityRows, blockLabel, bonusSteps, dayLabel, onchainView, referralStats, walletSummary, whenLabel } from '../walletCore';

const DAY = 86_400_000;
const zero = { pendente: 0, validado: 0, em_lote: 0, rejeitado: 0, pago: 0 };

test('carteira: sem Mainnet o saldo é 0, nunca negativo, e créditos ficam "a liberar"', () => {
  assert.deepEqual(walletSummary({ totals: zero, reserved: [] }), { available: 0, reserved: 0, toRelease: 0 });
  const s = walletSummary({ totals: { pendente: 50, validado: 640, em_lote: 100, rejeitado: 9, pago: 30 }, reserved: [{ id: 'x', to: 'X', amt: 3, at: 0 }] });
  assert.equal(s.available, 0);
  assert.equal(s.reserved, 3);
  // (640 validados + 100 em lote) / 100; pendentes e rejeitados não contam, e pago (liquidado de verdade) já é saldo.
  assert.equal(s.toRelease, 7.4);
  assert.equal(walletSummary({ onchain: 10, totals: zero, reserved: [{ id: 'x', to: 'X', amt: 3, at: 0 }] }).available, 7);
});

test('carteira: movimentações só do que existe, da mais recente para a mais antiga', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  assert.deepEqual(activityRows({ lots: [], reserved: [], refunded: [], earned: [], now }), []);
  const rows = activityRows({
    lots: [{ id: 'lote-2026-S44', closedAt: (now - 2 * DAY) / 1000, credits: 640, lunes: 6.4, count: 10 }],
    reserved: [{ id: 'p1', to: 'Ana', amt: 3, at: now - 1000 }], refunded: [], earned: [], now,
  });
  assert.deepEqual(rows.map(r => [r.title, r.value]), [['Convite para Ana', '−3,00'], ['Créditos de rede · lote 2026-S44', '+6,40']]);
});

test('carteira: datas e etapas do bônus', () => {
  const now = new Date(2026, 10, 3, 15).getTime();
  assert.equal(dayLabel(now - 60_000, now), 'Hoje');
  assert.equal(dayLabel(now - DAY, now), 'Ontem');
  assert.equal(dayLabel(new Date(2026, 9, 28, 9).getTime(), now), '28 out');
  assert.equal(dayLabel(new Date(2025, 9, 28, 9).getTime(), now), '28 out 2025');
  // 7.4: identidade só conta com backup; dias = dias com entrega para 3+ contatos (não dias desde a instalação).
  assert.deepEqual(bonusSteps({ onboarded: true, backupDone: true, verifiedContact: false, activeDays: 3 }).map(s => s[1]), [0, 100, 0, 43]);
  const noBackup = bonusSteps({ onboarded: true, backupDone: false, verifiedContact: false, activeDays: 0 });
  assert.equal(noBackup[1][1], 0, 'sem backup a identidade não conta');
  assert.equal(noBackup[1][0], 'Identidade criada · falta o backup');
  assert.equal(bonusSteps({ onboarded: true, backupDone: true, verifiedContact: true, activeDays: 30 })[3][0], '7 dias de uso · 7/7');
  assert.equal(bonusSteps({ onboarded: false, backupDone: false, verifiedContact: false, activeDays: 0 })[3][1], 0);
});

test('6.5 convites aceitos: contadores do registro local, nada pago', () => {
  const now = new Date(2026, 10, 3, 15).getTime();
  assert.deepEqual(referralStats([], now), { accepted: 0, thisMonth: 0, paid: 0, earned: 0 });
  const list = [
    { contactId: 'a', name: 'Ana', via: 'public' as const, at: now - DAY },
    { contactId: 'b', name: '', via: 'anon' as const, at: new Date(2026, 9, 20).getTime() },
  ];
  assert.deepEqual(referralStats(list, now), { accepted: 2, thisMonth: 1, paid: 0, earned: 0 });
});

test('rede: radar estável e dentro da área; números do Modo nó', () => {
  for (const id of ['a', 'sim-0', 'Pixel 7a · 9C21', 'x'.repeat(40)]) {
    const p = radarPos(id);
    assert.deepEqual(radarPos(id), p);
    assert.ok(p.x >= 8 && p.x <= 92 && p.y >= 8 && p.y <= 92, `${id}: ${p.x},${p.y}`);
  }
  assert.deepEqual(relayCard(null, true), [['—', 'pacotes hoje'], ['—', 'entregues'], ['0 MB', 'em uso']]);
  assert.deepEqual(relayCard({ relayedToday: 1234, sent: 8, delivered: 7, thirdPartyBytes: 3 * 1048576 }, true), [['1.234', 'pacotes hoje'], ['87,5%', 'entregues'], ['3 MB', 'em uso']]);
  assert.equal(relayCard({ relayedToday: 5, sent: 0, delivered: 0, thirdPartyBytes: 0 }, false)[0][0], '—');
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(1536 * 1024 * 1024), '1,5 GB');
  assert.equal(meshStatus('running', 0), 'Sem internet · procurando vizinhos');
  assert.equal(meshStatus('running', 1), 'Sem internet · malha local ativa · 1 vizinho');
  assert.equal(meshStatus('off', 0), 'Malha local desligada');
});

test('armazenamento: soma o disco e separa mídia, terceiros e recibos', () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  assert.equal(mediaBytes({ chats: [{ photo }, { msgs: [{ text: 'oi' }] }] }), photo.length);
  assert.equal(mediaBytes(`{"x":"${photo}"}`), photo.length);
  const use = storageBreakdown([
    { key: 'chats', diskBytes: 3000, value: [{ photo }] },
    { key: 'msg.state', diskBytes: 4000, value: 'x'.repeat(2000) },
    { key: 'set.priv', diskBytes: 200, value: { find: 'contacts' } },
  ], { thirdPartyBytes: 300, creditsBytes: 100 });
  const parts = Object.fromEntries(use.parts);
  assert.equal(use.total, 7200);
  assert.equal(use.parts.reduce((a, [, n]) => a + n, 0), use.total);
  assert.ok(parts['Mídia'] > 0 && parts['Mídia'] < 3000);
  assert.equal(parts['De terceiros'], 800); // 300 × 4/3 × (4000 / 2000)
  assert.equal(parts['Recibos e créditos'], 200);
  assert.equal(parts['Ajustes e registros'], 200);
  // Terceiros nunca passam do que o estado do mensageiro ocupa.
  const big = storageBreakdown([{ key: 'msg.state', diskBytes: 100, value: 'x'.repeat(100) }], { thirdPartyBytes: 1e6 });
  assert.equal(Object.fromEntries(big.parts)['De terceiros'], 100);
  assert.deepEqual(storageBreakdown([]).total, 0);
});

test('migração: só os campos de exemplo saem; ajustes reais ficam', () => {
  const saved = ['wallet.sent', 'wallet.earned', 'net.devices', 'set.dropped', 'nearby.myFee', 'nearby.visibleUntil', 'net.relay', 'net.tx', 'chats', 'msg.state', 'dev.list', 'wallet.nearPay'];
  assert.deepEqual(legacyKeysIn(saved), ['wallet.sent', 'wallet.earned', 'net.devices', 'set.dropped']);
  for (const keep of ['nearby.myFee', 'nearby.visibleUntil', 'nearby.invites', 'nearby.reserved', 'nearby.answers', 'wallet.since', 'dev.list', 'dev.self', 'msg.state', 'set.priv']) {
    assert.ok(!(LEGACY_KEYS as readonly string[]).includes(keep), keep);
  }
});

test('carteira: leitura da Mainnet dita como é (sem endereço, consultando, lida, sem rede)', () => {
  const now = new Date(2026, 10, 3, 15, 0).getTime();
  const addr = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
  const snap = { address: addr, exists: true, free: '255000000', reserved: '0', frozen: '0', block: 4_200_000, blockHash: '0x' + '11'.repeat(32), endpoint: 'wss://ws-lunes-main-01.lunes.io', at: new Date(2026, 10, 3, 14, 32).getTime() };
  const none = onchainView({ address: null, snap: null, status: { state: 'idle' }, now });
  assert.equal(none.has, false);
  assert.match(none.line, /Informe o endereço/);
  assert.equal(onchainView({ address: addr, snap: null, status: { state: 'loading' }, now }).pill, 'Mainnet: consultando…');
  const offFirst = onchainView({ address: addr, snap: null, status: { state: 'error', error: 'Nenhum endereço da Lunes respondeu.' }, now });
  assert.equal(offFirst.has, false, 'sem leitura, nada de saldo');
  const ok = onchainView({ address: addr, snap, status: { state: 'ok' }, now });
  assert.equal(ok.pill, 'Mainnet · bloco #4.200.000');
  assert.equal(ok.line, 'Saldo na Lunes Mainnet · bloco #4.200.000 · ws-lunes-main-01.lunes.io · atualizado às 14:32');
  const off = onchainView({ address: addr, snap, status: { state: 'error', error: 'x' }, now: now + DAY });
  assert.equal(off.stale, true);
  assert.equal(off.line, 'Sem conexão agora · último saldo lido no bloco #4.200.000 · ws-lunes-main-01.lunes.io · atualizado em ontem, 14:32');
  // Leitura guardada de outro endereço não vale para o atual.
  assert.equal(onchainView({ address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', snap, status: { state: 'ok' }, now }).has, false);
  assert.equal(whenLabel(new Date(2026, 9, 28, 9, 5).getTime(), now), 'em 28 out, 09:05');
  assert.equal(blockLabel(12), '#12');
});
