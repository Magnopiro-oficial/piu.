/// <reference types="node" />
/**
 * Todas as placas RNode da documentação (docs/hardware/placas-lora.md) contra as 27 regiões, pelo enlace
 * de verdade (PiuLoraLink) e pela placa emulada byte a byte (rnode/emulator.ts), com o Bluetooth picando
 * os bytes como no aparelho. E os casos do mundo real: firmware antigo, placa sem provisionar, modo TNC,
 * chip que não liga, aparelho que não é RNode, ruído na serial, falha de transmissão.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LORA_PEER } from '../meshtastic/link';
import { RNODE_BOARDS, RNodeEmulator } from '../rnode/emulator';
import { PiuLoraLink, type ByteStream } from '../rnode/link';
import { piuRadio, REGIONS } from '../rnode/regions';
import { RNODE_MODELS } from '../rnode/rnode';
import { BleNus, bench, settle } from './support/rnodeBench';

const T = 1_800_000_000_000;

/** A tabela `models` do rnodeconf (Reticulum, RNS/Utilities/rnodeconf.py), copiada crua: [início, fim, chip]. */
const RNODECONF: Record<number, [number, number, string]> = {
  0xA4: [410000000, 525000000, 'SX1278'], 0xA9: [820000000, 1020000000, 'SX1276'], 0xA1: [410000000, 525000000, 'SX1268'],
  0xA6: [820000000, 1020000000, 'SX1262'], 0xA5: [410000000, 525000000, 'SX1278'], 0xAA: [820000000, 1020000000, 'SX1276'],
  0xAC: [2400000000, 2500000000, 'SX1280'], 0xA2: [410000000, 525000000, 'SX1278'], 0xA7: [820000000, 1020000000, 'SX1276'],
  0xA3: [410000000, 525000000, 'SX1278'], 0xA8: [820000000, 1020000000, 'SX1276'], 0xB3: [420000000, 520000000, 'SX1278'],
  0xB8: [850000000, 950000000, 'SX1276'], 0xB4: [420000000, 520000000, 'SX1278'], 0xB9: [850000000, 950000000, 'SX1276'],
  0xBA: [420000000, 520000000, 'SX1278'], 0xBB: [850000000, 950000000, 'SX1276'], 0xC4: [420000000, 520000000, 'SX1278'],
  0xC9: [850000000, 950000000, 'SX1276'], 0xC5: [420000000, 520000000, 'SX1268'], 0xCA: [850000000, 950000000, 'SX1262'],
  0xC8: [860000000, 930000000, 'SX1262'], 0xC6: [420000000, 520000000, 'SX1268'], 0xC7: [850000000, 950000000, 'SX1262'],
  0xE4: [420000000, 520000000, 'SX1278'], 0xE9: [850000000, 950000000, 'SX1276'], 0xD4: [420000000, 520000000, 'SX1268'],
  0xD9: [850000000, 950000000, 'SX1262'], 0xDB: [420000000, 520000000, 'SX1268'], 0xDC: [850000000, 950000000, 'SX1262'],
  0xE3: [420000000, 520000000, 'SX1268'], 0xE8: [850000000, 950000000, 'SX1262'], 0x11: [430000000, 510000000, 'SX1262'],
  0x12: [779000000, 928000000, 'SX1262'], 0x13: [430000000, 510000000, 'SX1262 + SX1280'], 0x14: [779000000, 928000000, 'SX1262 + SX1280'],
  0x16: [779000000, 928000000, 'SX1262'], 0x17: [779000000, 928000000, 'SX1262'], 0x21: [820000000, 960000000, 'SX1262 + SX1280'],
  0xDE: [420000000, 520000000, 'SX1262'], 0xDD: [850000000, 950000000, 'SX1262'],
};

