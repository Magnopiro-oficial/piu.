/// <reference types="node" />
/**
 * Simulação do rádio do Piu no ar (support/air.ts): celulares com placas emuladas, a distâncias reais,
 * mandando envelopes pelo enlace de verdade. Confere alcance, canal por região, colisão, tempo no ar
 * dentro do limite da região e o anúncio do Super Node atravessando o ar.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LORA_PEER } from '../meshtastic/link';
import { encodeNodeBeacon } from '../meshtastic/nodeBeacon';
import { RNodeEmulator } from '../rnode/emulator';
import { PiuLoraLink } from '../rnode/link';
import { piuRadio } from '../rnode/regions';
import { CMD, kissFrame } from '../rnode/rnode';
import type { LinkEvent } from '../multi';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { Air, sensitivity } from './support/air';
import { BleNus, board, settle } from './support/rnodeBench';

const T0 = 1_800_000_000_000;

async function phone(air: Air, x: number, o: { region?: string; board?: string; y?: number } = {}) {
  const emu = new RNodeEmulator(board(o.board ?? 'Heltec V3 (915)'), { now: air.now });
  air.add(emu, x, o.y ?? 0);
  const link = new PiuLoraLink({ now: air.now, region: o.region ?? 'BR_902' });
  const got: Uint8Array[] = [];
  link.subscribe((e: LinkEvent) => { if (e.type === 'data') got.push(e.data); });
  await link.attach(new BleNus(emu, { seed: x }));
  await settle();
  assert.equal(link.status().state, 'up', link.status().problem);
  return { emu, link, got };
}

const env = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

async function sendAndAir(air: Air, from: { link: PiuLoraLink }, e: Uint8Array) {
  await from.link.send(LORA_PEER, e);
  await settle();
  air.run(5_000);
  await settle();
}

test('ar: o envelope em dois pedaços chega inteiro a quem está perto; longe demais não chega', async () => {
  const air = new Air(T0, { shadowDb: 0 });
  const a = await phone(air, 0), b = await phone(air, 800), c = await phone(air, 1_500, { y: 900 }), far = await phone(air, 40_000);
  const e = env(300, 1);
  await sendAndAir(air, a, e);
  for (const r of [b, c]) { assert.equal(r.got.length, 1); assert.deepEqual([...r.got[0]!], [...e]); }
  assert.equal(far.got.length, 0, '40 km: abaixo da sensibilidade');
  assert.equal(a.got.length, 0, 'quem manda não recebe o próprio envelope');
  assert.ok(sensitivity(piuRadio('BR_902')) < -128 && sensitivity(piuRadio('BR_902')) > -131, 'SF9/125 kHz ≈ -129,5 dBm');
});

test('ar: celulares em regiões diferentes não se ouvem, nem lado a lado', async () => {
  const air = new Air(T0, { shadowDb: 0 });
  const br = await phone(air, 0), anz = await phone(air, 10, { region: 'ANZ' }), us = await phone(air, 20, { region: 'US' });
  await sendAndAir(air, br, env(100, 2));
  assert.equal(anz.got.length + us.got.length, 0);
  const br2 = await phone(air, 30);
  await sendAndAir(air, br, env(100, 3));
  assert.equal(br2.got.length, 1, 'outro celular no Brasil ouve');
});

test('ar: dois falando juntos colidem; quem está bem mais perto de um deles ainda ouve esse (captura)', async () => {
  const air = new Air(T0, { shadowDb: 0 });
  const a = await phone(air, -1_000), b = await phone(air, 1_000), mid = await phone(air, 0), nearA = await phone(air, -950);
  await a.link.send(LORA_PEER, env(150, 4));
  await b.link.send(LORA_PEER, env(150, 5));
  await settle();
  air.run(5_000);
  await settle();
  assert.equal(mid.got.length, 0, 'no meio, os dois chegam iguais e se perdem');
  assert.equal(nearA.got.length, 1, 'a 50 m de A, o pacote de A chega muito mais forte e é decodificado');
  assert.deepEqual([...nearA.got[0]!], [...env(150, 4)]);
});

test('ar: o celular nunca passa do limite de tempo no ar da região, mesmo tentando o tempo todo', async () => {
  for (const region of ['BR_902', 'EU_866', 'EU_868']) {
    const air = new Air(T0, { shadowDb: 0 });
    const a = await phone(air, 0, { region, board: region === 'BR_902' ? 'Heltec V3 (915)' : 'LILYGO T-Beam Supreme (915)' });
    let sent = 0;
    for (let s = 0; s < 3_600; s += 5) {
      await a.link.send(LORA_PEER, env(400, s)).then(() => { sent++; }, () => {});
      await settle(4);
      air.run(5_000);
    }
    const used = air.log.filter(t => t.from.emu === a.emu).reduce((x, t) => x + (t.end - t.start), 0);
    const pct = (used / 3_600_000) * 100;
    const limit = piuRadio(region).airtimePct;
    assert.ok(sent > 10, `${region}: mandou ${sent}`);
    assert.ok(pct <= limit, `${region}: ${pct.toFixed(2)} % no ar, limite ${limit} %`);
  }
});

test('ar: o anúncio de um Super Node atravessa o ar e o celular conta o nó', async () => {
  const air = new Air(T0, { shadowDb: 0 });
  const p = await phone(air, 0);
  const node = new RNodeEmulator(board('LILYGO T-Beam SX1276'), { now: air.now });
  air.add(node, 2_000);
  const r = piuRadio('BR_902');
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  for (const f of [kissFrame(CMD.FREQUENCY, Uint8Array.from(u32(r.freqHz))), kissFrame(CMD.BANDWIDTH, Uint8Array.from(u32(r.bwHz))),
    kissFrame(CMD.TXPOWER, Uint8Array.of(r.txDbm)), kissFrame(CMD.SF, Uint8Array.of(r.sf)), kissFrame(CMD.CR, Uint8Array.of(r.cr)),
    kissFrame(CMD.RADIO_STATE, Uint8Array.of(1))]) node.input(f);
  assert.ok(node.online);
  node.input(kissFrame(CMD.DATA, encodeNodeBeacon(deriveNodeKey(newSeed()), { at: Math.floor(T0 / 1000), relay: true, gateway: true })));
  air.run(5_000);
  await settle();
  assert.equal(p.link.status().superNodes, 1);
  assert.equal(p.link.status().gateways, 1);
});
