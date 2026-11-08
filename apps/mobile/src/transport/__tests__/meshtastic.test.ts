import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFromRadio, encodeToRadioPacket, encodeWantConfig, PRIVATE_APP, BROADCAST } from '../meshtastic/proto';
import { LORA_MAX_ENVELOPE, Reassembler, splitEnvelope } from '../meshtastic/fragments';
import { AirtimeBudget } from '../meshtastic/budget';
import { encodeNodeBeacon } from '../meshtastic/nodeBeacon';
import { deriveNodeKey, newSeed } from '../../protocol/keys';

// Bytes conferidos à mão contra mesh.proto (ToRadio.want_config_id = campo 3, varint).
test('protobuf: pedir configuração', () => {
  assert.deepEqual([...encodeWantConfig(150)], [0x18, 0x96, 0x01]);
});

test('protobuf: pacote para todos na porta privada, ida e volta pelo decodificador', () => {
  const payload = new Uint8Array([1, 2, 3]);
  const to = encodeToRadioPacket({ payload, id: 0x01020304, hopLimit: 3 });
  // ToRadio.packet (1, bytes) → MeshPacket; para testar a volta, embrulho como FromRadio.packet (2).
  const inner = to.subarray(2); // tag + tamanho de 1 byte
  assert.equal(to[0], 0x0a);
  const from = new Uint8Array([0x12, inner.length, ...inner]);
  const got = decodeFromRadio(from);
  assert.equal(got.packet?.to, BROADCAST);
  assert.equal(got.packet?.portnum, PRIVATE_APP);
  assert.deepEqual([...got.packet!.payload!], [1, 2, 3]);
  assert.equal(got.packet?.id, 0x01020304);
});

test('protobuf: FromRadio com my_info e config_complete_id; campo desconhecido é pulado', () => {
  // my_info (3) { my_node_num (1) = 300 }, campo 99 (varint) desconhecido, config_complete_id (7) = 150
  const bytes = new Uint8Array([0x1a, 0x03, 0x08, 0xac, 0x02, 0x98, 0x06, 0x05, 0x38, 0x96, 0x01]);
  const got = decodeFromRadio(bytes);
  assert.equal(got.myNodeNum, 300);
  assert.equal(got.configCompleteId, 150);
});

test('pedaços: envelope pequeno vira 2 pedaços e volta inteiro, em qualquer ordem e com repetidos', () => {
  const env = Uint8Array.from({ length: 360 }, (_, i) => i & 0xff);
  const parts = splitEnvelope(env, 0xdeadbeef);
  assert.equal(parts.length, 2);
  assert.ok(parts.every(p => p.length <= 233));
  const r = new Reassembler();
  assert.equal(r.push(parts[1]!, 0), null);
  assert.equal(r.push(parts[1]!, 0), null, 'repetido');
  assert.deepEqual([...r.push(parts[0]!, 0)!], [...env]);
  assert.equal(r.push(parts[0]!, 0), null, 'mensagem já entregue não volta');
});

test('pedaços: grande demais não vai; lixo de outro app na porta 256 é ignorado; incompleto expira', () => {
  assert.throws(() => splitEnvelope(new Uint8Array(LORA_MAX_ENVELOPE + 1), 1));
  const r = new Reassembler();
  assert.equal(r.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 0), null);
  const parts = splitEnvelope(new Uint8Array(500), 7);
  r.push(parts[0]!, 0);
  r.prune(61_000);
  for (const p of parts.slice(1)) assert.equal(r.push(p, 61_000), null, 'o primeiro pedaço expirou');
});

test('orçamento de rádio: rajada de 4 pedaços, depois 3 por minuto', () => {
  const b = new AirtimeBudget({ perMinute: 3, burst: 4 });
  assert.equal(b.take(4, 0), true);
  assert.equal(b.take(1, 0), false);
  assert.equal(b.take(1, 20_000), true, 'uma ficha a cada 20 s');
  assert.equal(b.take(2, 20_000), false);
  assert.equal(b.take(2, 60_000), true);
});

// ---- Enlace LoRa (link.ts) com um rádio de mentira que fala o protobuf de verdade ----

import { LoraBusyError, LoraLink, LORA_PEER, regionLabel, type RadioPort } from '../meshtastic/link';
import type { LinkEvent } from '../multi';
import { rankLinks } from '../select';