test('modelos: a faixa de cada placa é a do rnodeconf (só o T-Echo 433, 0x16, segue o rótulo 430–510)', () => {
  for (const [code, [lo, hi, chip]] of Object.entries(RNODECONF)) {
    const m = RNODE_MODELS[Number(code)];
    assert.ok(m, `modelo 0x${Number(code).toString(16)}`);
    if (Number(code) === 0x16) { assert.deepEqual([m.loHz, m.hiHz], [430e6, 510e6]); continue; }
    assert.deepEqual([m.loHz, m.hiHz, m.chip], [lo, hi, chip.split(' ')[0]], `0x${Number(code).toString(16)}`);
  }
  assert.equal(Object.keys(RNODE_MODELS).length, Object.keys(RNODECONF).length);
});

test('documentação: toda placa marcada "também roda RNode" tem perfil, e as de BLE estão em BLE', () => {
  // Nome na tabela da documentação → início do nome do perfil.
  const doc: [string, string][] = [
    ['Heltec Mesh Node T114', 'Heltec T114'], ['Heltec V2.0', 'Heltec V2.x'], ['Heltec V2.1', 'Heltec V2.x'], ['Heltec V3', 'Heltec V3'],
    ['Heltec V4', 'Heltec V4'], ['LILYGO T-Beam', 'LILYGO T-Beam SX'], ['LILYGO T-Beam Supreme', 'LILYGO T-Beam Supreme'],
    ['LILYGO T-Deck', 'LILYGO T-Deck'], ['LILYGO T-Echo', 'LILYGO T-Echo'], ['LILYGO T-LoRa T3-S3', 'LILYGO T3-S3'],
    ['LILYGO T-LoRa V1', 'LILYGO T-LoRa V1'], ['LILYGO T-LoRa V2', 'LILYGO T-LoRa V2 '], ['LILYGO T-LoRa V2.1-1.6', 'LILYGO T-LoRa V2.1-1.6'],
    ['RAK WisBlock 4631', 'RAK WisBlock 4631'], ['Seeed Xiao ESP32-S3', 'Seeed XIAO ESP32-S3'],
    ['Handheld RNode v2.x', 'RNode NG 2.1 / Handheld'], ['openCom XL', 'openCom XL'], ['RNode NG 2.0 / 2.1', 'RNode NG 2.'],
    ['ESP32 genérica montada em casa', 'ESP32 montada'], ['nRF52 genérica montada em casa', 'nRF52 montada'], ['ATmega1284p / ATmega2560', 'ATmega'],
  ];
  for (const [d, prefix] of doc) assert.ok(RNODE_BOARDS.some(b => b.name.startsWith(prefix)), `${d} sem perfil no emulador`);
  const ble = ['Heltec V3', 'Heltec V4', 'Heltec T114', 'T-Beam Supreme', 'T3-S3', 'T-Deck', 'T-Echo', 'RAK WisBlock 4631', 'XIAO ESP32-S3', 'openCom XL'];
  for (const b of RNODE_BOARDS) if (ble.some(n => b.name.includes(n))) assert.equal(b.link, 'ble', b.name);
  for (const b of RNODE_BOARDS) if (/V2\.x|T-Beam SX|T-LoRa V|RNode NG|ESP32 montada/.test(b.name)) assert.equal(b.link, 'classic', b.name);
});

async function connect(stream: ByteStream, region: string, o: { answerMs?: number } = {}) {
  const link = new PiuLoraLink({ now: () => T, region, ...o });
  await link.attach(stream);
  await settle();
  return link;
}

