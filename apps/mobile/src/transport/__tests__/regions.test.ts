/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bandLabel, chipFits, piuRadio, REGIONS, regionByCode, regionForCountry, regionsForChip } from '../rnode/regions';

test('regiões: as faixas livres do Meshtastic, sem as de radioamador', () => {
  assert.equal(REGIONS.length, 27);
  assert.ok(REGIONS.every(r => !r.id.startsWith('ITU')), 'radioamador exige licença e não aceita conteúdo cifrado');
  assert.equal(regionByCode(26)?.id, 'BR_902');
  assert.equal(regionByCode(0), undefined);
  assert.equal(regionByCode(999), undefined);
});

test('plano do Piu: dentro da faixa, potência e tempo no ar no limite da região', () => {
  for (const r of REGIONS) {
    const p = piuRadio(r.id);
    const halfMHz = p.bwHz / 2 / 1e6;
    assert.ok(p.freqHz / 1e6 - halfMHz >= r.startMHz - 1e-9 && p.freqHz / 1e6 + halfMHz <= r.endMHz + 1e-9, `${r.id} fora da faixa`);
    assert.ok(p.txDbm <= r.maxDbm, `${r.id} acima da potência`);
    assert.ok(p.airtimePct <= Math.min(10, r.dutyPct), `${r.id} acima do tempo no ar`);
    assert.equal(p.freqHz % 25_000, 0, 'canal em passos de 25 kHz');
  }
  assert.deepEqual(piuRadio('EU_868'), { region: 'EU_868', freqHz: 869_525_000, bwHz: 125_000, sf: 9, cr: 5, txDbm: 17, airtimePct: 10 });
  assert.equal(piuRadio('EU_866').airtimePct, 2.5);
  assert.equal(piuRadio('JP').txDbm, 13);
  assert.equal(piuRadio('LORA_24').bwHz, 812_500);
  assert.throws(() => piuRadio('XX'), /região/i);
});

test('chip e região: 433/470 MHz, sub-GHz e 2,4 GHz', () => {
  assert.ok(chipFits('SX1262', 'BR_902'));
  assert.ok(chipFits('SX1278', 'EU_433'));
  assert.ok(!chipFits('SX1278', 'US'));
  assert.ok(chipFits('SX1268', 'CN'));
  assert.ok(!chipFits('SX1268', 'EU_868'));
  assert.ok(chipFits('SX1280', 'LORA_24'));
  assert.ok(!chipFits('SX1280', 'US'));
  assert.ok(!chipFits('SX1262', 'LORA_24'));
  assert.ok(chipFits('LR1121', 'LORA_24') && chipFits('LR1121', 'EU_868'));
  assert.deepEqual(regionsForChip('SX1280').map(r => r.id), ['LORA_24']);
});

test('país → região: só onde a regra é conhecida; nos outros a pessoa escolhe', () => {
  assert.equal(regionForCountry('BR'), 'BR_902');
  assert.equal(regionForCountry('us'), 'US');
  assert.equal(regionForCountry('DE'), 'EU_868');
  assert.equal(regionForCountry('PT'), 'EU_868');
  assert.equal(regionForCountry('AU'), 'ANZ');
  assert.equal(regionForCountry('JP'), 'JP');
  assert.equal(regionForCountry('IN'), 'IN');
  assert.equal(regionForCountry('AR'), null);
  assert.equal(regionForCountry(undefined), null);
});

test('rótulo da faixa: sem nome de país, em MHz ou GHz', () => {
  assert.equal(bandLabel('BR_902'), '902–907,5 MHz');
  assert.equal(bandLabel('EU_868'), '869,4–869,65 MHz');
  assert.equal(bandLabel('LORA_24'), '2,4 GHz');
});