/** Monta um FromRadio à mão (campos de mesh.proto) para alimentar o enlace. */
function varint(n: number): number[] { const o: number[] = []; let v = n >>> 0; while (v > 0x7f) { o.push((v & 0x7f) | 0x80); v >>>= 7; } o.push(v); return o; }
const fld = (no: number, bytes: number[]) => [...varint((no << 3) | 2), ...varint(bytes.length), ...bytes];
const vfld = (no: number, n: number) => [...varint(no << 3), ...varint(n)];
const fromConfigComplete = (id: number) => Uint8Array.from(vfld(7, id));
const fromMyInfo = (node: number) => Uint8Array.from(fld(3, vfld(1, node)));
function fromPacket(from: number, payload: Uint8Array, port = 256) {
  const data = [...vfld(1, port), ...fld(2, [...payload])];
  const pkt = [...[0x0d, from & 0xff, (from >>> 8) & 0xff, (from >>> 16) & 0xff, (from >>> 24) & 0xff], ...[0x15, 0xff, 0xff, 0xff, 0xff], ...fld(4, data)];
  return Uint8Array.from(fld(2, pkt));
}

class FakeRadio implements RadioPort {
  written: Uint8Array[] = [];
  private fn: ((b: Uint8Array) => void) | null = null;
  async write(b: Uint8Array) { this.written.push(b); }
  onFromRadio(fn: (b: Uint8Array) => void) { this.fn = fn; return () => { this.fn = null; }; }
  push(b: Uint8Array) { this.fn?.(b); }
}

async function upLink(now = { t: 0 }) {
  let n = 100;
  const link = new LoraLink({ now: () => now.t, random32: () => n++ });
  const ev: LinkEvent[] = [];
  link.subscribe(e => ev.push(e));
  const radio = new FakeRadio();
  await link.attach(radio);
  radio.push(fromMyInfo(0xabc));
  radio.push(fromConfigComplete(100));
  return { link, ev, radio, now };
}

test('enlace LoRa: sobe só depois do config_complete certo e vira o vizinho lora:mesh', async () => {
  const { link, ev } = await upLink();
  assert.equal(link.status().state, 'up');
  assert.equal(link.status().myNode, 0xabc);
  assert.ok(ev.some(e => e.type === 'up' && e.medium === 'lora' && e.id === LORA_PEER));
});

test('enlace LoRa: envia em pedaços, recebe de outro nó, ignora o próprio eco e outras portas', async () => {
  const { link, ev, radio } = await upLink();
  const before = radio.written.length;
  const env = Uint8Array.from({ length: 360 }, (_, i) => i);
  await link.send(LORA_PEER, env);
  assert.equal(radio.written.length - before, 2, 'dois pedaços no ar');

  const parts = splitEnvelope(env, 0x55);
  radio.push(fromPacket(0xabc, parts[0]!)); // meu próprio nó: ignorado
  radio.push(fromPacket(0x999, parts[0]!, 1)); // porta de texto: ignorado
  assert.equal(ev.filter(e => e.type === 'data').length, 0);
  radio.push(fromPacket(0x999, parts[0]!));
  radio.push(fromPacket(0x999, parts[1]!));
  const got = ev.filter(e => e.type === 'data');
  assert.equal(got.length, 1);
  assert.deepEqual([...(got[0] as { data: Uint8Array }).data], [...env]);
});

test('enlace LoRa: sem orçamento dá "LoRa ocupado"; desligar derruba o vizinho', async () => {
  const { link, ev } = await upLink();
  await link.send(LORA_PEER, new Uint8Array(400));
  await link.send(LORA_PEER, new Uint8Array(400)); // 2 + 2 = rajada inteira
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(100)), LoraBusyError);
  link.detach();
  assert.ok(ev.some(e => e.type === 'down' && e.id === LORA_PEER));
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(10)));
});

test('enlace LoRa: anúncio de Super Node conta como "por perto" e não vira envelope', async () => {
  const now = { t: 1_800_000_000_000 };
  const { link, ev, radio } = await upLink(now);
  const node = deriveNodeKey(newSeed());
  radio.push(fromPacket(0x777, encodeNodeBeacon(node, { at: now.t / 1000, relay: true, gateway: true })));
  assert.equal(link.status().superNodes, 1);
  assert.equal(link.status().gateways, 1);
  assert.equal(ev.filter(e => e.type === 'data').length, 0);
  // Anúncio forjado (assinado por outra chave) não conta.
  const forged = encodeNodeBeacon(deriveNodeKey(newSeed()), { at: now.t / 1000, relay: true, gateway: false });
  forged.set(deriveNodeKey(newSeed()).pk, 3);
  radio.push(fromPacket(0x778, forged));
  assert.equal(link.status().superNodes, 1);
  now.t += 41 * 60_000;
  link.refreshNodes();
  assert.equal(link.status().superNodes, 0);
});