test('matriz: cada placa × cada região sobe com o canal certo ou recusa a faixa errada', async () => {
  let up = 0, refused = 0;
  for (const b of RNODE_BOARDS) {
    const band = RNODE_MODELS[b.model];
    for (const r of REGIONS) {
      const p = piuRadio(r.id);
      const fits = band ? p.freqHz >= band.loHz && p.freqHz <= band.hiHz : true;
      const emu = new RNodeEmulator(b, { now: () => T });
      const link = await connect(new BleNus(emu, { mtu: 23, seed: up + refused }), r.id);
      const st = link.status();
      if (fits) {
        assert.equal(st.state, 'up', `${b.name} em ${r.id}: ${st.problem}`);
        const air = emu.phy()!;
        assert.deepEqual([air.freqHz, air.bwHz, air.sf, air.cr], [p.freqHz, p.bwHz, p.sf, p.cr], `${b.name} em ${r.id}`);
        assert.ok(air.txDbm <= p.txDbm && air.txDbm <= r.maxDbm, `${b.name} em ${r.id}: ${air.txDbm} dBm passa do limite`);
        up++;
      } else {
        assert.equal(st.state, 'failed', `${b.name} em ${r.id} devia recusar`);
        assert.match(st.problem ?? '', /fora da faixa da placa/);
        assert.equal(emu.online, false, `${b.name} em ${r.id}: rádio não pode ligar`);
        refused++;
      }
      link.detach();
    }
  }
  assert.equal(up + refused, RNODE_BOARDS.length * REGIONS.length);
  assert.ok(up > 300 && refused > 300, `${up} sobem, ${refused} recusam`);
});

test('Brasil: as placas de 915 MHz com BLE (as do celular) sobem em 904,75 MHz', async () => {
  const inBr = (m: number) => { const x = RNODE_MODELS[m]; return !x || (x.loHz <= 904_750_000 && x.hiHz >= 904_750_000); };
  const br = RNODE_BOARDS.filter(b => b.link === 'ble' && inBr(b.model));
  assert.ok(br.length >= 12);
  for (const b of br) {
    for (const mtu of [23, 185, 512]) {
      const emu = new RNodeEmulator(b, { now: () => T });
      const link = await connect(new BleNus(emu, { mtu, seed: mtu }), 'BR_902');
      assert.equal(link.status().state, 'up', `${b.name} MTU ${mtu}: ${link.status().problem}`);
      assert.equal(emu.phy()!.freqHz, 904_750_000);
      link.detach();
    }
  }
});

test('firmware: 1.52 em diante serve; antes disso a tela pede atualizar', async () => {
  for (const [fw, ok] of [[[1, 52], true], [[1, 86], true], [[2, 0], true], [[1, 51], false], [[1, 0], false]] as const) {
    const { ble } = bench('Heltec V3 (915)', { fw: [...fw] as [number, number], now: () => T });
    const link = await connect(ble, 'BR_902');
    assert.equal(link.status().state, ok ? 'up' : 'failed', `${fw.join('.')}`);
    if (!ok) assert.match(link.status().problem ?? '', /firmware antigo/);
  }
});

test('mundo real: sem provisionar, modo TNC e chip que não liga não sobem, cada um com o motivo', async () => {
  const unprov = bench('Heltec V3 (915)', { provisioned: false, now: () => T });
  assert.match((await connect(unprov.ble, 'BR_902')).status().problem ?? '', /sem provisionar/);

  // Modo TNC: a placa liga sozinha na configuração salva (aqui, Europa) e só devolveria o que o Piu manda.
  const saved = { freqHz: 869_525_000, bwHz: 125_000, sf: 8, cr: 5, txDbm: 14 };
  const tnc = bench('Heltec V3 (915)', { tnc: saved, now: () => T });
  const l = await connect(tnc.ble, 'BR_902');
  assert.match(l.status().problem ?? '', /modo TNC/);
  assert.deepEqual(tnc.emu.phy(), saved, 'continua no canal salvo: por isso o Piu recusa');

  const fault = bench('Heltec V3 (915)', { radioFault: true, now: () => T });
  assert.match((await connect(fault.ble, 'BR_902')).status().problem ?? '', /erro do RNode 0x01/);
});

