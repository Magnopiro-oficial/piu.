import { TAKEN_PUB } from '../data/network';

export const PUB_MAX = 28;

/** Normaliza para o formato do nome público: `[a-z0-9-]`, até 28 caracteres. */
export function sanitizePub(raw: string): string {
  return raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ +/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, PUB_MAX);
}

export type PubCheck = { ok: boolean; icon: 'edit' | 'error' | 'warning' | 'verified'; msg: string; strong: boolean; ring: 'none' | 'soft' | 'strong' };

/** Disponibilidade do nome `piu.*`. `own` = nomes (sem prefixo) que você já usa. */
export function checkPub(p: string, own: string[] = []): PubCheck {
  if (!p) return { ok: false, icon: 'edit', msg: 'Escolha um nome para a rede.', strong: false, ring: 'none' };
  if (TAKEN_PUB.includes(p) || own.includes(p)) return { ok: false, icon: 'error', msg: `piu.${p} já é usado por outro nó desta malha.`, strong: true, ring: 'strong' };
  if (/cardeal|casa|rua|apto|apartamento|numero/.test(p))
    return { ok: true, icon: 'warning', msg: 'Disponível, mas evite nome ou endereço: qualquer pessoa por perto vê.', strong: true, ring: 'soft' };
  return { ok: true, icon: 'verified', msg: 'Disponível na malha local · assinado pela sua chave de operador.', strong: false, ring: 'none' };
}
