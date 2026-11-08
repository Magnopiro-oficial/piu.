/**
 * Linha LoRa da aba Rede com os dois rádios e a região do rádio do Piu (desenho Piu 17), a partir do
 * rádio e do enlace reais. TypeScript puro, testado em __tests__/piuLora.test.ts.
 */
import type { RadioStatus } from '../transport/meshtastic/radio';
import type { PiuLoraStatus } from '../transport/rnode/link';
import { bandLabel, piuRadio, REGIONS } from '../transport/rnode/regions';

/** Por qual rádio a malha LoRa sai: o do Piu primeiro (Automático), ou só um deles. */
export type LoraMode = 'auto' | 'piu' | 'mesh';
export type LoraWho = 'piu' | 'mesh';

/** Meios ligados no transporte: a chave "Rádio LoRa" desliga os dois; "Só …" desliga o outro. */
export function loraMedia(mode: LoraMode, on: boolean): { lora: boolean; piulora: boolean } {
  return { lora: on && mode !== 'piu', piulora: on && mode !== 'mesh' };
}

/** Rádio que está levando as mensagens agora (marca "em uso"). */
export function inUse(mode: LoraMode, up: Record<LoraWho, boolean>): LoraWho | null {
  if (mode === 'auto') return up.piu ? 'piu' : up.mesh ? 'mesh' : null;
  return up[mode] ? mode : null;
}

/** No modo "Só …", o rádio escolhido caiu: as mensagens esperam por ele. */
export function waitingFor(mode: LoraMode, up: Record<LoraWho, boolean>): LoraWho | null {
  return mode !== 'auto' && !up[mode] ? mode : null;
}

export type PiuProblem =
  | { kind: 'band' } | { kind: 'code'; code: string } | { kind: 'notRNode' } | { kind: 'region' }
  | { kind: 'old'; version: string } | { kind: 'tnc' } | { kind: 'setup' } | { kind: 'silent' } | { kind: 'other' };

/** O motivo do RNodeSetup/PiuLoraLink (texto) no que a tela mostra (3g, 3h, 3i e os do mundo real). */
export function piuProblem(problem: string | null | undefined): PiuProblem {
  const p = problem ?? '';
  const code = /erro do RNode (0x[0-9a-f]{2})/.exec(p);
  if (code) return { kind: 'code', code: code[1]! };
  if (p.startsWith('frequência diferente') || p.startsWith('frequência fora da faixa')) return { kind: 'band' };
  const old = /^firmware antigo \(([^)]*)\)/.exec(p);
  if (old) return { kind: 'old', version: old[1]! };
  if (p === 'placa em modo TNC') return { kind: 'tnc' };
  if (p === 'placa sem provisionar' || p === 'o rádio da placa não ligou') return { kind: 'setup' };
  if (p === 'o rádio não respondeu') return { kind: 'silent' };
  if (p === 'não é um RNode') return { kind: 'notRNode' };
  if (p.startsWith('escolha a região')) return { kind: 'region' };
  return { kind: 'other' };
}

export type PiuRowView =
  | { kind: 'none' | 'searching' | 'noPerm' }
  | { kind: 'connected'; radio?: string; region: string | null; freqHz?: number; superNodes?: { count: number; gateway: boolean }; busySec?: number }
  | { kind: 'failed'; radio?: string; region: string | null; problem: PiuProblem }
  | { kind: 'away'; radio: string };