test('mundo real: aparelho mudo ou que não fala RNode desiste no tempo, sem ficar "configurando"', async () => {
  const mute: ByteStream = { async write() {}, onData() { return () => {}; } };
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902', answerMs: 30 });
  await link.attach(mute);
  assert.equal(link.status().state, 'configuring');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(link.status().state, 'failed');
  assert.equal(link.status().problem, 'o rádio não respondeu');

  // Um aparelho Nordic UART qualquer que ecoa texto: nunca vira RNode.
  let fn: ((b: Uint8Array) => void) | null = null;
  const chatty: ByteStream = { async write(b) { queueMicrotask(() => fn?.(new TextEncoder().encode(`echo ${b.length}\r\n`))); }, onData(f) { fn = f; return () => { fn = null; }; } };
  const l2 = new PiuLoraLink({ now: () => T, region: 'BR_902', answerMs: 30 });
  await l2.attach(chatty);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(l2.status().state, 'failed');
});

test('mundo real: texto solto do firmware na serial não atrapalha a configuração', async () => {
  const { emu, ble } = bench('LILYGO T-Beam SX1276', { now: () => T });
  emu.bootText('Invalid EEPROM checksum\r\n');
  const link = new PiuLoraLink({ now: () => T, region: 'BR_902' });
  const p = link.attach(ble);
  emu.bootText('\r\nRNode boot\r\n');
  await p; await settle();
  assert.equal(link.status().state, 'up');
});

test('mundo real: falha de transmissão reconfigura o rádio e o enlace volta sozinho', async () => {
  let failNext = false;
  const { emu, ble, aired } = bench('Heltec V3 (915)', { now: () => T, txFault: () => { const f = failNext; failNext = false; return f; } });
  const link = await connect(ble, 'BR_902');
  assert.equal(link.status().state, 'up');
  failNext = true;
  await link.send(LORA_PEER, new Uint8Array(40));
  await settle();
  assert.equal(aired.length, 0, 'o pacote não foi ao ar');
  assert.equal(link.status().state, 'up', 'reconfigurou e voltou');
  await link.send(LORA_PEER, new Uint8Array(40));
  await settle();
  assert.equal(aired.length, 1);
  assert.equal(emu.stats.tx, 1);
});

test('mundo real: o firmware segura o que passa do tempo no ar e solta depois', async () => {
  const clock = { t: T };
  const { emu, ble, aired } = bench('Heltec V3 (915)', { now: () => clock.t });
  const link = new PiuLoraLink({ now: () => clock.t, region: 'EU_866' }); // 2,5 % no ar
  await link.attach(ble); await settle();
  assert.equal(link.status().state, 'up');
  // Mais do que o balde do app deixaria: escreve direto na placa, como um app com defeito faria.
  for (let i = 0; i < 20; i++) emu.input(Uint8Array.of(0xc0, 0x00, ...new Uint8Array(200).fill(i), 0xc0));
  const first = aired.length;
  assert.ok(first > 0 && first < 20, `${first} pacotes no primeiro minuto`);
  clock.t += 61_000; emu.drain();
  assert.ok(aired.length > first, 'depois de um minuto a fila anda');
});

test('mundo real: placa que falha toda transmissão não prende o app num laço de reconfigurar', async () => {
  const clock = { t: T };
  const { emu, ble } = bench('Heltec V3 (915)', { now: () => clock.t, txFault: () => true });
  const link = new PiuLoraLink({ now: () => clock.t, region: 'BR_902' });
  await link.attach(ble); await settle();
  let probes = 0;
  const input = emu.input.bind(emu);
  emu.input = b => { if (b.includes(0x51)) probes++; input(b); };
  for (let i = 0; i < 10 && link.status().state === 'up'; i++) {
    await link.send(LORA_PEER, new Uint8Array(40)).catch(() => {});
    await settle();
    clock.t += 5_000;
  }
  assert.equal(link.status().state, 'failed');
  assert.match(link.status().problem ?? '', /0x02/);
  assert.ok(probes <= 3, `${probes} reconfigurações`);
});
