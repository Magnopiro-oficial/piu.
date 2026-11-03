/// <reference types="node" />
/**
 * Identidade e avisos: troca de aparelho (restaurar pela frase/arquivo avisa os contatos e as sessões
 * renegociam), "Quem pode me encontrar" e menções em grupo ("Só menções acima de 20 mensagens/h").
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceChange, decodeNotice, deviceChangeActive, DEVICE_CHANGE_WINDOW_SEC, encodeDeviceChange, isNewDeviceChange, verifyDeviceChange } from '../../lib/devicesCore';
import { dropSessions } from '../../lib/migration';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { b64url } from '../card';
import { type Contact, Messenger, type MessengerEvents } from '../messenger';

const T0 = 1_800_000_000;

/** Malha em memória (a mesma de messenger.test.ts). */
class Net {
  clock = T0;
  nodes = new Map<string, Messenger>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => {
    if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]);
  };
  run() {
    for (let i = 0; i < 5000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)?.peerDisconnected(b); this.nodes.get(b)?.peerDisconnected(a); }
}

type Dev = ReturnType<typeof device>;
function device(net: Net, name: string, opts: { seed?: Uint8Array; state?: string; events?: Partial<MessengerEvents> } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as [string, string][], group: [] as { who: string; text: string; mentioned?: boolean }[], notices: [] as [string, string][], requests: [] as Contact[] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      message: (c, x) => log.msgs.push([c, x.text]),
      newContact: (c, x) => { log.requests.push(c); log.msgs.push([c.id, x.text]); },
      groupMessage: (_g, _f, who, x) => log.group.push({ who, text: x.text, mentioned: x.mentioned }),
      notice: (from, text) => log.notices.push([from, text]),
      ...opts.events,
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log, name };
}
const know = (x: Dev, y: Dev) => x.m.addContact({ id: y.ids.public.id, via: 'public', pub: toPublic(y.ids.public), name: y.name } satisfies Contact);

// ── 1.4 restaurar avisa os contatos ─────────────────────────────────

test('1.4 troca de aparelho: aviso assinado pela identidade chega ao contato e as sessões renegociam', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  know(a, b); know(b, a); know(a, c);
  net.link('Ana', 'Beto');
  a.m.sendText(b.ids.public.id, 'm1', 'Oi Beto');
  net.run();
  b.m.sendText(a.ids.public.id, 'r1', 'Oi Ana');
  net.run();
  assert.equal(a.m['managers'].public.get(b.ids.public.id)?.established, true, 'sessão firmada antes da troca');
  net.unlink('Ana', 'Beto');

  // Beto restaura num aparelho novo (pela frase, com os contatos de um arquivo): sem as sessões antigas.
  net.nodes.delete('Beto');
  const b2 = device(net, 'Beto', { seed: b.seed, state: dropSessions(b.m.export()) });
  assert.equal(b2.m['managers'].public.get(a.ids.public.id), undefined, 'sessões descartadas');
  const notice = createDeviceChange(b2.ids.public, 'phrase', net.clock);
  const sent = b2.m.broadcastNotice('public', encodeDeviceChange(notice));
  assert.deepEqual(sent, [a.ids.public.id], 'vai para os contatos dessa identidade');
  assert.deepEqual(b2.m.broadcastNotice('public', encodeDeviceChange(notice), sent), [], 'quem já recebeu não recebe de novo');

  net.link('Ana', 'Beto');
  assert.equal(a.log.notices.length, 1);
  const [from, text] = a.log.notices[0]!;
  assert.equal(from, b.ids.public.id);
  const got = decodeNotice(text);
  assert.equal(got.kind, 'change');
  // Ana confere com a chave de Beto que ela já conhecia.
  const known = a.m.getContact(from)!.pub.signPk;
  assert.ok(got.kind === 'change' && verifyDeviceChange(got.n, known));
  assert.ok(isNewDeviceChange(got.n, undefined));
  assert.ok(!isNewDeviceChange(got.n, { at: got.n.at, sig: got.n.sig }), 'o mesmo aviso de novo não gera outra mensagem');

  // Sessões renegociadas: as mensagens seguem nos dois sentidos com o aparelho novo.
  a.m.sendText(b.ids.public.id, 'm2', 'Recebi o aviso');
  net.run();
  assert.deepEqual(b2.log.msgs.at(-1), [a.ids.public.id, 'Recebi o aviso']);
  b2.m.sendText(a.ids.public.id, 'r2', 'Aparelho novo');
  net.run();
  assert.deepEqual(a.log.msgs.at(-1), [b.ids.public.id, 'Aparelho novo']);
  assert.equal(a.m['managers'].public.get(b.ids.public.id)?.established, true);

  // Forjado: Caio assina com a chave dele e põe a de Beto em `by`, ou assina como ele mesmo.
  const forged = createDeviceChange(c.ids.public, 'phrase', net.clock + 1);
  assert.ok(!verifyDeviceChange({ ...forged, by: b64url(b.ids.public.signPk) }, known));
  assert.ok(!verifyDeviceChange(forged, known));
  // Adulterado: outro motivo ou outra hora não confere.
  assert.ok(got.kind === 'change' && !verifyDeviceChange({ ...got.n, reason: 'file' }, known));
  assert.ok(got.kind === 'change' && !verifyDeviceChange({ ...got.n, at: got.n.at + 1 }, known));
});

