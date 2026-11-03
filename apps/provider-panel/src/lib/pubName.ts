import { TAKEN_NAMES } from '../data/seed';

export const PUB_MAX = 28;

/** Normaliza o que a pessoa digita para o formato `[a-z0-9-]`, até 28 caracteres. */
export function sanitizePub(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ +/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, PUB_MAX);
}

export type PubCheck = { ok: boolean; icon: string; msg: string; tone: 'muted' | 'strong'; ring: 'none' | 'soft' | 'strong' };

/**
 * Checagem de disponibilidade do nome público `piu.*`.
 * `own` = nomes (sem prefixo) que este operador já usa.
 * `real` (com piu-node): sem a lista de exemplo; a consulta aos nomes da malha e a assinatura ainda não existem.
 */
export function checkPub(p: string, own: string[], real = false): PubCheck {
  if (!p) return { ok: false, icon: 'edit', msg: 'Escolha um nome para a rede.', tone: 'muted', ring: 'none' };
  if (real && own.includes(p)) return { ok: false, icon: 'error', msg: `piu.${p} já é usado por outro equipamento seu.`, tone: 'strong', ring: 'strong' };
  if (!real && (TAKEN_NAMES.includes(p) || own.includes(p)))
    return { ok: false, icon: 'error', msg: `piu.${p} já é usado por outro nó desta malha.`, tone: 'strong', ring: 'strong' };
  if (/cardeal|casa|rua|apto|apartamento|numero/.test(p))
    return { ok: true, icon: 'warning', msg: 'Disponível, mas evite nome ou endereço: qualquer pessoa por perto vê este nome.', tone: 'strong', ring: 'soft' };
  if (real) return { ok: true, icon: 'check', msg: 'Não usado pelos seus equipamentos. A consulta aos nomes da malha e a assinatura ainda não existem nesta versão.', tone: 'muted', ring: 'none' };
  return { ok: true, icon: 'verified', msg: 'Disponível na malha local · será assinado pela sua chave de operador.', tone: 'muted', ring: 'none' };
}
