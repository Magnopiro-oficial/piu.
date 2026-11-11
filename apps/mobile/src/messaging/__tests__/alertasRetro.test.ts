/// <reference types="node" />
/**
 * Alertas da comunidade (auditoria 2026-11-09): o limite não depende da ordem de chegada; título,
 * texto e área sem controles bidi. Quais alertas valem sai do conjunto guardado, não da ordem de chegada
 * (item 62: a rajada retrodatada não fura o teto).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlertBook, decodeAlertPayload, encodeAlertPayload, LIMIT_MSG, MAX_ACTIVE_PER_MEMBER, MAX_STORED_PER_MEMBER } from '../communityAlerts';

const T0 = 1_800_000_000;
const H = 3600;
const roster = [{ id: 'piu:b', role: 'member' as const }];
const mk = (i: number, at: number, dur = 72 * H) => ({ id: i.toString(16).padStart(32, '0'), community: 'c', author: 'piu:b', authorName: 'B', cat: 'outro' as const, sev: 'grave' as const, title: 't', text: '', area: '', at, until: at + dur });

const M = 60;
const shown = (book: AlertBook, ids: string[], r = roster) => ids.filter(id => book.view(id, r, 'piu:eu', T0 + H) !== null);
/** Todas as ordens de uma lista (para conferir que a ordem de chegada não muda nada). */
const perms = <X>(xs: X[]): X[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));

test('o limite dá o mesmo resultado em qualquer ordem de chegada dos alertas', () => {
  // O autor publica A1, A2 e A3 (a cada 15 min, 72 h) e, sem encerrar nada, um A4: o A4 não conta.
  const list = [mk(1, T0), mk(2, T0 + 15 * M), mk(3, T0 + 30 * M), mk(4, T0 + 50 * M)];
  const ids = list.map(a => a.id);
  for (const order of perms(list)) {
    const book = new AlertBook();
    for (const a of order) assert.notEqual(book.addAlert(a, T0 + H, roster), 'rejected');
    assert.deepEqual(shown(book, ids), ids.slice(0, 3), order.map(a => a.id.slice(-1)).join(','));
    assert.equal(book.view(ids[3]!, roster, 'piu:eu', T0 + H), null, 'oculto: fora da lista');
  }
});

test('encerramento atrasado: o A4 fica oculto e aparece quando o encerramento de A1 chega', () => {
  // Publicou A1, A2, A3, encerrou A1 aos 40 min e publicou A4 (só 2 ativos: ele pôde publicar).
  const list = [mk(1, T0), mk(2, T0 + 15 * M), mk(3, T0 + 30 * M), mk(4, T0 + 50 * M)];
  const ids = list.map(a => a.id);
  type Ev = { a: (typeof list)[number] } | { close: true };
  const events: Ev[] = [...list.map(a => ({ a })), { close: true }];
  for (const order of perms(events)) {
    const book = new AlertBook();
    let closed = false;
    for (const e of order) {
      if ('a' in e) assert.notEqual(book.addAlert(e.a, T0 + H, roster), 'rejected');
      else { assert.equal(book.addClose(ids[0]!, 'piu:b', T0 + 40 * M, roster), true); closed = true; }
      // Antes do encerramento chegar, com A1..A3 em mãos, o A4 não aparece.
      if (!closed && book.get(ids[0]!) && book.get(ids[1]!) && book.get(ids[2]!)) assert.equal(book.view(ids[3]!, roster, 'piu:eu', T0 + H), null);
    }
    assert.deepEqual(shown(book, ids), ids, 'com tudo em mãos, os 4 valem');
  }
});

test('retrodatar em ordem decrescente não fura o teto de 3 ativos', () => {
  // Tudo chega no mesmo minuto, cada um declarado 10 min antes do anterior, todos com 72 h.
  const list = Array.from({ length: 6 }, (_, i) => mk(i + 1, T0 - i * 600));
  const ids = list.map(a => a.id);
  for (const order of [list, [...list].reverse(), [list[2]!, list[5]!, list[0]!, list[4]!, list[1]!, list[3]!]]) {
    const book = new AlertBook();
    order.forEach((a, k) => assert.notEqual(book.addAlert(a, T0 + k, roster), 'rejected'));
    // Valem os 3 mais antigos (os primeiros na ordem do tempo declarado); os outros ficam ocultos.
    assert.deepEqual(shown(book, ids), ids.slice(3));
    assert.equal(book.canPublish('c', 'piu:b', T0 + 10 * M, roster), LIMIT_MSG.max);
  }
});

test('intervalo de 10 min: vale o mais antigo, em qualquer ordem', () => {
  const x = mk(1, T0), y = mk(2, T0 + 5 * M);
  for (const order of [[x, y], [y, x]]) {
    const book = new AlertBook();
    for (const a of order) book.addAlert(a, T0 + H, roster);
    assert.deepEqual(shown(book, [x.id, y.id]), [x.id]);
  }
});