test('1.4 troca de aparelho: contato adicionado depois (dentro da janela) também recebe; revogação continua decodificando', () => {
  const at = T0;
  assert.ok(deviceChangeActive({ at }, at + DEVICE_CHANGE_WINDOW_SEC - 1));
  assert.ok(!deviceChangeActive({ at }, at + DEVICE_CHANGE_WINDOW_SEC));
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  // Beto restaurou pela frase: nenhum contato no aparelho; o aviso não vai para ninguém.
  const n = encodeDeviceChange(createDeviceChange(b.ids.public, 'phrase', at));
  assert.deepEqual(b.m.broadcastNotice('public', n), []);
  // Ele adiciona Ana de novo (código): na próxima distribuição ela recebe.
  know(b, a); know(a, b);
  assert.deepEqual(b.m.broadcastNotice('public', n, []), [a.ids.public.id]);
  net.link('Ana', 'Beto');
  assert.equal(a.log.notices.length, 1);
  // Aviso inválido não passa no decodificador.
  assert.throws(() => decodeNotice('{"t":"outro"}'));
});

// ── 1.5 "Quem pode me encontrar" ────────────────────────────────────

const card = (d: Dev, via: 'public' | 'anon' = 'public'): Contact => ({ id: d.ids[via].id, via, pub: toPublic(d.ids[via]), name: d.name, invite: d.m.issueInvite(via).code });

test('1.5 Quem pode me encontrar: Todos anuncia em Por perto; Contatos e Ninguém saem de Por perto', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  net.link('Ana', 'Beto');
  const show = (d: Dev) => d.m.setNearby({ until: net.clock + 3600, fee: 3, name: d.name, photo: null });
  show(a); show(b); net.run();
  assert.equal(b.m.nearbyProfiles().length, 1, 'Todos: Beto vê Ana');
  // Ana muda para Contatos: retira o anúncio na hora e também deixa de ver (recíproco).
  a.m.setDiscovery('contacts'); net.run();
  assert.deepEqual(b.m.nearbyProfiles(), [], 'some para Beto');
  assert.deepEqual(a.m.nearbyProfiles(), []);
  net.clock += 120; a.m.tick(); net.run();
  assert.deepEqual(b.m.nearbyProfiles(), [], 'não volta a anunciar');
  // Beto não consegue convidar Ana (ela não aparece); e se mandar mesmo assim, Ana descarta.
  assert.throws(() => b.m.sendNearInvite(a.ids.public.id, 'Oi'));
  assert.throws(() => a.m.sendNearInvite(b.ids.public.id, 'Oi'), /Quem pode me encontrar/);
  // Volta para Todos: anuncia de novo.
  a.m.setDiscovery('all'); net.run();
  assert.equal(b.m.nearbyProfiles().length, 1);
});

