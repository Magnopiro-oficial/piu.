/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { decodeCard, encodeCard, unb64url, b64url } from '../card';
import { type Contact, Messenger } from '../messenger';

const T0 = 1_800_000_000;

/** Malha em memória: links entre aparelhos, entregues de forma síncrona numa fila. */
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
    for (let i = 0; i < 1000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); }
  }
  link(a: string, b: string) { this.links.add(this.key(a, b)); this.nodes.get(a)!.peerConnected(b, 'ble'); this.nodes.get(b)!.peerConnected(a, 'ble'); this.run(); }
  unlink(a: string, b: string) { this.links.delete(this.key(a, b)); this.nodes.get(a)!.peerDisconnected(b); this.nodes.get(b)!.peerDisconnected(a); }
}

function device(net: Net, name: string, opts: { relay?: boolean; seed?: Uint8Array; state?: string } = {}) {
  const seed = opts.seed ?? newSeed();
  const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
  const log = { msgs: [] as [string, string][], status: [] as [string, string][], requests: [] as Contact[] };
  const m = new Messenger({
    identities: ids, node: deriveNodeKey(seed), relay: opts.relay ?? true, now: () => net.clock, transmit: net.transmit(name), state: opts.state,
    events: {
      message: (c, x) => log.msgs.push([c, x.text]),
      newContact: (c, x) => { log.requests.push(c); log.msgs.push([c.id, x.text]); },
      status: (id, s) => log.status.push([id, s]),
    },
  });
  m.displayName = name;
  net.nodes.set(name, m);
  return { m, ids, seed, log };
}

/** Como escanear o QR de `d`: chaves públicas + convite de uso único emitido por `d`. */
const contactOf = (d: ReturnType<typeof device>, name: string, via: 'public' | 'anon' = 'public'): Contact =>
  ({ id: d.ids[via].id, via, pub: toPublic(d.ids[via]), name, invite: d.m.issueInvite(via).code });
const INV = { code: '0011223344556677', expiresAt: T0 + 24 * 3600 };

test('cartão de contato: ida e volta, assinatura, validade e adulteração', () => {
  const me = deriveIdentity(newSeed(), 'public');
  const code = encodeCard(me, 'Cardeal', INV);
  const c = decodeCard(code, T0 + 10);
  assert.equal(c.id, me.id);
  assert.equal(c.name, 'Cardeal');
  assert.equal(c.invite, INV.code);
  assert.throws(() => decodeCard(code, T0 + 25 * 3600), /venceu/);
  const raw = unb64url(code.slice(5)); raw[40] ^= 1;
  assert.throws(() => decodeCard('piu1:' + b64url(raw), T0), /não confere|corrompido/);
  assert.throws(() => decodeCard(code.slice(0, -10), T0), /incompleto|corrompido|não confere/);
  assert.throws(() => decodeCard('https://exemplo.com', T0), /não é um código/);
  // Anônima: o cartão não leva nome.
  const anon = deriveIdentity(newSeed(), 'anon');
  assert.equal(decodeCard(encodeCard(anon, 'Não vaza', INV), T0).name, '');
  // Nome longo é cortado sem quebrar caracteres.
  assert.ok(decodeCard(encodeCard(me, 'á'.repeat(60), INV), T0).name.length <= 24);
});

test('direto: entrega, recibo de entrega cifrado e pedido de conversa', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi Beto');
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), ['m1']);
  net.link('Ana', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Oi Beto']]);
  assert.equal(b.log.requests.length, 1, 'quem não tinha o código recebe como pedido');
  assert.equal(b.log.requests[0].name, 'Ana');
  assert.deepEqual(a.log.status, [['m1', 'encaminhada'], ['m1', 'entregue']]);
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), []);
  // Resposta usa a mesma sessão; nada de texto em claro no fio.
  b.m.addContact(b.log.requests[0]);
  b.m.sendText(a.ids.public.id, 'r1', 'Oi Ana');
  net.run();
  assert.deepEqual(a.log.msgs, [[b.ids.public.id, 'Oi Ana']]);
  for (const w of net.wire) assert.ok(!Buffer.from(w).includes(Buffer.from('Oi ')), 'texto não aparece no fio');
});

