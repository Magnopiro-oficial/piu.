/**
 * Configuração do modem KISS de banda estreita (`PIU_SERIAL=tnc:…`), pelas variáveis `PIU_TNC_*`.
 *
 * Desligado por padrão. Para ligar, o operador declara onde o rádio transmite (`PIU_TNC_BAND`):
 * - `licensed`: canal privado com licença (no Brasil, Serviço Limitado Privado em 148–174 ou 400–470 MHz);
 * - `free`: faixa de uso livre que aceita dados, com equipamento homologado.
 * Faixa de radioamador (2 m, 70 cm) NÃO serve: o Piu só leva envelopes cifrados, e o radioamador proíbe
 * criptografia (Brasil: Ato Anatel 926/2024, item 6.11). `amateur` é recusado com esse aviso.
 * Estudo: docs/estudos/2026-11-23-comunicacao-uhf-vhf.md.
 */
import { parseCall } from './ax25.js';
import type { TncRadio } from './tnc.js';

const HAM = ['amateur', 'ham', 'radioamador'];

export function loadTncRadio(env: NodeJS.ProcessEnv, wanted: boolean): TncRadio | undefined {
  const band = env.PIU_TNC_BAND?.trim().toLowerCase() ?? '';
  if (!band) {
    if (wanted) throw new Error('PIU_TNC_BAND: declare onde o rádio do modem transmite: "licensed" (canal privado com licença) ou "free" (faixa de uso livre que aceita dados). Faixa de radioamador não serve: o Piu só leva mensagens cifradas.');
    return undefined;
  }
  if (HAM.includes(band)) throw new Error('PIU_TNC_BAND: faixa de radioamador não aceita mensagem cifrada, e o Piu só leva mensagens cifradas. Use um canal privado com licença ("licensed") ou uma faixa de uso livre que aceite dados ("free").');
  if (band !== 'licensed' && band !== 'free') throw new Error(`PIU_TNC_BAND: valor inválido (${band}). Use "licensed" ou "free".`);
  const num = (name: string, def: number, ok: (n: number) => boolean) => {
    const v = env[name]; if (v === undefined || v === '') return def;
    const n = Number(v); if (!ok(n)) throw new Error(`${name}: valor inválido (${v}).`); return n;
  };
  const call = parseCall(env.PIU_TNC_CALL?.trim() || 'PIU');
  if (!call) throw new Error(`PIU_TNC_CALL: use até 6 letras ou números e, se quiser, -0 a -15 (recebido: ${env.PIU_TNC_CALL}).`);
  const ax25 = env.PIU_TNC_AX25;
  return {
    band,
    bps: num('PIU_TNC_BPS', 1200, n => Number.isInteger(n) && n >= 300 && n <= 1_000_000),
    txDelayMs: num('PIU_TNC_TXDELAY_MS', 300, n => Number.isInteger(n) && n >= 0 && n <= 2550),
    dutyPercent: num('PIU_TNC_DUTY', 10, n => n > 0 && n <= 100),
    call: call.ssid ? `${call.name}-${call.ssid}` : call.name,
    ax25: ax25 === undefined || ax25 === '' ? true : !['0', 'false', 'off', 'nao', 'não'].includes(ax25.toLowerCase()),
  };
}
