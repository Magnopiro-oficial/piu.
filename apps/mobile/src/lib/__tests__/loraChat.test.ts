/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Msg } from '../../data/types';
import { Messenger, type MessengerEvents } from '../../messaging/messenger';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../../protocol/keys';
import { LORA_MAX_ENVELOPE } from '../../transport/meshtastic/fragments';
import { LORA_COUNT_FROM, LORA_TEXT_BYTES, loraComposer, loraMsgState, onlyLora } from '../loraChat';

const mine = (p: Partial<Msg>): Msg => ({ id: 'm', from: 'me', time: '14:06', text: 'oi', status: 'aguardando', ...p });

test('só o LoRa: há o vizinho lora:mesh e nenhum outro meio', () => {
  assert.equal(onlyLora([]), false);
  assert.equal(onlyLora(['lora']), true);
  assert.equal(onlyLora(['lora', 'ble']), false);
  assert.equal(onlyLora(['nearby']), false);
});

test('contador: só com LoRa como único caminho, a partir de LORA_COUNT_FROM bytes', () => {
  assert.deepEqual(loraComposer('x'.repeat(200), false), { icon: 'arrow_upward', hint: false });
  assert.deepEqual(loraComposer('x'.repeat(LORA_COUNT_FROM - 1), true), { icon: 'arrow_upward', hint: false });
  assert.deepEqual(loraComposer('x'.repeat(LORA_COUNT_FROM), true), { icon: 'arrow_upward', hint: false, count: { n: LORA_COUNT_FROM, max: LORA_TEXT_BYTES, over: false } });
  assert.deepEqual(loraComposer('x'.repeat(LORA_TEXT_BYTES + 1), true), { icon: 'schedule_send', hint: true, count: { n: LORA_TEXT_BYTES + 1, max: LORA_TEXT_BYTES, over: true } });
});

test('contador mede bytes: acento ocupa 2', () => {
  const s = 'ã'.repeat(76); // 152 bytes, 76 letras
  assert.equal(loraComposer(s, true).count?.n, 152);
  assert.equal(loraComposer(s, true).hint, true);
});

test('estado do balão: na vez do rádio, ou espera outro caminho', () => {
  assert.equal(loraMsgState(mine({}), false, 40), null, 'com outro meio, nada muda');
  assert.deepEqual(loraMsgState(mine({}), true, 40), { kind: 'turn', sec: 40 });
  assert.equal(loraMsgState(mine({}), true, undefined), null, 'sem fila, sai já');
  assert.deepEqual(loraMsgState(mine({ text: 'x'.repeat(LORA_TEXT_BYTES + 1) }), true, 40), { kind: 'other' });
  assert.deepEqual(loraMsgState(mine({ file: { name: 'a.jpg' } as unknown as Msg['file'] }), true, undefined), { kind: 'other' });
  assert.equal(loraMsgState(mine({ status: 'entregue' }), true, 40), null, 'já saiu');
  assert.equal(loraMsgState({ ...mine({}), from: 'them' }, true, 40), null);
});

test('medido no mensageiro: texto de LORA_TEXT_BYTES bytes cabe no LoRa, o dobro não', () => {
  const q: [string, string, Uint8Array][] = [];
  const out: number[] = [];
  const mk = (name: string) => {
    const seed = newSeed(), ids = { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') };
    const m = new Messenger({ identities: ids, node: deriveNodeKey(seed), relay: true, now: () => 1_800_000_000, events: {} as MessengerEvents,
      transmit: async (to, b) => { q.push([name, to, b]); if (name === 'A') out.push(b.length); } });
    m.displayName = name;
    return { m, ids };
  };
  const a = mk('A'), b = mk('B'), nodes: Record<string, Messenger> = { A: a.m, B: b.m };
  const run = () => { while (q.length) { const [f, to, x] = q.shift()!; nodes[to].receive(f, x); } };
  a.m.addContact({ id: b.ids.public.id, via: 'public', pub: toPublic(b.ids.public), name: 'B' });
  b.m.addContact({ id: a.ids.public.id, via: 'public', pub: toPublic(a.ids.public), name: 'A' });
  a.m.peerConnected('B', 'ble'); b.m.peerConnected('A', 'ble'); run();
  a.m.sendText(b.ids.public.id, 'm0', 'oi'); run();
  b.m.sendText(a.ids.public.id, 'r0', 'oi'); run(); // sessão firmada
  const size = (n: number, id: string) => { out.length = 0; a.m.sendText(b.ids.public.id, id, 'x'.repeat(n)); run(); return Math.max(...out); };
  assert.ok(size(LORA_TEXT_BYTES, 'm1') <= LORA_MAX_ENVELOPE);
  assert.ok(size(LORA_TEXT_BYTES * 2, 'm2') > LORA_MAX_ENVELOPE);
});
