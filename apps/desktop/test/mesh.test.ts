import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../mobile/src/protocol/keys';
import { startRelay } from '../../piu-node/src/relay/index.js';
import { DEFAULT_SETTINGS } from '../../piu-node/src/store.js';
import { createIdentity, identityFromPhrase } from '../src/main/identity';
import { MeshNode } from '../src/main/mesh';
import type { ContactInfo, Route } from '../src/shared/types';
import { LnnpLanTransport } from '../src/transport/lnnpLan';

async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

interface Log { alerts: { title: string; sev: string; community: string; level: string | null }[]; groups: { contact: ContactInfo; change: string }[]; groupMessages: { contact: ContactInfo; sender: string; text: string }[]; messages: { from: ContactInfo; text: string; isNew: boolean; route?: Route }[]; status: { msgId: string; status: string; route?: Route }[] }

const cleanup: (() => Promise<unknown>)[] = [];
async function person(name: string, peers: string[], state?: string) {
  const log: Log = { messages: [], status: [], groups: [], groupMessages: [], alerts: [] };
  const { keys, phrase } = createIdentity();
  const lan = new LnnpLanTransport({ node: keys.node, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers, beaconMs: 150, handshakeTimeoutMs: 2000 });
  const mesh = new MeshNode({
    keys, transports: [lan], relay: true, displayName: name, state,
    events: {
      message: (from, m, isNew) => log.messages.push({ from, text: m.text, isNew, route: m.route ? { peer: m.route.peer, via: m.route.via, bytes: m.route.bytes, hops: m.route.hops } : undefined }),
      status: (msgId, status, route) => log.status.push({ msgId, status, route }),
      groupChanged: (contact, change) => log.groups.push({ contact, change }),
      groupMessage: (contact, m, sender) => log.groupMessages.push({ contact, sender, text: m.text }),
      communityAlert: (a, notice) => log.alerts.push({ title: a.title, sev: a.sev, community: a.contactId, level: notice?.level ?? null }),
    },
  });
  await mesh.start(100);
  cleanup.push(() => mesh.stop().catch(() => {}));
  return { mesh, lan, log, phrase };
}
const closeAll = async () => { await Promise.all(cleanup.splice(0).map(f => f())); };

test('desktop ↔ desktop pela LAN: cartão colado vira contato; texto vai cifrado, chega e volta o recibo', async t => {
  t.after(closeAll);
  const B = await person('Bia', []);
  const A = await person('Ana', [`127.0.0.1:${B.lan.port}`]);
  await until(() => A.lan.linkCount === 1 && B.lan.linkCount === 1, 'enlace');

  // Bia mostra o código; Ana cola.
  const card = B.mesh.myCard('public');
  assert.match(card.card, /^piu1:/);
  const bia = A.mesh.addContactByCard(card.card);
  assert.equal(bia.id, B.mesh.ids.publicId);
  assert.equal(bia.name, 'Bia');
  assert.throws(() => B.mesh.addContactByCard(card.card), /próprio código/);

  const id = A.mesh.sendText(bia.id, 'oi, Bia, do computador');
  await until(() => B.log.messages.length === 1, 'Bia receber');
  const got = B.log.messages[0]!;
  assert.equal(got.text, 'oi, Bia, do computador');
  assert.equal(got.isNew, true, 'pedido de conversa: Bia não tinha o código de Ana');
  assert.equal(got.from.name, 'Ana', 'o nome vai na primeira mensagem (identidade pública)');
  assert.equal(got.route?.via, 'eth');
  assert.equal(got.route?.hops, 1);
  await until(() => A.log.status.some(s => s.msgId === id && s.status === 'entregue'), 'recibo cifrado voltar para Ana');
  assert.ok(A.log.status.some(s => s.msgId === id && s.status === 'encaminhada' && s.route?.peer === B.lan.nodeId));

  // Bia responde: a conversa deixa de ser pedido e a sessão (catraca) segue nos dois sentidos.
  const back = B.mesh.sendText(got.from.id, 'oi, Ana!');
  await until(() => A.log.messages.length === 1, 'Ana receber a resposta');
  assert.equal(A.log.messages[0]!.text, 'oi, Ana!');
  assert.equal(B.mesh.listContacts()[0]!.request, false);
  await until(() => B.log.status.some(s => s.msgId === back && s.status === 'entregue'), 'recibo para Bia');

  // Código de segurança: igual nos dois lados.
  assert.deepEqual(A.mesh.safetyCode(bia.id), B.mesh.safetyCode(A.mesh.ids.publicId));
  assert.equal(A.mesh.safetyCode(bia.id).length, 12);
});