test('store-and-forward por um relay que não lê nada', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  a.m.sendText(b.ids.public.id, 'm1', 'Pela malha');
  net.link('Ana', 'Relay');
  net.unlink('Ana', 'Relay');
  assert.equal(r.log.msgs.length, 0);
  net.clock += 600;
  net.link('Relay', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Pela malha']]);
  assert.deepEqual(a.log.status, [['m1', 'encaminhada']], 'recibo ainda não voltou');
  net.unlink('Relay', 'Beto');
  net.link('Relay', 'Ana');
  assert.deepEqual(a.log.status.at(-1), ['m1', 'entregue']);
});

test('Modo nó desligado: não guarda mensagens de terceiros', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay', { relay: false }), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'x');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Beto');
  assert.equal(b.log.msgs.length, 0);
});

test('reabrir o app: fila, sessões e ids vistos sobrevivem; replay depois de reabrir é ignorado', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  a.m.sendText(b.ids.public.id, 'm1', 'Antes de fechar');
  // Ana fecha o app sem ninguém por perto.
  const a2 = device(net, 'Ana', { seed: a.seed, state: a.m.export() });
  assert.deepEqual(a2.m.pendingFor(b.ids.public.id), ['m1']);
  net.link('Ana', 'Beto');
  assert.deepEqual(b.log.msgs, [[a.ids.public.id, 'Antes de fechar']]);
  assert.deepEqual(a2.log.status.at(-1), ['m1', 'entregue']);
  const captured = net.wire.slice();
  // Beto reabre; um atacante repete tudo o que passou no fio.
  const b2 = device(net, 'Beto', { seed: b.seed, state: b.m.export() });
  for (const w of captured) b2.m.receive('Atacante', w);
  net.run();
  assert.equal(b2.log.msgs.length, 0, 'nada repetido aparece de novo');
  net.unlink('Ana', 'Beto'); net.link('Ana', 'Beto'); // reconectam depois de reabrir
  // A sessão continua funcionando nos dois sentidos depois de reabrir.
  b2.m.sendText(a.ids.public.id, 'r1', 'Depois de reabrir');
  net.run();
  assert.deepEqual(a2.log.msgs, [[b.ids.public.id, 'Depois de reabrir']]);
  a2.m.sendText(b.ids.public.id, 'm2', 'De novo');
  net.run();
  assert.deepEqual(b2.log.msgs.at(-1), [a.ids.public.id, 'De novo']);
});

test('identidade anônima: conversa separada, sem nome no pedido', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact({ ...contactOf(b, '', 'anon'), via: 'anon' });
  a.m.sendText(b.ids.anon.id, 'm1', 'Anônimo para anônimo');
  net.link('Ana', 'Beto');
  assert.equal(b.log.requests.length, 1);
  assert.equal(b.log.requests[0].via, 'anon');
  assert.equal(b.log.requests[0].id, a.ids.anon.id);
  assert.equal(b.log.requests[0].name, '');
  assert.notEqual(b.log.requests[0].id, a.ids.public.id);
});

test('contatos: recusa o próprio código e chaves trocadas', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), e = device(net, 'Eva');
  assert.throws(() => a.m.addContact(contactOf(a, 'eu')), /próprio/);
  const forged = { ...contactOf(b, 'Beto'), pub: { ...toPublic(b.ids.public), agreePk: e.ids.public.agreePk } };
  assert.throws(() => a.m.addContact(forged), /inválidas/);
});

test('expiração: sem rota até o fim do TTL, a mensagem sai da fila como "expirada"', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Ninguém por perto');
  net.clock += 47 * 3600;
  a.m.tick();
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), ['m1'], 'ainda dentro do prazo de 48 h');
  net.clock += 2 * 3600;
  a.m.tick();
  assert.deepEqual(a.m.pendingFor(b.ids.public.id), []);
  assert.deepEqual(a.log.status.at(-1), ['m1', 'expirada']);
});

