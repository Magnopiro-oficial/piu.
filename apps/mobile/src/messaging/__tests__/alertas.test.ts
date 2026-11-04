/// <reference types="node" />
/**
 * Alertas da comunidade (messaging/communityAlerts.ts) com mensageiros de verdade numa comunidade:
 * publicar, receber, classificar, estados, limite anti-abuso, voto de quem não é membro, validade,
 * encerramento e estado salvo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeader, Priority, sealGroup, MsgType } from '../../protocol/envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { AlertBook, decodeAlertPayload, encodeAlertPayload, HISTORY_SEC, lockAlerts, noticeFor, type AlertNotice, type AlertView, voteStatus } from '../communityAlerts';
import { groupKeyOf } from '../groups';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;
const H = 3600;

class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  wire: Uint8Array[] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => {
    if (this.links.has(this.key(from, to))) { this.queue.push([from, to, bytes]); this.wire.push(bytes); }
  };
  run() {
    for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
}

type Dev = ReturnType<typeof device>;
function device(net: Net, name: string, opts: { seed?: Uint8Array; state?: string } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { alerts: [] as [AlertView, AlertNotice | null][], group: [] as [string, string][] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      communityAlert: (v, n) => log.alerts.push([v, n]),
      groupMessage: (_g, _f, who, x) => log.group.push([who, x.text]),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log, name };
}
const know = (x: Dev, y: Dev) => x.m.addContact({ id: y.ids.public.id, via: 'public', pub: toPublic(y.ids.public), name: y.name } satisfies Contact);

/** Ana (admin) cria a comunidade com Beto, Caio e Davi; todos ligados a Ana, que repassa. */
function vila() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio'), d = device(net, 'Davi');
  for (const x of [b, c, d]) { know(a, x); know(x, a); }
  const com = a.m.createGroup({ kind: 'community', name: 'Vila', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id, d.ids.public.id] });
  for (const x of ['Beto', 'Caio', 'Davi']) net.link('Ana', x);
  return { net, a, b, c, d, com, all: [a, b, c, d] };
}
const draft = { cat: 'agua' as const, sev: 'grave' as const, title: 'Rio subindo na ponte', text: 'A água passou da marca. Evitem a ponte.', area: 'Ponte da Rua 3', durSec: 24 * H };

test('publicar: qualquer membro publica; todos recebem, cifrado e com prioridade Alta', () => {
  const { net, a, b, c, d, com } = vila();
  assert.equal(b.m.getGroup(com.id)?.kind, 'community');
  assert.throws(() => b.m.sendGroupText(com.id, 'x', 'aviso'), /Só admins/, 'texto dos avisos continua só de admins');
  net.wire.length = 0;
  const v = b.m.publishAlert(com.id, draft);
  net.run();
  assert.equal(v.mine, true);
  assert.equal(v.status, 'unconfirmed');
  for (const x of [a, c, d]) {
    const got = x.m.communityAlert(v.id);
    assert.ok(got, `${x.name} recebeu`);
    assert.equal(got.title, 'Rio subindo na ponte');
    assert.equal(got.authorName, 'Beto');
    assert.equal(got.area, 'Ponte da Rua 3');
    assert.equal(got.until - got.at, 24 * H);
    assert.equal(got.status, 'unconfirmed');
    assert.deepEqual(x.log.alerts.map(([, n]) => n), [{ level: 'critical', update: false }], 'Grave notifica (crítica)');
  }
  assert.equal(b.log.alerts.length, 0, 'quem publicou não se notifica');
  assert.ok(net.wire.length > 0);
  let envelopes = 0;
  for (const w of net.wire) {
    assert.ok(!Buffer.from(w).includes(Buffer.from('Rio subindo')), 'relays não leem');
    let h; try { h = parseHeader(w); } catch { continue; } // provas de entrega e presença não são envelopes
    envelopes++;
    assert.equal(h.priority, Priority.High);
  }
  assert.ok(envelopes > 0);
  // Atenção notifica normal; Informativo só aparece na lista.
  net.clock += 11 * 60;
  const w2 = c.m.publishAlert(com.id, { ...draft, sev: 'warn', title: 'Buraco na estrada' });
  net.clock += 11 * 60;
  const w3 = d.m.publishAlert(com.id, { ...draft, sev: 'info', title: 'Feira adiada' });
  net.run();
  assert.deepEqual(a.log.alerts.find(([x]) => x.id === w2.id)?.[1], { level: 'normal', update: false });
  assert.equal(a.log.alerts.find(([x]) => x.id === w3.id)?.[1], null);
  assert.deepEqual(a.m.communityAlerts(com.id).map(x => x.sev), ['grave', 'warn', 'info']);
  assert.deepEqual(lockAlerts(a.m.communityAlerts()).map(x => x.id), [v.id], 'tela bloqueada: só os Graves');
});

