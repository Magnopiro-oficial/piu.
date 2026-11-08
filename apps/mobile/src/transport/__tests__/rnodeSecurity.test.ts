/// <reference types="node" />
/**
 * Segurança do rádio do Piu: o que chega do Bluetooth e do ar é de qualquer um. Fuzz do KISS e da
 * conferência do RNode com bytes aleatórios (sementes fixas), placa mentirosa, dados antes da hora,
 * enxurrada de pedaços e de anúncios falsos, quadros gigantes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reassembler, splitEnvelope } from '../meshtastic/fragments';
import { LORA_PEER } from '../meshtastic/link';
import { decodeNodeBeacon, encodeNodeBeacon, NEAR_SEC } from '../meshtastic/nodeBeacon';
import { PiuLoraLink, type ByteStream } from '../rnode/link';
import { PiuLoraRadio } from '../rnode/radio';
import { piuRadio, REGIONS } from '../rnode/regions';
import { CMD, configFrames, KissReader, kissFrame, probeFrames, RNodeSetup } from '../rnode/rnode';
import type { LinkEvent } from '../multi';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { bench, seeded, settle } from './support/rnodeBench';

const T = 1_800_000_000_000;
const bytes = (rnd: () => number, n: number) => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));

test('fuzz KISS: 2 MB de lixo picado nunca quebra e nunca devolve quadro maior que o do firmware', () => {
  const rnd = seeded(11), r = new KissReader();
  let frames = 0;
  for (let i = 0; i < 20_000; i++) {
    // Lixo com muitos FEND/FESC, que é onde o parser erra.
    const b = bytes(rnd, 1 + Math.floor(rnd() * 200)).map(x => (x < 20 ? 0xc0 : x < 40 ? 0xdb : x));
    for (const f of r.push(b)) { frames++; assert.ok(f.data.length <= 508); }
  }
  assert.ok(frames > 1000);
});

test('fuzz KISS: qualquer conteúdo vai e volta igual, picado em qualquer ponto', () => {
  const rnd = seeded(12);
  for (let i = 0; i < 2_000; i++) {
    const data = bytes(rnd, Math.floor(rnd() * 300)), cmd = Math.floor(rnd() * 0xbf);
    const f = kissFrame(cmd, data), r = new KissReader(), got = [];
    for (let k = 0; k < f.length;) { const n = 1 + Math.floor(rnd() * 9); got.push(...r.push(f.subarray(k, k + n))); k += n; }
    if (data.length === 0 && cmd === 0) continue;
    assert.equal(got.length, 1);
    assert.equal(got[0]!.cmd, cmd);
    assert.deepEqual([...got[0]!.data], [...data]);
  }
});

test('KISS: quadro gigante é jogado fora e o seguinte chega inteiro', () => {
  const r = new KissReader();
  const giant = new Uint8Array(4_000).fill(0x41);
  const out = r.push(Uint8Array.of(0xc0, 0x00, ...giant, 0xc0, ...kissFrame(CMD.DETECT, Uint8Array.of(0x46))));
  assert.deepEqual(out.map(f => f.cmd), [CMD.DETECT]);
});

test('fuzz conferência: respostas aleatórias nunca quebram nem sobem o enlace', () => {
  const rnd = seeded(13);
  for (const region of REGIONS.map(r => r.id)) {
    for (let i = 0; i < 200; i++) {
      const s = new RNodeSetup(piuRadio(region));
      for (let k = 0; k < 40; k++) {
        const cmds = [CMD.DETECT, CMD.FW_VERSION, CMD.PLATFORM, CMD.MCU, CMD.ROM_READ, CMD.FREQUENCY, CMD.BANDWIDTH, CMD.TXPOWER, CMD.SF, CMD.CR, CMD.LT_ALOCK, CMD.RADIO_STATE, CMD.ERROR, Math.floor(rnd() * 256)];
        s.push(cmds[Math.floor(rnd() * cmds.length)]!, bytes(rnd, Math.floor(rnd() * 210)));
      }
      assert.notEqual(s.state, 'up', `${region}: lixo aleatório não pode parecer um rádio configurado`);
    }
  }
});

/** Placa que finge ser RNode e mente: diz que aceitou tudo, mas com valores trocados. */
function liar(over: Partial<Record<number, number[]>>, extra: (fn: (b: Uint8Array) => void) => void = () => {}): ByteStream {
  const r = new KissReader();
  let fn: ((b: Uint8Array) => void) | null = null;
  const rom = new Uint8Array(200); rom[1] = 0xca; rom[0x9b] = 0x73;
  return {
    async write(b) {
      for (const { cmd, data } of r.push(b)) {
        const reply = over[cmd] ? Uint8Array.from(over[cmd]!) : cmd === CMD.DETECT ? Uint8Array.of(0x46) : cmd === CMD.FW_VERSION ? Uint8Array.of(1, 86) : cmd === CMD.ROM_READ ? rom : data;
        queueMicrotask(() => { fn?.(kissFrame(cmd, reply)); if (cmd === CMD.ROM_READ) extra(f => fn?.(f)); });
      }
    },
    onData(f) { fn = f; return () => { fn = null; }; },
  };
}