test('QR de uso único: o segundo uso e quem não tem convite são recusados; novo código revoga o anterior', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), e = device(net, 'Eva');
  const inv = b.m.issueInvite('public');
  assert.equal(b.m.issueInvite('public').code, inv.code, 'o mesmo QR enquanto não for usado');
  const card = { id: b.ids.public.id, via: 'public' as const, pub: toPublic(b.ids.public), name: 'Beto', invite: inv.code };
  a.m.addContact(card);
  e.m.addContact(card); // Eva fotografou o mesmo QR
  a.m.sendText(b.ids.public.id, 'a1', 'Sou a Ana');
  net.link('Ana', 'Beto');
  assert.equal(b.log.requests.length, 1);
  assert.notEqual(b.m.issueInvite('public').code, inv.code, 'usado: o QR troca de código');
  e.m.sendText(b.ids.public.id, 'e1', 'Sou a Eva');
  net.link('Eva', 'Beto');
  assert.equal(b.log.requests.length, 1, 'convite já usado: Eva não entra');
  assert.ok(!b.log.msgs.some(([, t]) => t === 'Sou a Eva'));
  // Sem convite nenhum (só a chave pública): também não.
  const f = device(net, 'Fred');
  f.m.addContact({ id: b.ids.public.id, via: 'public', pub: toPublic(b.ids.public), name: 'Beto' });
  f.m.sendText(b.ids.public.id, 'f1', 'Sem convite');
  net.link('Fred', 'Beto');
  assert.equal(b.log.requests.length, 1);
  // "Gerar novo código" revoga o anterior ainda não usado.
  const old = b.m.issueInvite('public');
  const fresh = b.m.issueInvite('public', true);
  assert.notEqual(fresh.code, old.code);
  const g = device(net, 'Gil');
  g.m.addContact({ ...card, invite: old.code });
  g.m.sendText(b.ids.public.id, 'g1', 'Com o código revogado');
  net.link('Gil', 'Beto');
  assert.equal(b.log.requests.length, 1);
  // Convite da identidade pública não abre conversa na anônima.
  const h = device(net, 'Hugo');
  h.m.addContact({ id: b.ids.anon.id, via: 'anon', pub: toPublic(b.ids.anon), name: '', invite: fresh.code });
  h.m.sendText(b.ids.anon.id, 'h1', 'Convite trocado de identidade');
  net.link('Hugo', 'Beto');
  assert.equal(b.log.requests.length, 1);
});

test('limites do nó: tráfego diário, horário e banda valem só para terceiros', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  let hour = 12;
  r.m.clock = { hour: () => hour, day: () => 'd1' };
  r.m.setPolicy({ maxBytes: 64 << 20, retentionSec: 48 * 3600, dailyBytes: 1 << 20, bytesPerSec: Infinity, hours: 'night' });
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'De dia o relay não aceita');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  assert.equal(r.m.relayStatus().reason, 'hours');
  net.link('Relay', 'Beto'); net.unlink('Relay', 'Beto');
  assert.equal(b.log.msgs.length, 0, 'fora do horário: não guardou');
  // À noite, guarda e entrega.
  hour = 23; r.m.tick();
  a.m.sendText(b.ids.public.id, 'm2', 'À noite o relay aceita');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Beto');
  assert.equal(b.log.msgs.length, 1);
  // Teto diário minúsculo: depois do primeiro envelope de terceiros, para de retransmitir.
  net.unlink('Relay', 'Beto');
  r.m.setPolicy({ maxBytes: 64 << 20, retentionSec: 48 * 3600, dailyBytes: 1, bytesPerSec: Infinity, hours: 'always' });
  assert.equal(r.m.relayStatus().reason, 'daily');
  // As próprias mensagens do relay continuam saindo.
  r.m.addContact(contactOf(b, 'Beto'));
  r.m.sendText(b.ids.public.id, 'r1', 'Minha própria');
  net.link('Relay', 'Beto');
  assert.ok(b.log.msgs.some(([, t]) => t === 'Minha própria'));
});

test('limites do nó: banda zero segura terceiros na fila, sem marcar como enviados', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  r.m.setPolicy({ maxBytes: 64 << 20, retentionSec: 48 * 3600, dailyBytes: 1 << 30, bytesPerSec: 0, hours: 'always' });
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Banda zero');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Beto');
  assert.equal(b.log.msgs.length, 0, 'sem banda: não saiu');
  r.m.setPolicy({ maxBytes: 64 << 20, retentionSec: 48 * 3600, dailyBytes: 1 << 30, bytesPerSec: Infinity, hours: 'always' });
  r.m.tick(); net.run();
  assert.equal(b.log.msgs.length, 1, 'com banda: sai na rodada seguinte');
});