test('classificar: confirmações, contestação, mudança de voto e o autor não vota', () => {
  const { net, a, b, c, d, com, all } = vila();
  const v = b.m.publishAlert(com.id, draft);
  net.run();
  assert.throws(() => b.m.voteAlert(v.id, 'confirm'), /Você publicou/);
  c.m.voteAlert(v.id, 'confirm');
  net.run();
  for (const x of all) assert.equal(x.m.communityAlert(v.id)?.status, 'unconfirmed', 'uma confirmação não basta');
  d.m.voteAlert(v.id, 'confirm');
  net.run();
  for (const x of all) {
    const got = x.m.communityAlert(v.id)!;
    assert.equal(got.status, 'confirmed', x.name);
    assert.equal(got.confirms, 2);
    assert.equal(got.denies, 0);
  }
  assert.deepEqual(a.log.alerts.at(-1)?.[1], { level: 'critical', update: true }, 'Grave confirmado: aviso de atualização');
  // Ana contesta: 2 confirmações ≥ 2×1 → continua confirmado.
  a.m.voteAlert(v.id, 'deny');
  net.run();
  assert.equal(c.m.communityAlert(v.id)?.status, 'confirmed');
  // Caio muda de ideia: 1 confirmação, 2 "não procede" → contestado, sem notificar.
  const before = d.log.alerts.length;
  c.m.voteAlert(v.id, 'deny');
  net.run();
  for (const x of all) assert.equal(x.m.communityAlert(v.id)?.status, 'contested', x.name);
  assert.equal(c.m.communityAlert(v.id)?.myVote, 'deny');
  assert.ok(d.log.alerts.slice(before).every(([, n]) => n === null), 'contestado não notifica');
  assert.deepEqual(lockAlerts(d.m.communityAlerts()), [], 'contestado sai da tela bloqueada');
  assert.equal(d.m.communityAlerts(com.id)[0]?.status, 'contested', 'continua na lista, rebaixado');
});

test('estados: agregação determinística pelas contagens', () => {
  assert.equal(voteStatus(0, 0), 'unconfirmed');
  assert.equal(voteStatus(1, 0), 'unconfirmed');
  assert.equal(voteStatus(2, 0), 'confirmed');
  assert.equal(voteStatus(2, 1), 'confirmed');
  assert.equal(voteStatus(3, 2), 'unconfirmed', '3 < 2×2 e 2 < 3');
  assert.equal(voteStatus(4, 2), 'confirmed');
  assert.equal(voteStatus(2, 2), 'contested');
  assert.equal(voteStatus(0, 2), 'contested');
  assert.equal(voteStatus(1, 1), 'unconfirmed');
  // Notificação.
  assert.deepEqual(noticeFor(null, { sev: 'grave', status: 'unconfirmed', mine: false }), { level: 'critical', update: false });
  assert.equal(noticeFor(null, { sev: 'grave', status: 'contested', mine: false }), null);
  assert.equal(noticeFor('unconfirmed', { sev: 'warn', status: 'confirmed', mine: false }), null, 'atualização só para Grave');
  assert.equal(noticeFor('confirmed', { sev: 'grave', status: 'confirmed', mine: false }), null);
});