test('o autor abusivo não enche o livro: no máximo MAX_STORED_PER_MEMBER guardados por autor e comunidade', () => {
  const other = { ...mk(100, T0 - 30 * H), author: 'piu:c', authorName: 'C' };
  const r = [...roster, { id: 'piu:c', role: 'member' as const }];
  // 40 alertas retrodatados; o que fica guardado é o mesmo do mais novo para o mais velho e ao contrário.
  const list = Array.from({ length: 40 }, (_, i) => mk(i + 1, T0 - i * 600));
  const kept: string[][] = [];
  for (const order of [list, [...list].reverse()]) {
    const book = new AlertBook();
    assert.equal(book.addAlert(other, T0, r), 'ok');
    for (const a of order) book.addAlert(a, T0, r);
    const mine = book.all().filter(a => a.author === 'piu:b');
    assert.equal(mine.length, MAX_STORED_PER_MEMBER);
    const act = mine.filter(a => { const v = book.view(a.id, r, 'piu:eu', T0); return v && v.active; });
    assert.equal(act.length, MAX_ACTIVE_PER_MEMBER);
    assert.ok(book.view(other.id, r, 'piu:eu', T0), 'o alerta dos outros continua');
    kept.push(mine.map(a => a.id).sort());
  }
  assert.deepEqual(kept[0], kept[1]);
});

test('autor honesto encadeando encerramentos: nada se perde quando os encerramentos chegam depois', () => {
  // A1..A3, encerra os 3, A4..A6, encerra os 3, A7..A9 (24 h cada). O próprio canPublish deixa.
  const pub = new AlertBook();
  const al: ReturnType<typeof mk>[] = [];
  const cl: [string, number][] = [];
  let t = T0, k = 1;
  for (let round = 0; round < 3; round++) {
    for (let j = 0; j < 3; j++) {
      assert.equal(pub.canPublish('c', 'piu:b', t, roster), null);
      const a = mk(k++, t, 24 * H);
      assert.equal(pub.addAlert(a, t, roster), 'ok');
      al.push(a); t += 11 * M;
    }
    if (round < 2) for (const a of al.slice(-3)) { pub.addClose(a.id, 'piu:b', t, roster); cl.push([a.id, t]); t += M; }
  }
  const ids = al.map(a => a.id);
  type Ev = { a: (typeof al)[number] } | { c: [string, number] };
  const evs: Ev[] = [...al.map(a => ({ a })), ...cl.map(c => ({ c }))];
  for (const order of [evs, [...evs].reverse(), [...cl.map(c => ({ c })), ...al.map(a => ({ a }))]]) {
    const rx = new AlertBook();
    for (const e of order) {
      if ('a' in e) assert.notEqual(rx.addAlert(e.a, t, roster), 'rejected');
      else rx.addClose(e.c[0], 'piu:b', e.c[1], roster);
    }
    assert.equal(rx.all().length, 9);
    assert.deepEqual(ids.filter(id => rx.isCounted(id, roster)), ids);
  }
});

test('enxurrada de alertas curtos retrodatados fica no teto por autor', () => {
  // 3 por hora nas últimas 25 h, de 1 h cada: todos valeriam pelo limite de ativos.
  const book = new AlertBook();
  let k = 1;
  for (let h = 0; h < 25; h++) for (let j = 0; j < 3; j++) book.addAlert(mk(k++, T0 - 25 * H + 5 * M + h * H + j * 10 * M, H), T0, roster);
  assert.equal(book.all().length, MAX_STORED_PER_MEMBER);
});

test('o teto do aparelho (500) tira de quem tem mais guardado, não dos outros', () => {
  const honest = { ...mk(9999, T0 - 70 * H), author: 'piu:h', authorName: 'H' };
  const r = [{ id: 'piu:h', role: 'member' as const }, ...Array.from({ length: 20 }, (_, n) => ({ id: `piu:x${n}`, role: 'member' as const }))];
  const book = new AlertBook();
  assert.equal(book.addAlert(honest, T0, r), 'ok');
  let k = 1;
  // 20 autores, cada um em 2 comunidades com o teto cheio: 1200 alertas.
  for (let n = 0; n < 20; n++) for (const c of ['c1', 'c2']) for (let i = 0; i < MAX_STORED_PER_MEMBER; i++) {
    book.addAlert({ ...mk(k++, T0 - i * 600), community: c, author: `piu:x${n}` }, T0, r);
  }
  assert.ok(book.all().length <= 500);
  assert.ok(book.get(honest.id), 'o alerta antigo do membro honesto fica');
});

test('canPublish usa o mesmo cálculo: oculto não trava, encerrar libera', () => {
  const list = [mk(1, T0), mk(2, T0 + 15 * M), mk(3, T0 + 30 * M), mk(4, T0 + 50 * M)];
  const book = new AlertBook();
  for (const a of list) book.addAlert(a, T0 + H, roster);
  assert.equal(book.canPublish('c', 'piu:b', T0 + 2 * H, roster), LIMIT_MSG.max);
  // Encerrou A1: o A4 passa a valer e continuam 3 ativos.
  book.addClose(list[0]!.id, 'piu:b', T0 + 40 * M, roster);
  assert.equal(book.canPublish('c', 'piu:b', T0 + 2 * H, roster), LIMIT_MSG.max);
  book.addClose(list[1]!.id, 'piu:b', T0 + 90 * M, roster);
  assert.equal(book.canPublish('c', 'piu:b', T0 + 2 * H, roster), null);
  assert.equal(book.canPublish('c', 'piu:b', T0 + 55 * M, roster), LIMIT_MSG.wait, 'perto do A4, que agora vale');
});

test('livro salvo de antes carrega igual', () => {
  const book = new AlertBook();
  const list = [mk(1, T0), mk(2, T0 + 15 * M), mk(3, T0 + 30 * M)];
  for (const a of list) book.addAlert(a, T0 + H, roster);
  const again = new AlertBook(JSON.parse(JSON.stringify(book.export())));
  assert.deepEqual(shown(again, list.map(a => a.id)), list.map(a => a.id));
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