test('arquivo em blocos: chega inteiro e conferido, mesmo com pausa e retomada no meio', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  b.m.addContact(contactOf(a, 'Ana'));
  const files: { name: string; data: Uint8Array }[] = [];
  const progress: number[] = [];
  let delivered = '';
  (b.m as unknown as { o: { events: Record<string, unknown> } }).o.events.fileReceived = (_c: string, f: { name: string; data: Uint8Array }) => files.push(f);
  (a.m as unknown as { o: { events: Record<string, unknown> } }).o.events.fileProgress = (_i: string, d: number) => progress.push(d);
  (a.m as unknown as { o: { events: Record<string, unknown> } }).o.events.fileDelivered = (id: string) => { delivered = id; };
  const data = new Uint8Array(100_000); for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;
  const { blocks } = a.m.sendFile(b.ids.public.id, 'f1', { name: 'mapa.pdf', mime: 'application/pdf', data });
  assert.equal(blocks, Math.ceil(100_000 / (12 * 1024)));
  a.m.setFilePaused('f1', true);
  net.link('Ana', 'Beto');
  assert.equal(files.length, 0, 'pausado: só a primeira janela saiu');
  a.m.setFilePaused('f1', false); net.run();
  for (let i = 0; i < 50 && !files.length; i++) { a.m.tick(); b.m.tick(); net.run(); }
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'mapa.pdf');
  assert.deepEqual(files[0].data, data);
  assert.equal(delivered, 'f1');
  assert.equal(progress.at(-1), blocks);
  for (const w of net.wire) assert.ok(!Buffer.from(w).includes(Buffer.from('mapa.pdf')), 'nome do arquivo não aparece no fio');
});

test('arquivo: bloco adulterado ou de desconhecido não monta nada', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto')); // Beto não conhece Ana: oferta de arquivo é ignorada
  let got = 0;
  (b.m as unknown as { o: { events: Record<string, unknown> } }).o.events.fileReceived = () => { got++; };
  a.m.sendFile(b.ids.public.id, 'f1', { name: 'x.bin', mime: 'application/octet-stream', data: new Uint8Array(5000).fill(7) });
  net.link('Ana', 'Beto');
  assert.equal(got, 0);
  assert.throws(() => a.m.sendFile(b.ids.public.id, 'f2', { name: 'grande', mime: '', data: new Uint8Array(51 * 1024 * 1024) }), /50 MB/);
});

/** Três pessoas que se conhecem (todos escanearam todos), ligadas em malha. */
function trio() {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  for (const [x, y, n] of [[a, b, 'Beto'], [a, c, 'Caio'], [b, a, 'Ana'], [b, c, 'Caio'], [c, a, 'Ana'], [c, b, 'Beto']] as const) x.m.addContact({ ...contactOf(y, n), invite: undefined });
  const glog = new Map<string, [string, string][]>();
  for (const [d, n] of [[a, 'Ana'], [b, 'Beto'], [c, 'Caio']] as const) {
    glog.set(n, []);
    (d.m as unknown as { o: { events: Record<string, unknown> } }).o.events.groupMessage = (_g: string, _f: string, who: string, m: { text: string }) => glog.get(n)!.push([who, m.text]);
  }
  const all = () => { net.link('Ana', 'Beto'); net.link('Beto', 'Caio'); net.link('Ana', 'Caio'); };
  return { net, a, b, c, glog, all };
}

test('grupo: só membros leem; remover troca a chave e quem saiu não lê nem publica', () => {
  const { net, a, b, c, glog, all } = trio();
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id] });
  all();
  assert.equal(b.m.getGroup(g.id)?.name, 'Mutirão');
  a.m.sendGroupText(g.id, 'g1', 'Gerador ligado');
  net.run();
  assert.deepEqual(glog.get('Beto'), [['Ana', 'Gerador ligado']]);
  assert.deepEqual(glog.get('Caio'), [['Ana', 'Gerador ligado']]);
  for (const w of net.wire) assert.ok(!Buffer.from(w).includes(Buffer.from('Gerador')), 'relays não leem');
  // Remove Caio: chave v2. Caio não lê mais e não consegue publicar.
  a.m.removeMember(g.id, c.ids.public.id);
  net.run();
  assert.equal(b.m.getGroup(g.id)?.keyV, 2);
  assert.equal(c.m.getGroup(g.id), undefined, 'Caio foi avisado e apagou o grupo');
  a.m.sendGroupText(g.id, 'g2', 'Depois da troca');
  net.run();
  assert.ok(glog.get('Beto')!.some(([, t]) => t === 'Depois da troca'));
  assert.ok(!glog.get('Caio')!.some(([, t]) => t === 'Depois da troca'));
  assert.throws(() => c.m.sendGroupText(g.id, 'x', 'oi'), /desconhecido/);
});

