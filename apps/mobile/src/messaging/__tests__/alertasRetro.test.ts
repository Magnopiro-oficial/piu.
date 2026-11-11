/// <reference types="node" />
/**
 * Alertas da comunidade (auditoria 2026-11-09): o limite não depende da ordem de chegada; título,
 * texto e área sem controles bidi. A rajada retrodatada segue em aberto (teste marcado como todo).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlertBook, decodeAlertPayload, encodeAlertPayload } from '../communityAlerts';

const T0 = 1_800_000_000;
const H = 3600;
const roster = [{ id: 'piu:b', role: 'member' as const }];
const mk = (i: number, at: number, dur = 72 * H) => ({ id: i.toString(16).padStart(32, '0'), community: 'c', author: 'piu:b', authorName: 'B', cat: 'outro' as const, sev: 'grave' as const, title: 't', text: '', area: '', at, until: at + dur });

test('o limite dá o mesmo resultado em qualquer ordem de chegada dos alertas', () => {
  // O autor publica A1, A2 e A3, encerra A1 e publica A4 (só 2 ativos: ele pôde publicar).
  const M = 60;
  const list = [mk(1, T0), mk(2, T0 + 15 * M), mk(3, T0 + 30 * M), mk(4, T0 + 50 * M)];
  const run = (order: number[]) => {
    const book = new AlertBook();
    return order.map(i => book.addAlert(list[i - 1]!, T0 + H, roster));
  };
  // Pela malha o encerramento de A1 pode chegar depois dos alertas: nenhum deles é recusado.
  for (const order of [[4, 1, 2, 3], [4, 3, 2, 1], [2, 4, 1, 3], [3, 1, 4, 2]]) assert.deepEqual(run(order), ['ok', 'ok', 'ok', 'ok'], order.join(','));
  // Na ordem em que foi publicado, com o encerramento no lugar, também.
  const book = new AlertBook();
  for (const a of list.slice(0, 3)) assert.equal(book.addAlert(a, T0 + H, roster), 'ok');
  assert.equal(book.addClose(list[0]!.id, 'piu:b', T0 + 40 * M, roster), true);
  assert.equal(book.addAlert(list[3]!, T0 + H, roster), 'ok');
});

// Em aberto (auditoria 2026-11-09, item 62): sem os encerramentos em mãos, esta rajada é igual ao
// caso legítimo do teste acima. Recusar aqui recusa alerta legítimo; fica para decisão do dono.
test('retrodatar em ordem decrescente não fura o teto de 3 ativos', { todo: 'precisa de regra que não dependa da ordem de chegada' }, () => {
  const book = new AlertBook();
  const got: string[] = [];
  // Tudo chega no mesmo minuto, cada um declarado 10 min antes do anterior, todos com 72 h.
  for (let i = 0; i < 6; i++) got.push(book.addAlert(mk(i + 1, T0 - i * 600), T0 + i, roster));
  assert.deepEqual(got, ['ok', 'ok', 'ok', 'rejected', 'rejected', 'rejected']);
});

test('título, texto e área do alerta chegam sem controles bidi', () => {
  const RLO = '‮', LRI = '⁦';
  const b = encodeAlertPayload({ kind: 'alert', i: 'a'.repeat(32), cat: 'outro', sev: 'info', title: `Ponte ${RLO}adacheF`, text: `x${LRI}y`, area: `Rua${RLO} 1`, dur: 3600 });
  const w = decodeAlertPayload(b);
  assert.ok(w && w.kind === 'alert');
  assert.equal(w.title, 'Ponte adacheF');
  assert.equal(w.text, 'xy');
  assert.equal(w.area, 'Rua 1');
});
