// Rede e provider no celular (design/PiuApp.dc.html): só textos e o catálogo de equipamentos.
// Vizinhos, números do Modo nó e do diagnóstico vêm do transporte e do mensageiro reais
// (state/transport.tsx, state/messaging.tsx); equipamentos do provider, do pareamento real com o
// piu-node (lib/approvalNodes.ts).
import type { Key } from '../i18n/core';
import type { IconName } from '../ui/Icon';
import type { TxKey } from '../lib/networkCore';

export type { TxKey };

/** [chave, ícone, nome (chave do dicionário), descrição (chave)]. Contagens de vizinhos são acrescentadas na tela, do transporte real. */
export const TRANSPORTS: [TxKey, IconName, Key, Key][] = [
  ['ble', 'bluetooth', 'tx.ble', 'tx.ble.desc'],
  ['direct', 'wifi_tethering', 'tx.direct', 'tx.direct.desc'],
  ['mesh', 'hub', 'tx.mesh', 'tx.mesh.desc'],
  ['lora', 'settings_input_antenna', 'tx.lora', 'tx.lora.desc'],
  ['eth', 'cable', 'tx.eth', 'tx.eth.desc'],
];

/**
 * Meios que aparecem na lista mas que nenhum transporte deste app usa ainda: sem chave de ligar, com
 * o motivo. O Wi-Fi Mesh (pela rede local, até um roteador com Piu Node) não existe nesta versão.
 */
export const UNAVAILABLE_TX: Partial<Record<TxKey, Key>> = { mesh: 'tx.mesh.unavailable' };

/**
 * Vizinhos do transporte SIMULADO (Expo Go e navegador, ferramenta de teste em `transport/simulated.ts`):
 * só o transporte simulado lê esta lista. As telas mostram o que o transporte anunciar, marcado como
 * simulado; nenhuma tela usa esta lista diretamente.
 */
export interface Neighbor { name: string; t: TxKey; spoof?: boolean }
export const NEIGHBORS: Neighbor[] = [
  { name: 'Pixel 7a · 9C21', t: 'ble' },
  { name: 'iPhone · 51BD', t: 'ble' },
  { name: 'Galaxy · E07A', t: 'direct' },
  { name: 'Gateway Praça', t: 'direct' },
];

// ── provider ─────────────────────────────────────────────
/** `name`/`cls`/`badge`/`desc`/`short` são chaves do dicionário (`provFam.*`); `steps` = [chave do título, detalhe fixo (comando/URL) ou chave]. */
export interface ProvFamily {
  id: string; icon: IconName; name: Key; cls: Key; badge: Key; desc: Key; disabled?: boolean;
  short?: Key;
  /** Como instalar o piu-node (passos reais de packaging/ e apps/piu-node). `[título, detalhe]`; detalhe começando com `k:` é chave do dicionário. */
  steps?: [Key, string][];
  isRadio?: boolean; isAp?: boolean;
}

const PAIR_STEPS: [Key, string][] = [
  ['provStep.openPanel', 'k:provStep.openPanel.d'],
  ['provStep.enterCode', 'k:provStep.enterCode.d'],
  ['provStep.pairPhone', 'k:provStep.pairPhone.d'],
];

export const PROV_FAMILIES: ProvFamily[] = [
  { id: 'router', icon: 'router', name: 'provFam.router', cls: 'provCls.home', badge: 'provBadge.beta', desc: 'provFam.router.desc', short: 'provFam.router.short',
    steps: [['provStep.installPkg', 'opkg install ./piu-node_0.1.0-1_all.ipk'], ['provStep.startService', '/etc/init.d/piu-node enable && /etc/init.d/piu-node start'], ...PAIR_STEPS] },
  { id: 'linux', icon: 'computer', name: 'provFam.linux', cls: 'provCls.homeGateway', badge: 'provBadge.beta', desc: 'provFam.linux.desc', short: 'provFam.linux.short',
    steps: [['provStep.installBuild', 'cd apps/piu-node && npm ci && npm run build'], ['provStep.startNode', 'npm start'], ...PAIR_STEPS] },
  { id: 'lora', icon: 'settings_input_antenna', name: 'provFam.lora', cls: 'provCls.super', badge: 'provBadge.beta', desc: 'provFam.lora.desc', short: 'provFam.lora.short', isRadio: true,
    steps: [['provStep.plugRadio', 'k:provStep.plugRadio.d'], ['provStep.serialPort', 'PIU_SERIAL=lora:/dev/ttyUSB0@115200'], ...PAIR_STEPS] },
  { id: 'ap', icon: 'wifi', name: 'provFam.ap', cls: 'provCls.ap', badge: 'provBadge.noInstall', desc: 'provFam.ap.desc', short: 'provFam.ap.short', isAp: true,
    steps: [['provStep.apIsolation', 'k:provStep.apIsolation.d'], ['provStep.multicast', 'k:provStep.multicast.d'], ['provStep.linkNode', 'k:provStep.linkNode.d']] },
  { id: 'ptp', icon: 'cell_tower', name: 'provFam.ptp', cls: 'provCls.super', badge: 'provBadge.evaluating', desc: 'provFam.ptp.desc', disabled: true },
];

/** Classes de nó: nome fixo (Home Node, Super Node, Gateway Local); `what`/`desc`/`ex` são chaves do dicionário. */
export const PROV_CLASSES: { icon: IconName; name: string; what: Key; desc: Key; ex: Key }[] = [
  { icon: 'router', name: 'Home Node', what: 'provClass.home.what', desc: 'provClass.home.desc', ex: 'provClass.home.ex' },
  { icon: 'settings_input_antenna', name: 'Super Node', what: 'provClass.super.what', desc: 'provClass.super.desc', ex: 'provClass.super.ex' },
  { icon: 'dns', name: 'Gateway Local', what: 'provClass.gateway.what', desc: 'provClass.gateway.desc', ex: 'provClass.gateway.ex' },
];

/** Nomes `piu.*` reservados (usados pelo protótipo do painel); a checagem real é feita pelo piu-node. */
export const TAKEN_PUB: string[] = [];
