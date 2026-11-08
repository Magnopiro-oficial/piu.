// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/transport/rnode/regions.ts. Não edite aqui.
/**
 * Regiões de rádio LoRa do mundo inteiro (docs/transporte/super-node-lora.md, docs/hardware/placas-lora.md).
 *
 * Fonte: tabela de regiões do firmware Meshtastic (meshtastic/firmware, src/mesh/RadioInterface.cpp, e o
 * enum RegionCode de config.proto): faixa livre (ISM) de cada país, tempo no ar máximo e potência máxima.
 * Ficam de fora as faixas de radioamador (2 m, 70 cm, 1,25 m): exigem licença e não aceitam conteúdo
 * cifrado. O mesmo código serve ao caminho A (rótulo da região do rádio Meshtastic) e ao B (frequência
 * do rádio próprio). Testado em __tests__/regions.test.ts; o piu-node usa uma cópia.
 */

export type LoraRegion = {
  id: string;
  /** Código no Meshtastic (Config.LoRaConfig.RegionCode). */
  meshtastic: number;
  /** Nome no Meshtastic (inglês), para o operador. */
  name: string;
  startMHz: number;
  endMHz: number;
  /** Tempo no ar máximo (% por hora). */
  dutyPct: number;
  /** Potência máxima (dBm). */
  maxDbm: number;
  /** 2,4 GHz: banda larga do SX1280. */
  wide?: true;
};

export const REGIONS: readonly LoraRegion[] = [
  { id: 'US', meshtastic: 1, name: 'United States', startMHz: 902.0, endMHz: 928.0, dutyPct: 100, maxDbm: 30 },
  { id: 'EU_433', meshtastic: 2, name: 'European Union 433MHz', startMHz: 433.0, endMHz: 434.0, dutyPct: 10, maxDbm: 10 },
  { id: 'EU_868', meshtastic: 3, name: 'European Union 868MHz', startMHz: 869.4, endMHz: 869.65, dutyPct: 10, maxDbm: 27 },
  { id: 'EU_866', meshtastic: 29, name: 'European Union 866MHz', startMHz: 865.6, endMHz: 867.6, dutyPct: 2.5, maxDbm: 27 },
  { id: 'EU_N_868', meshtastic: 32, name: 'European Union 868MHz (Narrow)', startMHz: 869.4, endMHz: 869.65, dutyPct: 10, maxDbm: 27 },
  { id: 'CN', meshtastic: 4, name: 'China', startMHz: 470.0, endMHz: 510.0, dutyPct: 100, maxDbm: 19 },
  { id: 'JP', meshtastic: 5, name: 'Japan', startMHz: 920.5, endMHz: 923.5, dutyPct: 100, maxDbm: 13 },
  { id: 'ANZ', meshtastic: 6, name: 'Australia / New Zealand', startMHz: 915.0, endMHz: 928.0, dutyPct: 100, maxDbm: 30 },
  { id: 'ANZ_433', meshtastic: 22, name: 'Australia / New Zealand 433MHz', startMHz: 433.05, endMHz: 434.79, dutyPct: 100, maxDbm: 14 },
  { id: 'RU', meshtastic: 9, name: 'Russia', startMHz: 868.7, endMHz: 869.2, dutyPct: 100, maxDbm: 20 },
  { id: 'KR', meshtastic: 7, name: 'Korea', startMHz: 920.0, endMHz: 923.0, dutyPct: 100, maxDbm: 23 },
  { id: 'TW', meshtastic: 8, name: 'Taiwan', startMHz: 920.0, endMHz: 925.0, dutyPct: 100, maxDbm: 27 },
  { id: 'IN', meshtastic: 10, name: 'India', startMHz: 865.0, endMHz: 867.0, dutyPct: 100, maxDbm: 30 },
  { id: 'NZ_865', meshtastic: 11, name: 'New Zealand 865MHz', startMHz: 864.0, endMHz: 868.0, dutyPct: 100, maxDbm: 36 },
  { id: 'TH', meshtastic: 12, name: 'Thailand', startMHz: 920.0, endMHz: 925.0, dutyPct: 10, maxDbm: 27 },
  { id: 'UA_433', meshtastic: 14, name: 'Ukraine 433MHz', startMHz: 433.0, endMHz: 434.7, dutyPct: 10, maxDbm: 10 },
  { id: 'MY_433', meshtastic: 16, name: 'Malaysia 433MHz', startMHz: 433.0, endMHz: 435.0, dutyPct: 100, maxDbm: 20 },
  { id: 'MY_919', meshtastic: 17, name: 'Malaysia 919MHz', startMHz: 919.0, endMHz: 924.0, dutyPct: 100, maxDbm: 27 },
  { id: 'SG_923', meshtastic: 18, name: 'Singapore 923MHz', startMHz: 917.0, endMHz: 925.0, dutyPct: 100, maxDbm: 20 },
  { id: 'PH_433', meshtastic: 19, name: 'Philippines 433MHz', startMHz: 433.0, endMHz: 434.7, dutyPct: 100, maxDbm: 10 },
  { id: 'PH_868', meshtastic: 20, name: 'Philippines 868MHz', startMHz: 868.0, endMHz: 869.4, dutyPct: 100, maxDbm: 14 },
  { id: 'PH_915', meshtastic: 21, name: 'Philippines 915MHz', startMHz: 915.0, endMHz: 918.0, dutyPct: 100, maxDbm: 24 },
  { id: 'KZ_433', meshtastic: 23, name: 'Kazakhstan 433MHz', startMHz: 433.075, endMHz: 434.775, dutyPct: 100, maxDbm: 10 },
  { id: 'KZ_863', meshtastic: 24, name: 'Kazakhstan 863MHz', startMHz: 863.0, endMHz: 868.0, dutyPct: 100, maxDbm: 30 },
  { id: 'NP_865', meshtastic: 25, name: 'Nepal 865MHz', startMHz: 865.0, endMHz: 868.0, dutyPct: 100, maxDbm: 30 },
  { id: 'BR_902', meshtastic: 26, name: 'Brazil 902MHz', startMHz: 902.0, endMHz: 907.5, dutyPct: 100, maxDbm: 30 },
  { id: 'LORA_24', meshtastic: 13, name: '2.4 GHz', startMHz: 2400.0, endMHz: 2483.5, dutyPct: 100, maxDbm: 10, wide: true },
];