test('limite: 1 alerta a cada 10 min e no máximo 3 ativos por membro', () => {
  const { net, a, b, com } = vila();
  const v1 = b.m.publishAlert(com.id, draft);
  assert.throws(() => b.m.publishAlert(com.id, draft), /10 minutos/);
  net.clock += 10 * 60;
  b.m.publishAlert(com.id, draft);
  net.clock += 10 * 60;
  b.m.publishAlert(com.id, draft);
  net.clock += 10 * 60;
  assert.throws(() => b.m.publishAlert(com.id, draft), /3 alertas ativos/);
  assert.match(b.m.alertLimit(com.id) ?? '', /3 alertas ativos/);
  net.run();
  assert.equal(a.m.communityAlerts(com.id).length, 3);
  // Encerrar um libera outro.
  b.m.closeAlert(v1.id);
  b.m.publishAlert(com.id, draft);
  net.run();
  assert.equal(a.m.communityAlerts(com.id).filter(x => x.active).length, 3);
  // Do lado de quem recebe, o mesmo limite: um 4º ativo do mesmo autor é recusado.
  const book = new AlertBook();
  const roster = [{ id: 'piu:b', role: 'member' as const }];
  const mk = (i: number, at: number) => ({ id: i.toString(16).padStart(32, '0'), community: 'c', author: 'piu:b', authorName: 'B', cat: 'outro' as const, sev: 'info' as const, title: 't', text: '', area: '', at, until: at + 24 * H });
  assert.equal(book.addAlert(mk(1, T0), T0, roster), 'ok');
  assert.equal(book.addAlert(mk(2, T0 + 60), T0 + 60, roster), 'rejected', '10 min');
  assert.equal(book.addAlert(mk(3, T0 + 600), T0 + 600, roster), 'ok');
  assert.equal(book.addAlert(mk(4, T0 + 1200), T0 + 1200, roster), 'ok');
  assert.equal(book.addAlert(mk(5, T0 + 1800), T0 + 1800, roster), 'rejected', '3 ativos');
  assert.equal(book.addAlert(mk(6, T0 + 1800), T0 + 1800, [{ id: 'piu:x', role: 'admin' }]), 'rejected', 'autor fora da comunidade');
  assert.equal(book.addAlert({ ...mk(7, T0 + 3 * H), at: T0 + 3 * H }, T0, roster), 'rejected', 'relógio adiantado demais');
});

test('voto de quem não é membro é ignorado', () => {
  const { net, a, b, c, com } = vila();
  const v = b.m.publishAlert(com.id, draft);
  net.run();
  // Eva não é da comunidade, mas conseguiu a chave (ex.: copiou de alguém) e manda dois "não procede".
  const eva = deriveIdentity(newSeed(), 'public');
  const g = a.m.getGroup(com.id)!;
  for (let k = 0; k < 2; k++) {
    const body = encodeAlertPayload({ kind: 'vote', i: (k + 1).toString(16).padStart(32, 'e'), alert: v.id, v: 'deny', n: 1 });
    const sealed = sealGroup({ from: eva, group: groupKeyOf(g), type: MsgType.Text, body, now: net.clock, ttlSec: H });
    a.m.receive('Eva', sealed.bytes);
  }
  net.run();
  assert.equal(a.m.communityAlert(v.id)?.denies, 0);
  assert.equal(c.m.communityAlert(v.id)?.denies, 0);
  // No livro: votante fora da lista não conta, nem se o voto entrou antes de a pessoa sair.
  const book = new AlertBook();
  const roster = [{ id: 'piu:a', role: 'admin' as const }, { id: 'piu:b', role: 'member' as const }, { id: 'piu:c', role: 'member' as const }];
  const id = 'a'.repeat(32);
  book.addAlert({ id, community: 'c', author: 'piu:a', authorName: 'A', cat: 'outro', sev: 'grave', title: 't', text: '', area: '', at: T0, until: T0 + H }, T0, roster);
  assert.equal(book.addVote(id, 'piu:z', 'deny', T0, '1', roster), false);
  assert.equal(book.addVote(id, 'piu:a', 'confirm', T0, '1', roster), false, 'autor');
  assert.equal(book.addVote(id, 'piu:b', 'confirm', T0, '1', roster), true);
  assert.equal(book.addVote(id, 'piu:c', 'confirm', T0, '1', roster), true);
  assert.equal(book.view(id, roster, 'piu:a', T0)?.status, 'confirmed');
  assert.equal(book.view(id, roster.slice(0, 2), 'piu:a', T0)?.status, 'unconfirmed', 'Caio saiu: o voto dele não conta mais');
  // Revisão mais velha não substitui a mais nova (ordem de chegada não importa).
  assert.equal(book.addVote(id, 'piu:b', 'deny', T0 + 9, '2', roster, 3), true);
  assert.equal(book.addVote(id, 'piu:b', 'confirm', T0 + 50, '9', roster, 2), false);
  assert.equal(book.view(id, roster, 'piu:a', T0)?.denies, 1);
  assert.equal(decodeAlertPayload(new TextEncoder().encode('{"i":"x","cv":{"a":"y","v":"c"}}')), null);
});