test('placa mentirosa: potência acima do pedido, outro SF ou outra banda não sobem', async () => {
  for (const over of [{ [CMD.TXPOWER]: [30] }, { [CMD.SF]: [7] }, { [CMD.BANDWIDTH]: [0, 3, 0xd0, 0x90] }]) {
    const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
    await link.attach(liar(over));
    await settle();
    assert.equal(link.status().state, 'failed', JSON.stringify(over));
  }
});

test('dados antes do rádio estar configurado são ignorados (nada chega ao app)', async () => {
  const env = splitEnvelope(new Uint8Array(40).fill(9), 1);
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
  const got: LinkEvent[] = [];
  link.subscribe(e => { if (e.type === 'data') got.push(e); });
  // A placa empurra pedaços válidos logo depois da memória, antes de confirmar os ajustes.
  await link.attach(liar({}, push => { for (const p of env) push(kissFrame(CMD.DATA, p)); }));
  await settle();
  assert.equal(link.status().state, 'up');
  assert.equal(got.length, 0);
});

test('enxurrada no ar: milhares de pedaços soltos não acumulam memória nem viram envelope', async () => {
  const { ble, emu } = bench('Heltec V3 (915)', { now: () => T });
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
  const got: LinkEvent[] = [];
  link.subscribe(e => { if (e.type === 'data') got.push(e); });
  await link.attach(ble); await settle();
  const rnd = seeded(14);
  for (let i = 0; i < 3_000; i++) {
    const p = splitEnvelope(bytes(rnd, 400), (rnd() * 2 ** 32) >>> 0)[0]!; // só o primeiro de dois: nunca completa
    emu.receive(rnd() < 0.5 ? p : bytes(rnd, 1 + Math.floor(rnd() * 254)));
  }
  await settle();
  assert.equal(got.length, 0);
  assert.equal(link.status().state, 'up', 'o enlace segue de pé');
  // O remontador guarda no máximo 32 mensagens pela metade: um envelope legítimo depois ainda passa.
  const re = new Reassembler();
  for (let i = 0; i < 1_000; i++) re.push(splitEnvelope(new Uint8Array(400), i)[0]!, T);
  assert.ok((re as unknown as { pending: Map<number, unknown> }).pending.size <= 32);
  for (const p of splitEnvelope(new Uint8Array(300).fill(5), 99_999)) emu.receive(p);
  await settle();
  assert.equal(got.length, 1);
});

test('anúncios: assinatura falsa, horário fora e pedaço adulterado não contam; a lista tem teto', async () => {
  const node = deriveNodeKey(newSeed()), sec = Math.floor(T / 1000);
  const good = encodeNodeBeacon(node, { at: sec, relay: true, gateway: false });
  assert.ok(decodeNodeBeacon(good, sec));
  const forged = good.slice(); forged[39] = 3; // tenta virar gateway sem assinar
  assert.equal(decodeNodeBeacon(forged, sec), null);
  assert.equal(decodeNodeBeacon(good, sec + 3_601), null, 'mais de 1 h de diferença');
  const other = encodeNodeBeacon(deriveNodeKey(newSeed()), { at: sec, relay: true, gateway: false });
  const swapped = other.slice(); swapped.set(node.pk, 3); // chave de um, assinatura de outro
  assert.equal(decodeNodeBeacon(swapped, sec), null);

  const { ble, emu } = bench('Heltec V3 (915)', { now: () => T });
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
  await link.attach(ble); await settle();
  for (let i = 0; i < 100; i++) emu.receive(encodeNodeBeacon(deriveNodeKey(newSeed()), { at: sec, relay: true, gateway: true }));
  await settle();
  assert.ok(link.status().superNodes <= 64, `${link.status().superNodes} Super Nodes`);
  assert.ok(NEAR_SEC > 0);
});