test('grupo: estado só de admin, sem voltar atrás; membro comum não muda nada', () => {
  const { net, a, b, c, all } = trio();
  const g = a.m.createGroup({ kind: 'group', name: 'Feira', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id] });
  all();
  assert.throws(() => b.m.updateGroup(g.id, { name: 'Golpe' }), /Só admins/);
  // Beto forja um estado novo (se dizendo admin) e manda para Caio: recusado.
  const forged = { ...b.m.getGroup(g.id)!, rev: 99, name: 'Golpe', members: b.m.getGroup(g.id)!.members.map(m => ({ ...m, role: 'admin' as const })) };
  (b.m as unknown as { distribute: (x: unknown) => void }).distribute(forged);
  net.run();
  assert.equal(c.m.getGroup(g.id)?.name, 'Feira');
  // Admin muda o nome: chega a todos.
  a.m.updateGroup(g.id, { name: 'Feira Livre' });
  net.run();
  assert.equal(c.m.getGroup(g.id)?.name, 'Feira Livre');
});

test('canal: só admins publicam; inscritos leem', () => {
  const { net, a, b, c, glog, all } = trio();
  const ch = a.m.createGroup({ kind: 'channel', name: 'Defesa Civil', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id], visibility: 'public' });
  all();
  assert.throws(() => b.m.sendGroupText(ch.id, 'x', 'Posso?'), /Só admins/);
  a.m.sendGroupText(ch.id, 'p1', 'Alerta: estrada interditada');
  net.run();
  assert.deepEqual(glog.get('Caio'), [['Ana', 'Alerta: estrada interditada']]);
  assert.equal(c.m.getGroup(ch.id)?.visibility, 'public');
});

test('comunidade: reúne grupos e canais criados dentro dela', () => {
  const { a, b, c, all } = trio();
  const com = a.m.createGroup({ kind: 'community', name: 'Vila Esperança', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id] });
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id], parent: com.id });
  all();
  assert.deepEqual(c.m.getGroup(com.id)?.children?.map(x => x.name), ['Mutirão']);
  assert.equal(b.m.getGroup(g.id)?.parent, com.id);
});

test('convite do grupo: 7 dias e até 50 usos, com aprovação do admin', () => {
  const net = new Net();
  const a = device(net, 'Ana'), d = device(net, 'Davi'), e = device(net, 'Eva');
  const g = a.m.createGroup({ kind: 'group', name: 'Rádio', via: 'public', memberIds: [], approve: true });
  const inv = a.m.groupInvite(g.id);
  const asContact = { id: a.ids.public.id, via: 'public' as const, pub: toPublic(a.ids.public), name: 'Ana' };
  const asked: string[] = [];
  (a.m as unknown as { o: { events: Record<string, unknown> } }).o.events.joinRequest = (_g: string, w: { name: string }) => asked.push(w.name);
  d.m.requestJoin(asContact, g.id, inv.code);
  net.link('Davi', 'Ana');
  assert.deepEqual(asked, ['Davi']);
  assert.equal(d.m.getGroup(g.id), undefined, 'ainda aguardando aprovação');
  a.m.answerJoin(g.id, d.ids.public.id, true);
  net.run();
  assert.equal(d.m.getGroup(g.id)?.name, 'Rádio');
  // Código errado ou revogado: nada acontece.
  a.m.groupInvite(g.id, true);
  e.m.requestJoin(asContact, g.id, inv.code);
  net.link('Eva', 'Ana');
  assert.deepEqual(asked, ['Davi']);
  // 7 dias depois, vencido.
  const fresh = a.m.groupInvite(g.id);
  net.clock += 8 * 24 * 3600;
  e.m.requestJoin(asContact, g.id, fresh.code);
  net.run();
  assert.deepEqual(asked, ['Davi']);
});