test('seletor: LoRa só quando não há outro meio, e nunca para envelope grande', () => {
  const links = (['lora', 'lan', 'ble'] as const).map(medium => ({ medium, up: true, failures: 0 }));
  assert.equal(rankLinks(links, { size: 300, lowBattery: false, now: 0 })[0]!.medium, 'ble');
  assert.equal(rankLinks(links, { size: 300, lowBattery: false, now: 0 }).at(-1)!.medium, 'lora');
  assert.equal(rankLinks([links[0]!], { size: 5000, lowBattery: false, now: 0 }).length, 0);
});

// ---- Rádio (radio.ts): busca, conexão e queda ----

import { LoraRadio, type RadioClient, type RadioDevice } from '../meshtastic/radio';

function fakeClient(fail?: string) {
  const dev = new Set<(d: RadioDevice) => void>(), from = new Set<(b: Uint8Array) => void>(), st = new Set<(s: string, r?: string) => void>();
  const sub = <T,>(s: Set<T>, f: T) => { s.add(f); return { remove: () => { s.delete(f); } }; };
  const client: RadioClient & { radio(b: Uint8Array): void; state(s: string, r?: string): void } = {
    async scan() { dev.forEach(f => f({ id: 'A', name: 'Meshtastic_a1', rssi: -80 })); dev.forEach(f => f({ id: 'B', name: 'T-Echo', rssi: -50 })); },
    async connect() { if (fail) throw Object.assign(new Error(fail), { code: fail }); },
    async write() {}, async drain() {}, disconnect() {},
    addDeviceListener: f => sub(dev, f), addFromRadioListener: f => sub(from, f), addStateListener: f => sub(st, f),
    radio: b => from.forEach(f => f(b)), state: (s, r) => st.forEach(f => f(s, r)),
  };
  return client;
}

test('rádio: busca ordena pelo sinal; conecta e o enlace sobe com o config_complete; queda derruba', async () => {
  const c = fakeClient();
  const r = new LoraRadio(c, new LoraLink({ random32: () => 7 }));
  await r.scan(1);
  assert.deepEqual(r.status().devices.map(d => d.id), ['B', 'A']);
  await r.connect('B');
  assert.equal(r.status().phase, 'connected');
  c.radio(fromConfigComplete(7));
  assert.equal(r.link.status().state, 'up');
  c.state('disconnected');
  assert.equal(r.status().phase, 'away', 'mantém o rádio para reconectar');
  assert.equal(r.status().device?.id, 'B');
  assert.equal(r.link.status().state, 'off');
});

test('rádio: pareamento aparece; erro de conexão vira estado com código', async () => {
  const c = fakeClient('TIMEOUT');
  const r = new LoraRadio(c);
  c.state('connecting', 'bond');
  assert.equal(r.status().phase, 'pairing');
  await r.connect('A');
  assert.equal(r.status().phase, 'error');
  assert.equal(r.status().error, 'TIMEOUT');
});

test('enlace LoRa: bateria do próprio rádio, nós ouvidos e região vêm da configuração', async () => {
  let n = 100;
  const link = new LoraLink({ random32: () => n++ });
  const radio = new FakeRadio();
  await link.attach(radio);
  const str = (s: string) => [...new TextEncoder().encode(s)];
  const node = (num: number, name: string, battery?: number) =>
    Uint8Array.from(fld(4, [...vfld(1, num), ...fld(2, fld(2, str(name))), ...(battery !== undefined ? fld(6, vfld(1, battery)) : [])]));
  radio.push(fromMyInfo(0xabc));
  radio.push(node(0xabc, 'Meu rádio', 82));
  radio.push(node(0x111, 'Outro'));
  radio.push(node(0x222, 'Mais um'));
  radio.push(Uint8Array.from(fld(5, fld(6, vfld(7, 0)))));
  assert.equal(link.status().region, 0, 'região não definida');
  radio.push(Uint8Array.from(fld(5, fld(6, vfld(7, 6)))));
  radio.push(fromConfigComplete(100));
  const s = link.status();
  assert.equal(s.battery, 82);
  assert.equal(s.nodesHeard, 2);
  assert.equal(s.region, 6);
  assert.equal(regionLabel(6), '915–928 MHz');
  assert.equal(regionLabel(26), '902–907,5 MHz');
  assert.equal(regionLabel(3), '869,4–869,65 MHz');
  assert.equal(regionLabel(4), '470–510 MHz');
  assert.equal(regionLabel(13), '2,4 GHz');
  assert.equal(regionLabel(0), null);
});