test('desktop → piu-node (relay real) → desktop: store-and-forward por um nó da rede, sem enlace direto', async t => {
  t.after(closeAll);
  // Nó do provider, como instalado num roteador/Raspberry Pi; só vizinhos fixos (sem UDP no teste).
  const relay = await startRelay(deriveNodeKey(newSeed()), {
    enabled: true, relay: true, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [], memoryMB: 16, allow: null, beaconMs: 200,
  }, DEFAULT_SETTINGS, { tickMs: 100 });
  cleanup.push(() => relay.close());
  const R = `127.0.0.1:${relay.port}`;

  const B = await person('Bia', []);
  const cardB = B.mesh.myCard('anon'); // identidade anônima: sem nome no cartão
  const stateB = B.mesh.export(); // o convite emitido fica no estado (uso único, conferido na volta)
  await B.mesh.stop(); // Bia sai da rede antes de a mensagem existir

  const A = await person('Ana', [R]);
  await until(() => A.lan.linkCount === 1, 'Ana ligada ao nó');
  const bia = A.mesh.addContactByCard(cardB.card);
  assert.equal(bia.via, 'anon');
  const id = A.mesh.sendText(bia.id, 'guardado no nó até você voltar');
  await until(() => A.log.status.some(s => s.msgId === id && s.status === 'encaminhada'), 'saiu de Ana para o nó');
  await until(() => relay.engine.counters.stored >= 1, 'o nó guardou o envelope');
  await A.mesh.stop();

  // Bia volta: mesma frase (mesmas chaves) e o estado gravado, ligada só ao nó.
  const B3 = new MeshNode({
    keys: identityFromPhrase(B.phrase),
    transports: [new LnnpLanTransport({ node: deriveNodeKey(newSeed()), listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers: [R], beaconMs: 150 })],
    relay: true, displayName: 'Bia', state: stateB,
    events: { message: (from, m, isNew) => B.log.messages.push({ from, text: m.text, isNew }) },
  });
  await B3.start(100);
  cleanup.push(() => B3.stop());
  await until(() => B.log.messages.length === 1, 'Bia receber pelo nó', 10000);
  assert.equal(B.log.messages[0]!.text, 'guardado no nó até você voltar');
  assert.equal(B.log.messages[0]!.isNew, true);
  // O nó nunca abriu nada: só guardou e repassou (sem identidade local, inbox vazia).
  assert.equal(relay.engine.counters.delivered, 0);
  assert.ok(relay.engine.counters.forwarded >= 1);
});