test('grupo: estado salvo e restaurado continua lendo e publicando', () => {
  const { net, a, b, c, glog, all } = trio();
  const g = a.m.createGroup({ kind: 'group', name: 'Mutirão', via: 'public', memberIds: [b.ids.public.id, c.ids.public.id] });
  all();
  const b2 = device(net, 'Beto', { seed: b.seed, state: b.m.export() });
  (b2.m as unknown as { o: { events: Record<string, unknown> } }).o.events.groupMessage = (_g: string, _f: string, who: string, m: { text: string }) => glog.get('Beto')!.push([who, m.text]);
  net.unlink('Ana', 'Beto'); net.unlink('Beto', 'Caio'); net.link('Ana', 'Beto'); net.link('Beto', 'Caio');
  a.m.sendGroupText(g.id, 'g1', 'Depois de reabrir');
  net.run();
  assert.ok(glog.get('Beto')!.some(([, t]) => t === 'Depois de reabrir'));
  b2.m.sendGroupText(g.id, 'b1', 'Beto também publica');
  net.run();
  assert.ok(glog.get('Caio')!.some(([w, t]) => w === 'Beto' && t === 'Beto também publica'));
});

test('comunidade: membro pede para entrar num grupo dela; sem ser da comunidade, não entra', () => {
  const { net, a, b, c, all } = trio();
  const com = a.m.createGroup({ kind: 'community', name: 'Vila', via: 'public', memberIds: [b.ids.public.id] });
  const g = a.m.createGroup({ kind: 'group', name: 'Horta', via: 'public', memberIds: [], parent: com.id, approve: false });
  all();
  b.m.requestJoinChild(com.id, g.id);
  net.run();
  assert.equal(b.m.getGroup(g.id)?.name, 'Horta', 'membro da comunidade entrou (sem aprovação)');
  // Caio não é da comunidade: forja o pedido direto para Ana.
  (c.m as unknown as { enqueue: (ct: unknown, p: unknown, i: null, pr: number) => void }).enqueue(c.m.getContact(a.ids.public.id), { t: 'gj', g: g.id, c: 'community:' + com.id }, null, 2);
  net.run();
  assert.equal(c.m.getGroup(g.id), undefined);
});

test('créditos: relay ganha recibo, a prova de entrega volta pela malha e valida; sem prova, rejeitado', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Pela malha');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  assert.equal(r.m.credits.list().length, 0, 'recibo só nasce ao repassar');
  net.link('Relay', 'Beto'); // repassa (recibo) → entrega → Beto publica a prova, que chega ao relay
  assert.equal(r.m.credits.totals().pendente, 0);
  assert.ok(r.m.credits.totals().validado > 0, 'validado pela prova do destino');
  // Prova falsa (segredo errado) não valida outro envelope.
  net.unlink('Relay', 'Beto');
  const eva = device(net, 'Eva');
  a.m.sendText(b.ids.public.id, 'm2', 'Segunda');
  net.link('Ana', 'Relay'); net.unlink('Ana', 'Relay');
  net.link('Relay', 'Eva'); net.unlink('Relay', 'Eva'); // repassou a quem não é o destino: pendente
  void eva;
  const pend = r.m.credits.list().find(c => c.state === 'pendente')!;
  const fake = new Uint8Array(3 + 32); fake[0] = 0x50; fake[1] = 0x52; fake[2] = 1;
  fake.set(Uint8Array.from(pend.envelopeId.match(/../g)!.map(x => parseInt(x, 16))), 3);
  r.m.receive('Eva', fake);
  assert.equal(r.m.credits.get(pend.envelopeId)?.state, 'pendente');
  // Nunca entregue: depois de vencer, rejeitado.
  net.clock += 4 * 24 * 3600; r.m.tick();
  assert.equal(r.m.credits.get(pend.envelopeId)?.state, 'rejeitado');
  // O remetente não ganha crédito pelas próprias mensagens.
  assert.equal(a.m.credits.list().length, 0);
});