test('validade: vence no prazo, sai da tela bloqueada e some do aparelho 24 h depois', () => {
  const { net, a, b, com } = vila();
  const v = b.m.publishAlert(com.id, { ...draft, durSec: H });
  net.run();
  assert.equal(lockAlerts(a.m.communityAlerts()).length, 1);
  net.clock += H;
  a.m.tick();
  const got = a.m.communityAlert(v.id)!;
  assert.equal(got.status, 'expired');
  assert.equal(got.active, false);
  assert.equal(got.canVote, false);
  assert.equal(lockAlerts(a.m.communityAlerts()).length, 0);
  assert.equal(a.log.alerts.at(-1)?.[0].status, 'expired', 'a tela é avisada');
  assert.equal(a.log.alerts.at(-1)?.[1], null, 'sem notificação');
  assert.throws(() => a.m.voteAlert(v.id, 'confirm'), /não aceita mais/);
  assert.ok(a.m.export().includes(draft.title), 'histórico de 24 h');
  net.clock += HISTORY_SEC;
  a.m.tick();
  assert.equal(a.m.communityAlert(v.id), null);
  assert.ok(!a.m.export().includes(draft.title), 'saiu do estado salvo');
});

test('encerrar: autor, admin e moderador encerram; membro comum não', () => {
  const { net, a, b, c, d, com, all } = vila();
  const v = b.m.publishAlert(com.id, draft);
  net.run();
  assert.equal(c.m.communityAlert(v.id)?.canClose, false);
  assert.throws(() => c.m.closeAlert(v.id), /Só quem publicou/);
  a.m.closeAlert(v.id);
  net.run();
  for (const x of all) {
    const got = x.m.communityAlert(v.id)!;
    assert.equal(got.status, 'closed', x.name);
    assert.equal(got.active, false);
  }
  assert.throws(() => d.m.voteAlert(v.id, 'confirm'), /não aceita mais/);
  // Moderador encerra; o autor também encerra o próprio.
  a.m.setRole(com.id, d.ids.public.id, 'mod');
  net.run();
  net.clock += 11 * 60;
  const v2 = c.m.publishAlert(com.id, { ...draft, title: 'Árvore caída' });
  net.run();
  assert.equal(d.m.communityAlert(v2.id)?.canClose, true);
  d.m.closeAlert(v2.id);
  net.clock += 11 * 60;
  const v3 = c.m.publishAlert(com.id, { ...draft, title: 'Sem luz na rua 5' });
  net.run();
  c.m.closeAlert(v3.id);
  net.run();
  assert.equal(b.m.communityAlert(v2.id)?.status, 'closed');
  assert.equal(b.m.communityAlert(v3.id)?.status, 'closed');
});

test('estado salvo: alertas e votos voltam depois de reabrir', () => {
  const { net, a, b, c, d, com } = vila();
  const v = b.m.publishAlert(com.id, draft);
  net.run();
  c.m.voteAlert(v.id, 'confirm');
  d.m.voteAlert(v.id, 'confirm');
  net.run();
  const a2 = device(net, 'Ana', { seed: a.seed, state: a.m.export() });
  const got = a2.m.communityAlert(v.id)!;
  assert.equal(got.status, 'confirmed');
  assert.equal(got.confirms, 2);
  assert.equal(got.title, draft.title);
  // Saiu da comunidade: os alertas dela saem do aparelho.
  b.m.leaveGroup(com.id);
  assert.equal(b.m.communityAlerts().length, 0);
});