test('grupos e canais nativos: distribuição cifrada, mensagens, permissões e persistência', async t => {
  t.after(closeAll);
  const B = await person('Bia', []);
  const A = await person('Ana', [`127.0.0.1:${B.lan.port}`]);
  await until(() => A.lan.linkCount === 1 && B.lan.linkCount === 1, 'enlace');
  const bia = A.mesh.addContactByCard(B.mesh.myCard('public').card);
  A.mesh.sendText(bia.id, 'oi');
  await until(() => B.log.messages.length === 1, 'pedido');
  B.mesh.sendText(A.mesh.ids.publicId, 'olá');
  await until(() => A.log.messages.length === 1, 'resposta');
  const group = A.mesh.createGroup({ kind: 'group', name: 'Equipe', via: 'public', memberIds: [bia.id] });
  await until(() => B.mesh.listGroups().some(g => g.id === group.id), 'grupo distribuído');
  assert.equal(B.mesh.listGroups().find(g => g.id === group.id)?.canPost, true);
  A.mesh.sendText(group.id, 'mensagem protegida');
  await until(() => B.log.groupMessages.length === 1, 'mensagem do grupo');
  assert.equal(B.log.groupMessages[0]?.text, 'mensagem protegida');
  assert.equal(B.log.groupMessages[0]?.sender, 'Ana');
  const ch = A.mesh.createGroup({ kind: 'channel', name: 'Avisos', via: 'public', memberIds: [bia.id] });
  await until(() => B.mesh.listGroups().some(g => g.id === ch.id), 'canal distribuído');
  assert.equal(B.mesh.listGroups().find(g => g.id === ch.id)?.canPost, false);
  assert.throws(() => B.mesh.sendText(ch.id, 'não autorizado'), /Só admins/);
  A.mesh.setGroupRole(ch.id, B.mesh.ids.publicId, 'admin');
  await until(() => B.mesh.listGroups().find(g => g.id === ch.id)?.canPost === true, 'permissão concedida');
  B.mesh.sendText(ch.id, 'publicação autorizada');
  await until(() => A.log.groupMessages.some(m => m.text === 'publicação autorizada'), 'publicação do admin');
  A.mesh.setGroupRole(ch.id, B.mesh.ids.publicId, 'member');
  await until(() => B.mesh.listGroups().find(g => g.id === ch.id)?.canPost === false, 'permissão revogada');
  assert.throws(() => B.mesh.sendText(ch.id, 'revogado'), /Só admins/);
  assert.throws(() => B.mesh.createGroup({ kind: 'group', name: ' ', via: 'public', memberIds: [] }), /nome/);
  assert.throws(() => A.mesh.sendText('group:invalido', 'x'), /desconhecido/);
  const restored = new MeshNode({ keys: identityFromPhrase(A.phrase), transports: [], relay: false, displayName: 'Ana', state: A.mesh.export(), events: {} });
  assert.deepEqual(restored.listGroups().map(g => g.id).sort(), [group.id, ch.id].sort());
});

test('alerta da comunidade chega ao computador: Grave vira aviso crítico, com o id da conversa da comunidade', async t => {
  t.after(closeAll);
  const B = await person('Bia', []);
  const A = await person('Ana', [`127.0.0.1:${B.lan.port}`]);
  await until(() => A.lan.linkCount === 1 && B.lan.linkCount === 1, 'enlace');
  const bia = A.mesh.addContactByCard(B.mesh.myCard('public').card);
  A.mesh.sendText(bia.id, 'oi');
  await until(() => B.log.messages.length === 1, 'pedido');
  B.mesh.sendText(A.mesh.ids.publicId, 'olá');
  await until(() => A.log.messages.length === 1, 'resposta');
  const com = A.mesh.createGroup({ kind: 'community', name: 'Bairro', via: 'public', memberIds: [bia.id] });
  await until(() => B.mesh.listGroups().some(g => g.id === com.id), 'comunidade distribuída');
  A.mesh.messenger.publishAlert(com.id.replace(/^group:/, ''), { cat: 'agua', sev: 'grave', title: 'Rio subindo', text: 'Saiam da beira do rio.', area: 'Centro', durSec: 3600 });
  await until(() => B.log.alerts.length > 0, 'alerta recebido');
  assert.deepEqual(B.log.alerts[0], { title: 'Rio subindo', sev: 'grave', community: com.id, level: 'critical' });
  assert.equal(A.log.alerts.length, 0, 'o meu próprio alerta não me avisa');
});