test('créditos: lote semanal (simulado) paga validados depois da carência, com mínimo de 5 LUNES', async () => {
  const { CreditBook, CREDIT_PARAMS } = await import('../credits');
  const { makeRelayReceipt } = await import('../../protocol/receipts');
  const { deriveNodeKey: dn } = await import('../../protocol/keys');
  const { hash } = await import('../../protocol/suite');
  const node = dn(newSeed());
  const book = new CreditBook();
  const t0 = 1_800_000_000;
  const n = CREDIT_PARAMS.minLotLunes * CREDIT_PARAMS.creditsPerLunes + 10;
  for (let i = 0; i < n; i++) {
    const secret = Uint8Array.of(i & 255, i >> 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7);
    const id = (i.toString(16).padStart(8, '0')).repeat(4);
    book.addReceipt(makeRelayReceipt(node, id, hash(secret).slice(0, 16), t0), { bytes: 300, expiresAt: t0 + 3600 }, 'ble');
    assert.ok(book.applyProof(id, secret));
  }
  assert.equal(book.tick(t0 + 3 * 86400).lot, undefined, 'ainda na carência');
  const res = book.tick(t0 + 15 * 86400);
  assert.ok(res.lot);
  assert.equal(res.lot!.count, n);
  assert.equal(res.lot!.simulated, true);
  assert.equal(book.totals().validado, 0);
  assert.equal(book.totals().pago, n);
  // Estado salvo e restaurado.
  const again = new CreditBook(book.export(t0 + 15 * 86400));
  assert.equal(again.totals().pago, n);
  assert.equal(again.lots.length, 1);
});

test('métricas: enviadas, entregues, latência e saltos medidos neste aparelho', () => {
  const net = new Net();
  const a = device(net, 'Ana'), r = device(net, 'Relay'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto'));
  a.m.sendText(b.ids.public.id, 'm1', 'Oi');
  net.link('Ana', 'Relay'); net.link('Relay', 'Beto');
  net.clock += 5; a.m.tick(); b.m.tick(); r.m.tick(); net.run();
  const m = a.m.metrics();
  assert.equal(m.sent, 1);
  assert.equal(m.delivered, 1);
  assert.ok(m.latencyMedian !== null);
  assert.deepEqual(Object.keys(b.m.metrics().hops), ['2']);
  assert.equal(r.m.metrics().relayedToday > 0, true);
});

test('foto do perfil: só para contatos públicos, conferida, e nunca pela identidade anônima', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto'), c = device(net, 'Caio');
  const photos: [string, string, string | null][] = [];
  for (const [n, d] of [['Beto', b], ['Caio', c]] as const) (d.m as unknown as { o: { events: Record<string, unknown> } }).o.events.peerPhoto = (id: string, p: string | null) => photos.push([n, id, p]);
  a.m.addContact(contactOf(b, 'Beto'));            // pública
  a.m.addContact(contactOf(c, 'Caio', 'anon'));    // anônima
  b.m.addContact(contactOf(a, 'Ana'));
  c.m.addContact(contactOf(a, 'Ana', 'anon'));
  net.link('Ana', 'Beto'); net.link('Ana', 'Caio');
  const jpeg = '/9j/' + 'A'.repeat(200);
  a.m.sendProfilePhoto(jpeg);
  net.run();
  assert.deepEqual(photos, [['Beto', a.ids.public.id, jpeg]], 'só o contato público recebe');
  a.m.sendProfilePhoto(null);
  net.run();
  assert.deepEqual(photos.at(-1), ['Beto', a.ids.public.id, null], 'remover a foto avisa');
  // Conteúdo que não é JPEG chega como "sem foto".
  (a.m as unknown as { enqueue: (...x: unknown[]) => void }).enqueue(a.m.getContact(b.ids.public.id), { t: 'pp', p: 'iVBORw0KGgo=' }, null, 1, true);
  net.run();
  assert.deepEqual(photos.at(-1), ['Beto', a.ids.public.id, null]);
});

test('bloqueio: mensagens de quem está bloqueado são descartadas, sem confirmação de entrega', () => {
  const net = new Net();
  const a = device(net, 'Ana'), b = device(net, 'Beto');
  a.m.addContact(contactOf(b, 'Beto')); b.m.addContact(contactOf(a, 'Ana'));
  net.link('Ana', 'Beto');
  b.m.setBlocked([a.ids.public.id]);
  a.m.sendText(b.ids.public.id, 'm1', 'Oi, você me bloqueou?');
  net.run();
  assert.deepEqual(b.log.msgs, [], 'nada entregue');
  assert.ok(!a.log.status.some(([id, s]) => id === 'm1' && s === 'entregue'), 'quem mandou não recebe confirmação');
  // Desbloqueado: as próximas chegam (o que foi mandado durante o bloqueio não é reentregue).
  b.m.setBlocked([]);
  a.m.sendText(b.ids.public.id, 'm2', 'Agora sim');
  net.run();
  assert.deepEqual(b.log.msgs.map(x => x[1]), ['Agora sim']);
});
