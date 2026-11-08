/// <reference types="node" />
/**
 * Carga pela malha no mensageiro (docs/carteira/transacoes-pela-malha.md): o celular sem internet
 * assina e solta a transação; um relay (inclusive só com o roteador antigo) leva; o gateway com
 * internet envia à Lunes falsa e o recibo volta pela malha para a identidade descartável.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarryChain, CarryKind, type CarryReceipt, gatewayKindOf, type OpenedCarry, sealCarry } from '../../protocol/carry';
import { deriveIdentity, deriveNodeKey, newSeed } from '../../protocol/keys';
import { Router } from '../../protocol/router';
import { toHex as hex0x } from '../../lib/lunesRpc';
import { CarryGateway } from '../../lib/carryGateway';
import { fakeLunes, signedCarried } from '../../lib/__tests__/carryFake';
import { Messenger } from '../messenger';

const T0 = 1_800_000_000;
class Net {
  clock = T0;
  nodes = new Map<string, { receive: (from: string, b: Uint8Array) => unknown }>();
  links = new Set<string>();
  queue: [string, string, Uint8Array][] = [];
  key = (a: string, b: string) => [a, b].sort().join('~');
  transmit = (from: string) => async (to: string, bytes: Uint8Array) => { if (this.links.has(this.key(from, to))) this.queue.push([from, to, bytes]); };
  run() { for (let i = 0; i < 1000 && this.queue.length; i++) { const [f, t, b] = this.queue.shift()!; this.nodes.get(t)!.receive(f, b); } }
}
function phone(net: Net, name: string, events: ConstructorParameters<typeof Messenger>[0]['events'] = {}, state?: string) {
  const seed = newSeed();
  const m = new Messenger({ identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') }, node: deriveNodeKey(seed), relay: true, now: () => net.clock, transmit: net.transmit(name), events, state });
  net.nodes.set(name, m);
  return m;
}
const link = (net: Net, a: string, b: string) => {
  net.links.add(net.key(a, b));
  for (const [x, y] of [[a, b], [b, a]] as const) { const n = net.nodes.get(x) as unknown as { peerConnected?: (p: string, v: 'ble') => void }; n.peerConnected?.(y, 'ble'); }
  net.run();
};

/** Relay só com o roteador antigo (sem nada de carry): repassa como envelope de terceiros. */
function oldRelay(net: Net, name: string) {
  const r = new Router({ node: deriveNodeKey(newSeed()), identities: [deriveIdentity(newSeed(), 'public')], relay: true });
  const peers = new Set<string>();
  const flush = () => { for (const p of peers) for (const b of r.outgoing(p, 'ble', net.clock)) void net.transmit(name)(p, b); };
  net.nodes.set(name, { receive: (from: string, b: Uint8Array) => { r.ingest(b, from, net.clock); flush(); }, peerConnected: (p: string) => { peers.add(p); flush(); } } as never);
  return r;
}

test('celular offline → relay antigo → gateway com internet → Lunes; recibos voltam (pool, em bloco, finalizada)', async () => {
  const net = new Net();
  const receipts: [string, CarryReceipt][] = [];
  const ana = phone(net, 'Ana', { carryReceipt: (id, r) => receipts.push([id, r]) });
  const relay = oldRelay(net, 'Relay');
  const chain = fakeLunes();
  const arrived: OpenedCarry[] = [];
  let gw: CarryGateway;
  const gate = phone(net, 'Gate', { gatewayCarry: c => { arrived.push(c); void gw.handle(c); } });
  gw = new CarryGateway({ rpc: chain.rpc, now: () => net.clock, reply: (to, rc) => gate.sendCarryReceipt(to, rc) });
  gate.setGateway({ tx: true });

  const t = signedCarried();
  const { envelopeId } = ana.carry({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: t.extrinsic }, t.hash);
  assert.ok(ana.carryQueued(envelopeId));
  link(net, 'Ana', 'Relay');
  assert.equal(relay.size, 1, 'o relay antigo guardou a carga como envelope de terceiros');
  link(net, 'Relay', 'Gate');
  assert.equal(arrived.length, 1);
  // RPC falso responde em ms; espera o envio e o recibo atravessarem a malha.
  for (let i = 0; i < 300 && !receipts.length; i++) { await new Promise(r => setTimeout(r, 10)); net.run(); }
  assert.equal(chain.submissions.length, 1);
  assert.deepEqual(receipts.map(([, r]) => r.status), ['pool']);
  assert.equal(receipts[0]![0], envelopeId);
  assert.equal(hex0x(receipts[0]![1].ref), t.hash);
  chain.mine(1, true);
  await gw.tick(); net.run();
  assert.deepEqual(receipts.map(([, r]) => r.status), ['pool', 'included', 'finalized']);
  assert.equal(ana.carryQueued(envelopeId), false, 'recibo final: Ana para de espalhar a própria cópia');
});