test('envio: só para a malha, só com o rádio no ar, e nunca acima do tamanho do LoRa', async () => {
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(10)), /desconectado/);
  const { ble } = bench('Heltec V3 (915)', { now: () => T });
  await link.attach(ble); await settle();
  await assert.rejects(link.send('ble:alguem', new Uint8Array(10)), /desconectado/);
  await assert.rejects(link.send(LORA_PEER, new Uint8Array(5_000)), /grande demais/);
  assert.throws(() => new PiuLoraLink({ region: 'XX' }));
  await assert.rejects(link.setRegion('../../etc'), /região/i);
});

test('o Piu nunca manda à placa comandos que gravam na memória, reiniciam ou desparelham', () => {
  const dangerous = [0x52 /* ROM_WRITE */, 0x53 /* CONF_SAVE */, 0x54 /* CONF_DELETE */, 0x55 /* RESET */, 0x59 /* UNLOCK_ROM */, 0x61 /* FW_UPD */, 0x70 /* BT_UNPAIR */];
  const r = new KissReader();
  const sent = [...probeFrames(), ...REGIONS.flatMap(x => configFrames(piuRadio(x.id)))].flatMap(f => r.push(f)).map(c => c.cmd);
  assert.equal(sent.length, 5 + REGIONS.length * 7);
  for (const c of sent) assert.ok(!dangerous.includes(c), `comando 0x${c.toString(16)}`);
});

test('remontagem: pedaço falso de quem ouviu o ar não apaga o verdadeiro que chega depois', () => {
  const real = splitEnvelope(Uint8Array.from({ length: 400 }, (_, i) => i & 0xff), 77);
  const fake = real[1]!.slice(); fake.fill(0xee, 7);
  const re = new Reassembler();
  assert.equal(re.push(real[0]!, T), null);
  const bad = re.push(fake, T);
  assert.ok(bad, 'o falso completa um envelope (que a assinatura vai recusar lá em cima)');
  const good = re.push(real[1]!, T);
  assert.ok(good, 'o verdadeiro ainda passa');
  assert.deepEqual([...good!], [...Uint8Array.from({ length: 400 }, (_, i) => i & 0xff)]);
  assert.equal(re.push(real[1]!, T), null, 'eco igual de repetidor não entrega de novo');
  // Cada mensagem aceita no máximo algumas variantes: lixo não vira amplificação.
  let extra = 0;
  for (let i = 0; i < 20; i++) { const f = real[1]!.slice(); f[50] = i; if (re.push(f, T)) extra++; }
  assert.ok(extra <= 3, `${extra} variantes`);
});

test('remontagem: mensagens entregues não acumulam memória sem fim', () => {
  const re = new Reassembler();
  for (let i = 0; i < 20_000; i++) re.push(splitEnvelope(Uint8Array.of(i & 0xff, 1), i)[0]!, T);
  assert.ok((re as unknown as { done: Map<number, unknown> }).done.size <= 512);
});

test('busca: centenas de aparelhos "RNode" falsos não incham a lista (fica com os 32 mais fortes)', async () => {
  const dev = new Set<(d: { id: string; name: string; rssi: number }) => void>();
  const none = { remove() {} };
  const client = {
    async scan() { for (let i = 0; i < 500; i++) dev.forEach(f => f({ id: `AA:${i}`, name: `RNode ${i}`, rssi: -100 + (i % 60) })); },
    async connect() {}, async write() {}, disconnect() {},
    addDeviceListener: (f: (d: { id: string; name: string; rssi: number }) => void) => { dev.add(f); return { remove: () => { dev.delete(f); } }; },
    addDataListener: () => none, addStateListener: () => none,
  };
  const r = new PiuLoraRadio(client, new PiuLoraLink({ now: () => T }));
  await r.scan(1);
  const list = r.status().devices;
  assert.equal(list.length, 32);
  assert.ok(list.every(d => d.rssi >= -45), 'os de sinal mais forte');
});