test('1.5 pedido de conversa pelo convite: Contatos aceita quem tem o código; Ninguém descarta (só na pública)', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  net.link('Ana', 'Beto'); net.link('Ana', 'Caio');
  a.m.setDiscovery('contacts');
  b.m.addContact(card(a));
  b.m.sendText(a.ids.public.id, 'm1', 'Oi, peguei seu código');
  net.run();
  assert.equal(a.log.requests.length, 1, 'Contatos: quem tem o código pede conversa');
  a.m.setDiscovery('none');
  c.m.addContact(card(a));
  c.m.sendText(a.ids.public.id, 'm1', 'Oi');
  net.run();
  assert.equal(a.log.requests.length, 1, 'Ninguém: pedido pelo código da pública é descartado');
  assert.equal(a.m.getContact(c.ids.public.id), undefined);
  // A identidade anônima não muda com o ajuste.
  c.m.addContact(card(a, 'anon'));
  c.m.sendText(a.ids.anon.id, 'm2', 'Pela anônima');
  net.run();
  assert.equal(a.log.requests.length, 2);
  // Contato já aceito continua conversando normalmente.
  b.m.sendText(a.ids.public.id, 'm3', 'Ainda aqui');
  net.run();
  assert.deepEqual(a.log.msgs.at(-1), [b.ids.public.id, 'Ainda aqui']);
});

// ── 11.3 menções em grupo ───────────────────────────────────────────

test('11.3 menção @Nome vai com os ids no conteúdo do grupo; acima de 20 mensagens/h só menções notificam', async () => {
  const { GroupRate, groupShouldNotify, mentionIds, GROUP_BUSY_PER_HOUR } = await import('../mentions');
  const { decodeGroupText, encodeGroupText } = await import('../groups');
  const members = [{ id: 'piu:a', name: 'Ana' }, { id: 'piu:ap', name: 'Ana Paula' }, { id: 'piu:b', name: 'Beto' }, { id: 'piu:me', name: 'Eu' }];
  assert.deepEqual(mentionIds('Oi @ana paula, tudo bem?', members), ['piu:ap'], 'o nome mais longo ganha; não conta @Ana também');
  assert.deepEqual(mentionIds('@Ana e @Beto: reunião', members).sort(), ['piu:a', 'piu:b']);
  assert.deepEqual(mentionIds('email ana@ana.com e @Betoneira', members), [], 'no meio de palavra não vale');
  assert.deepEqual(mentionIds('@Eu mesmo', members, 'piu:me'), [], 'eu não me menciono');
  // Conteúdo: o campo `m` vai e volta; lixo é filtrado.
  assert.deepEqual(decodeGroupText(encodeGroupText('x1', 'oi @Ana', ['piu:a']))?.m, ['piu:a']);
  assert.equal(decodeGroupText(encodeGroupText('x1', 'oi'))?.m, undefined);
  assert.deepEqual(decodeGroupText(new TextEncoder().encode(JSON.stringify({ i: 'x', x: 'y', m: ['piu:a', 3, 'piu:a', 'z'.repeat(99)] })))?.m, ['piu:a']);
  // Regra: até 20 por hora notifica tudo; a 21ª só se mencionar.
  const rate = new GroupRate();
  let n = 0;
  for (let i = 0; i < GROUP_BUSY_PER_HOUR; i++) n = rate.hit('g1', T0 + i);
  assert.equal(n, 20);
  assert.ok(groupShouldNotify(n, false));
  n = rate.hit('g1', T0 + 30);
  assert.ok(!groupShouldNotify(n, false), '21ª sem menção: quieta');
  assert.ok(groupShouldNotify(n, true), '21ª com menção: notifica');
  assert.equal(rate.hit('g2', T0 + 30), 1, 'conta por grupo');
  assert.equal(rate.hit('g1', T0 + 3600 + 25), 2, 'só a última hora conta (a das 30 s e esta)');

  // Pelo mensageiro: Ana menciona Beto; Beto recebe `mentioned`, Caio não.
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  for (const x of [b, c]) { know(a, x); know(x, a); }
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id], send: 'all' });
  net.link('Ana', 'Beto'); net.link('Ana', 'Caio');
  a.m.sendGroupText(g.id, 'g1', 'Amanhã às 8, @beto traz a lona');
  net.run();
  assert.deepEqual(b.log.group.at(-1), { who: 'Ana', text: 'Amanhã às 8, @beto traz a lona', mentioned: true });
  assert.deepEqual(c.log.group.at(-1), { who: 'Ana', text: 'Amanhã às 8, @beto traz a lona', mentioned: undefined });
});
