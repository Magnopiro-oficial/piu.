/// <reference types="node" />
/**
 * Mídia (mapa de regras, seção 4): "Baixar mídia automaticamente" (4.1) e "Qualidade das fotos
 * enviadas" (4.2).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitSize, PHOTO_PLAN, shouldAutoDownload } from '../../lib/mediaCore';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { FILE_BLOCK, type IncomingFile, MAX_FILE_BYTES, MAX_RX_BYTES, Messenger } from '../messenger';
import type { TransportClass } from '../../protocol/router';

const T0 = 1_800_000_000;

function setup(via: TransportClass) {
  const queue: [string, string, Uint8Array][] = [];
  const nodes = new Map<string, Messenger>();
  const got = { offered: [] as Omit<IncomingFile, 'data'>[], received: [] as IncomingFile[], delivered: [] as string[] };
  const mk = (name: string, events = {}) => {
    const seed = newSeed();
    const ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
    const m = new Messenger({ identities: ids, node: deriveNodeKey(seed), relay: true, now: () => T0, transmit: async (to, b) => { queue.push([name, to, b]); }, events });
    nodes.set(name, m);
    return { m, ids };
  };
  const a = mk('Ana', { fileDelivered: (id: string) => got.delivered.push(id) });
  const b = mk('Beto', { fileOffered: (_c: string, f: Omit<IncomingFile, 'data'>) => got.offered.push(f), fileReceived: (_c: string, f: IncomingFile) => got.received.push(f) });
  a.m.addContact({ id: b.ids.public.id, via: 'public', pub: toPublic(b.ids.public), name: 'Beto' });
  b.m.addContact({ id: a.ids.public.id, via: 'public', pub: toPublic(a.ids.public), name: 'Ana' });
  const run = () => { for (let i = 0; i < 20000 && queue.length; i++) { const [f, t, x] = queue.shift()!; nodes.get(t)!.receive(f, x); } };
  const runUntil = (done: () => boolean) => { for (let i = 0; i < 20000 && queue.length && !done(); i++) { const [f, t, x] = queue.shift()!; nodes.get(t)!.receive(f, x); } };
  const link = () => { a.m.peerConnected('Beto', via); b.m.peerConnected('Ana', via); run(); };
  return { a, b, got, run, runUntil, link };
}

test('4.1 "Wi-Fi e cabo": por Bluetooth o arquivo espera "Baixar"; tocar baixa e confere', () => {
  const { a, b, got, run, link } = setup('ble');
  b.m.setAutoDownload('wifi');
  link();
  const data = new Uint8Array(40_000).map((_, i) => i % 251);
  a.m.sendFile(b.ids.public.id, 'f1', { name: 'foto.jpg', mime: 'image/jpeg', data });
  run();
  assert.equal(got.offered.length, 1);
  assert.equal(got.offered[0].held, true, 'oferta fica esperando');
  assert.equal(got.received.length, 0, 'nenhum bloco guardado sem tocar');
  assert.ok(b.m.downloadFile(a.ids.public.id, 'f1'));
  run();
  assert.equal(got.received.length, 1);
  assert.deepEqual(got.received[0].data, data, 'SHA-256 conferido no fim');
  assert.deepEqual(got.delivered, ['f1']);
});

test('4.1 "Wi-Fi e cabo" com Wi-Fi Direct e "Sempre" baixam sozinhos; "Nunca" espera', () => {
  for (const [auto, via, held] of [['wifi', 'direct', false], ['always', 'ble', false], ['never', 'direct', true]] as const) {
    const { a, b, got, run, link } = setup(via);
    b.m.setAutoDownload(auto);
    link();
    a.m.sendFile(b.ids.public.id, 'f1', { name: 'x.bin', mime: 'application/octet-stream', data: new Uint8Array(20_000).fill(3) });
    run();
    assert.equal(!!got.offered[0].held, held, `${auto} por ${via}`);
    assert.equal(got.received.length, held ? 0 : 1);
  }
});

test('4.1 regra do meio: Wi-Fi Direct, mesh e cabo contam; Bluetooth e LoRa não', () => {
  assert.equal(shouldAutoDownload('wifi', ['ble', 'lora']), false);
  assert.equal(shouldAutoDownload('wifi', ['ble', 'direct']), true);
  assert.equal(shouldAutoDownload('wifi', ['eth']), true);
  assert.equal(shouldAutoDownload('wifi', []), false);
  assert.equal(shouldAutoDownload('never', ['eth']), false);
  assert.equal(shouldAutoDownload('always', []), true);
});

test('4.2 qualidade das fotos: Econômica < Normal < Original, sem aumentar a foto', () => {
  const eco = PHOTO_PLAN.eco!, normal = PHOTO_PLAN.normal!;
  assert.ok(eco.maxSide < normal.maxSide && eco.compress < normal.compress);
  assert.equal(PHOTO_PLAN.orig, null, 'Original não regrava');
  assert.deepEqual(fitSize(4000, 3000, eco.maxSide), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3000, 4000, normal.maxSide), { width: 1536, height: 2048 });
  assert.deepEqual(fitSize(800, 600, eco.maxSide), { width: 800, height: 600 }, 'foto pequena fica como está');
});

// B-06 (auditoria 2026-11-06): recebimentos automáticos simultâneos com teto de bytes na memória.
test('4.1 teto de memória: arquivos grandes ao mesmo tempo passam do teto e ficam esperando "Baixar"', () => {
  assert.ok(MAX_RX_BYTES >= MAX_FILE_BYTES, 'um arquivo do tamanho máximo ainda baixa sozinho');
  const { a, b, got, runUntil, link } = setup('direct');
  link();
  const big = Math.floor(MAX_RX_BYTES / 2) + FILE_BLOCK; // dois juntos passam do teto
  a.m.sendFile(b.ids.public.id, 'g1', { name: 'a.bin', mime: 'application/octet-stream', data: new Uint8Array(big).fill(1) });
  a.m.sendFile(b.ids.public.id, 'g2', { name: 'b.bin', mime: 'application/octet-stream', data: new Uint8Array(big).fill(2) });
  a.m.sendFile(b.ids.public.id, 'g3', { name: 'c.bin', mime: 'application/octet-stream', data: new Uint8Array(20_000).fill(3) });
  // Só até as três ofertas chegarem (não precisa transferir os blocos).
  runUntil(() => got.offered.length >= 3);
  const by = (id: string) => got.offered.find(f => f.msgId === id)!;
  assert.equal(!!by('g1').held, false, 'o primeiro baixa sozinho');
  assert.equal(by('g2').held, true, 'o segundo passaria do teto: espera "Baixar"');
  assert.equal(!!by('g3').held, false, 'um pequeno ainda cabe');
  // Tocar "Baixar" continua possível (escolha da pessoa).
  assert.ok(b.m.downloadFile(a.ids.public.id, 'g2'));
});

test('4.1 nome do arquivo oferecido chega sem controles bidi ("fatura\\u202Efdp.exe")', () => {
  const { a, b, got, run, link } = setup('direct');
  link();
  a.m.sendFile(b.ids.public.id, 'n1', { name: 'fatura‮fdp.exe', mime: 'application/octet-stream', data: new Uint8Array(100).fill(1) });
  run();
  assert.equal(got.offered[0].name, 'faturafdp.exe');
  assert.equal(got.received[0].name, 'faturafdp.exe');
});