export function piuRowState(radio: RadioStatus, link: PiuLoraStatus, o: { granted: boolean; now: number }): PiuRowView {
  if (!o.granted) return { kind: 'noPerm' };
  const name = radio.device?.name;
  if (radio.phase === 'scanning' || radio.phase === 'connecting' || radio.phase === 'pairing') return { kind: 'searching' };
  if (radio.phase === 'connected') {
    if (link.state === 'failed') return { kind: 'failed', radio: name, region: link.region, problem: piuProblem(link.problem) };
    if (link.state !== 'up') return { kind: 'searching' };
    const busy = link.busyUntil !== undefined && link.busyUntil > o.now ? Math.ceil((link.busyUntil - o.now) / 1000) : undefined;
    return {
      kind: 'connected', radio: name, region: link.region,
      ...(link.region ? { freqHz: piuRadio(link.region).freqHz } : {}),
      ...(link.superNodes ? { superNodes: { count: link.superNodes, gateway: link.gateways > 0 } } : {}),
      ...(busy ? { busySec: busy } : {}),
    };
  }
  if ((radio.phase === 'away' || radio.phase === 'error') && name) return { kind: 'away', radio: name };
  return { kind: 'none' };
}

/** "904,75 MHz" (até 2 casas, vírgula); acima de 1 GHz sem casas. */
export function freqLabel(hz: number): string {
  const mhz = hz / 1e6;
  return `${(mhz >= 1000 ? String(Math.round(mhz)) : String(Math.round(mhz * 100) / 100)).replace('.', ',')} MHz`;
}

/** Regiões por continente (4). Nomes no i18n (`piu.region.<id>`). */
export const REGION_GROUPS: readonly { key: 'americas' | 'europe' | 'asia' | 'oceania' | 'world'; ids: readonly string[] }[] = [
  { key: 'americas', ids: ['BR_902', 'US'] },
  { key: 'europe', ids: ['EU_868', 'EU_866', 'EU_N_868', 'EU_433', 'UA_433', 'RU'] },
  { key: 'asia', ids: ['IN', 'JP', 'KR', 'TW', 'CN', 'TH', 'PH_915', 'PH_868', 'PH_433', 'MY_919', 'MY_433', 'SG_923', 'KZ_863', 'KZ_433', 'NP_865'] },
  { key: 'oceania', ids: ['ANZ', 'ANZ_433', 'NZ_865'] },
  { key: 'world', ids: ['LORA_24'] },
];

/** Países de cada região (para a busca achar "Portugal" dentro de Europa 868). */
const COUNTRIES: Record<string, string[]> = {
  US: ['US', 'CA', 'MX'], BR_902: ['BR'], ANZ: ['AU', 'NZ'], CN: ['CN'], JP: ['JP'], KR: ['KR'], TW: ['TW'], RU: ['RU'], IN: ['IN'],
  TH: ['TH'], UA_433: ['UA'], MY_919: ['MY'], MY_433: ['MY'], SG_923: ['SG'], PH_915: ['PH'], PH_868: ['PH'], PH_433: ['PH'],
  KZ_863: ['KZ'], KZ_433: ['KZ'], NP_865: ['NP'], NZ_865: ['NZ'], ANZ_433: ['AU', 'NZ'],
  EU_868: 'AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MT NL NO PL PT RO SE SI SK'.split(' '),
  EU_433: 'AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MT NL NO PL PT RO SE SI SK'.split(' '),
};

export type RegionRow = { id: string; name: string; band: string; maxDbm: number; dutyPct: number };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Lista da tela 4, filtrada pela busca (sem acento; nome, faixa e países). Grupos vazios saem. */
export function regionRows(q: string, o: { name: (id: string) => string; country?: (cc: string) => string | undefined }) {
  const nq = norm(q);
  return REGION_GROUPS.map(g => ({
    key: g.key,
    rows: g.ids.flatMap(id => {
      const r = REGIONS.find(x => x.id === id)!;
      const name = o.name(id);
      const hay = norm([name, id, bandLabel(id), ...(COUNTRIES[id] ?? []).map(cc => o.country?.(cc) ?? '')].join(' '));
      return !nq || hay.includes(nq) ? [{ id, name, band: bandLabel(id), maxDbm: r.maxDbm, dutyPct: r.dutyPct }] : [];
    }),
  })).filter(g => g.rows.length);
}