export const regionByCode = (code: number | undefined) => (code ? REGIONS.find(r => r.meshtastic === code) : undefined);
const byId = (id: string) => REGIONS.find(r => r.id === id);

/** Ajustes do rádio próprio (RNode) numa região: os mesmos em todos os rádios do Piu daquela região. */
export type PiuRadio = { region: string; freqHz: number; bwHz: number; sf: number; cr: number; txDbm: number; airtimePct: number };

/** Potência padrão (dBm): baixa o bastante para qualquer placa, abaixo do limite de quase todas as regiões. */
const TX_DBM = 17;
/** Tempo no ar máximo do Piu, mesmo onde a região permite mais (canal compartilhado). */
const AIRTIME_PCT = 10;

/**
 * Plano do Piu numa região: o canal no meio da faixa (passos de 25 kHz), 125 kHz de banda (812,5 kHz em
 * 2,4 GHz), SF 9, CR 4/5, potência e tempo no ar no menor entre o padrão do Piu e o limite da região.
 */
export function piuRadio(id: string): PiuRadio {
  const r = byId(id);
  if (!r) throw new Error(`Região de rádio desconhecida: ${id}.`);
  const bwHz = r.wide ? 812_500 : 125_000;
  const lo = r.startMHz * 1e6 + bwHz / 2, hi = r.endMHz * 1e6 - bwHz / 2;
  const step = 25_000;
  let freqHz = Math.round((lo + hi) / 2 / step) * step;
  if (freqHz < lo) freqHz += step;
  if (freqHz > hi) freqHz -= step;
  return { region: r.id, freqHz, bwHz, sf: 9, cr: 5, txDbm: Math.min(TX_DBM, r.maxDbm), airtimePct: Math.min(AIRTIME_PCT, r.dutyPct) };
}

/** Faixa de frequência de cada chip de rádio LoRa (MHz), pelas folhas de dados da Semtech. */
const CHIP_BANDS: Record<string, [number, number][]> = {
  SX1262: [[150, 960]], LLCC68: [[150, 960]], SX1276: [[137, 1020]], SX1277: [[137, 1020]], SX1279: [[137, 960]],
  SX1268: [[410, 810]], SX1278: [[137, 525]], SX1280: [[2400, 2500]], SX1281: [[2400, 2500]],
  LR1110: [[150, 960]], LR1120: [[150, 960], [2400, 2500]], LR1121: [[150, 960], [2400, 2500]], LR2021: [[150, 960], [2400, 2500]],
  STM32WL: [[150, 960]],
};

/** O chip alcança a faixa inteira da região? */
export function chipFits(chip: string, id: string): boolean {
  const r = byId(id), bands = CHIP_BANDS[chip];
  return !!r && !!bands && bands.some(([a, b]) => r.startMHz >= a && r.endMHz <= b);
}
export const regionsForChip = (chip: string) => REGIONS.filter(r => chipFits(chip, r.id));

/**
 * País (ISO 3166-1, alfa-2) → região padrão, só onde a regra é conhecida (a mesma escolha do Meshtastic
 * para o país). Nos outros, `null`: a pessoa escolhe a região.
 */
const EU = 'AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MT NL NO PL PT RO SE SI SK'.split(' ');
const COUNTRY: Record<string, string> = {
  US: 'US', CA: 'US', MX: 'US', BR: 'BR_902', AU: 'ANZ', NZ: 'ANZ', CN: 'CN', JP: 'JP', KR: 'KR', TW: 'TW', RU: 'RU', IN: 'IN',
  TH: 'TH', UA: 'UA_433', MY: 'MY_919', SG: 'SG_923', PH: 'PH_915', KZ: 'KZ_863', NP: 'NP_865',
  ...Object.fromEntries(EU.map(c => [c, 'EU_868'])),
};
export const regionForCountry = (cc: string | undefined) => (cc ? COUNTRY[cc.toUpperCase()] ?? null : null);

const mhz = (n: number) => String(n).replace('.', ',');
/** "902–907,5 MHz" ou "2,4 GHz". */
export function bandLabel(id: string): string {
  const r = byId(id);
  if (!r) return id;
  return r.wide ? '2,4 GHz' : `${mhz(r.startMHz)}–${mhz(r.endMHz)} MHz`;
}