test('sem o papel de gateway a carga só passa adiante; recibo forjado sobre outra carga é ignorado', () => {
  const net = new Net();
  const receipts: CarryReceipt[] = [];
  const ana = phone(net, 'Ana', { carryReceipt: (_id, r) => receipts.push(r) });
  const arrived: OpenedCarry[] = [];
  const bia = phone(net, 'Bia', { gatewayCarry: c => arrived.push(c) });
  const t = signedCarried();
  ana.carry({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: t.extrinsic }, t.hash);
  link(net, 'Ana', 'Bia');
  assert.equal(arrived.length, 0, 'papel desligado: não abre');
  assert.equal(bia.router.size, 1, 'guardou para repassar');
  // Bia vira gateway depois: a cópia que ela guarda não volta a ser aberta (já vista), mas uma nova sim.
  bia.setGateway({ tx: true });
  const t2 = signedCarried(8);
  ana.carry({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: t2.extrinsic }, t2.hash);
  net.run();
  assert.equal(arrived.length, 1);
  // Recibo para a carga 2 dizendo que é da transação 1: Ana ignora.
  bia.sendCarryReceipt(arrived[0]!.replyTo, { about: CarryKind.Tx, ref: Uint8Array.from(Buffer.from(t.hash.slice(2), 'hex')), status: 'finalized' });
  net.run();
  assert.equal(receipts.length, 0);
});

// Pelo LoRa, todo mundo que está no ar chega como um vizinho só (a malha aberta). Revisão de segurança
// do rádio do Piu: cópias repetidas gastavam a cota, e 10 cargas falsas de quem ouve o ar travavam a de todos.
test('LoRa: cópia repetida de carga não gasta a cota; 10 cargas falsas no ar não travam a honesta; o teto continua', () => {
  const net = new Net();
  const bia = phone(net, 'Bia');
  const AIR = 'l:piulora:lora:mesh';
  bia.peerConnected(AIR, 'lora');
  const carry = (n: number) => sealCarry({ item: { kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: Uint8Array.of(n & 0xff, n >> 8, 7) }, now: net.clock }).bytes;
  const honest = carry(1);
  assert.equal(bia.receive(AIR, honest).status, 'stored');
  // A mesma carga ouvida de novo (outros relays repetem no ar, ou alguém regrava e reenvia).
  for (let i = 0; i < 40; i++) assert.equal(bia.receive(AIR, honest).status, 'duplicate', `cópia ${i}`);
  // Quem ouve o ar despeja 10 cargas novas (lixo bem formado: o relay não tem como saber).
  for (let i = 0; i < 10; i++) bia.receive(AIR, carry(100 + i));
  const next = bia.receive(AIR, carry(2));
  assert.equal(next.status, 'stored', 'a carga honesta seguinte ainda passa');
  // O teto da malha aberta é maior, mas existe (custo de consulta à Mainnet, M-N1).
  let refused = 0;
  for (let i = 0; i < 200; i++) if (bia.receive(AIR, carry(1000 + i)).status === 'rejected') refused++;
  assert.ok(refused > 150, `teto: ${refused} de 200 recusadas`);
  // Pelo Bluetooth, um vizinho continua com o balde pequeno de sempre.
  bia.peerConnected('ble:x', 'ble');
  let ok = 0;
  for (let i = 0; i < 15; i++) if (bia.receive('ble:x', carry(3000 + i)).status === 'stored') ok++;
  assert.equal(ok, 10);
});

test('limite de cargas por vizinho e reabrir o app mantém a espera do recibo', () => {
  const net = new Net();
  const bia = phone(net, 'Bia');
  const ana = phone(net, 'Ana');
  link(net, 'Ana', 'Bia');
  const before = bia.router.size;
  for (let n = 0; n < 15; n++) { const t = signedCarried(10 + n); ana.carry({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: t.extrinsic }, t.hash); }
  net.run();
  assert.equal(bia.router.size - before, 10, 'rajada de 10 por vizinho; o resto fica na fila da Ana');
  // Estado salvo: a identidade descartável volta e o recibo ainda abre.
  const receipts: CarryReceipt[] = [];
  const t = signedCarried(40);
  const cia = phone(net, 'Cia');
  const { envelopeId } = cia.carry({ kind: CarryKind.Tx, chain: CarryChain.LunesMainnet, extrinsic: t.extrinsic }, t.hash);
  const saved = cia.export();
  assert.ok(JSON.parse(saved).cy.some(([id]: [string]) => id === envelopeId));
  const net2 = new Net();
  const again = phone(net2, 'Ana2', { carryReceipt: (_id, r) => receipts.push(r) }, saved);
  const arrived: OpenedCarry[] = [];
  const gate = phone(net2, 'Gate', { gatewayCarry: c => arrived.push(c) });
  gate.setGateway({ tx: true });
  link(net2, 'Ana2', 'Gate');
  const mine = arrived.find(c => c.item.kind === CarryKind.Tx && Buffer.from(c.item.extrinsic).equals(Buffer.from(t.extrinsic)))!;
  assert.ok(mine, 'a fila própria voltou com o estado');
  gate.sendCarryReceipt(mine.replyTo, { about: CarryKind.Tx, ref: Uint8Array.from(Buffer.from(t.hash.slice(2), 'hex')), status: 'pool' });
  net2.run();
  assert.deepEqual(receipts.map(r => r.status), ['pool']);
  void again; void gatewayKindOf;
});
