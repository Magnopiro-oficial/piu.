// Topologia da página Malha. Coordenadas em px num quadro de 628×520.
// Nós próprios usam o id do equipamento (somem do mapa se ele for revogado).

export type LinkKind = 'eth' | 'mesh' | 'ble' | 'lora';
export type NodeKind = 'own' | 'peer' | 'ap' | 'phone';

export const MAP_W = 628;
export const MAP_H = 520;

export const POS: Record<string, [number, number]> = {
  router: [210, 250], mini: [330, 300], antena: [430, 150], galpao: [130, 400], praca: [300, 445], escola: [505, 385], torre: [560, 70], vale: [585, 250],
  rep: [395, 360], p1: [110, 165], p2: [80, 285], p3: [225, 120], p4: [405, 425], p5: [470, 290], p6: [180, 340],
};

/** [de, para, tipo, é enlace próprio] */
export const LINKS: [string, string, LinkKind, boolean][] = [
  ['router', 'mini', 'eth', true], ['mini', 'antena', 'eth', true], ['router', 'p1', 'ble', true], ['router', 'p2', 'ble', true], ['router', 'p3', 'ble', true], ['router', 'p6', 'ble', true],
  ['mini', 'galpao', 'mesh', true], ['mini', 'praca', 'mesh', true], ['mini', 'escola', 'mesh', true], ['mini', 'rep', 'mesh', true], ['rep', 'p4', 'ble', true], ['mini', 'p5', 'ble', true],
  ['antena', 'torre', 'lora', true], ['antena', 'vale', 'lora', true], ['galpao', 'praca', 'mesh', false], ['escola', 'vale', 'lora', false],
];

/** [chave, tipo, ícone, rótulo] — para nós próprios o rótulo vem do equipamento. */
export const NODES: [string, NodeKind, string?, string?][] = [
  ['router', 'own', 'router'], ['mini', 'own', 'dns'], ['antena', 'own', 'settings_input_antenna'],
  ['galpao', 'peer', 'router', 'Galpão'], ['praca', 'peer', 'dns', 'Gateway Praça'], ['escola', 'peer', 'router', 'Escola Municipal'],
  ['torre', 'peer', 'settings_input_antenna', 'Torre Serra'], ['vale', 'peer', 'settings_input_antenna', 'Super Node Vale'], ['rep', 'ap', 'wifi'],
  ['p1', 'phone'], ['p2', 'phone'], ['p3', 'phone'], ['p4', 'phone'], ['p5', 'phone'], ['p6', 'phone'],
];

export const LINE_STYLE: Record<LinkKind, [string, string]> = { eth: ['2.5px', 'solid'], mesh: ['1.5px', 'solid'], ble: ['1px', 'dotted'], lora: ['1.5px', 'dashed'] };

/** Ordem da legenda; o rótulo vem do dicionário (`legend.<tipo>`). */
export const LEGEND: LinkKind[] = ['eth', 'mesh', 'ble', 'lora'];
