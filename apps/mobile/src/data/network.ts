// Rede e provider no celular (design/PiuApp.dc.html): só textos e o catálogo de equipamentos.
// Vizinhos, números do Modo nó e do diagnóstico vêm do transporte e do mensageiro reais
// (state/transport.tsx, state/messaging.tsx); equipamentos do provider, do pareamento real com o
// piu-node (lib/approvalNodes.ts).
import type { IconName } from '../ui/Icon';
import type { TxKey } from '../lib/networkCore';

export type { TxKey };

/** [chave, ícone, nome, descrição]. Contagens de vizinhos são acrescentadas na tela, do transporte real. */
export const TRANSPORTS: [TxKey, IconName, string, string][] = [
  ['ble', 'bluetooth', 'Bluetooth LE', 'Descoberta e texto curto'],
  ['direct', 'wifi_tethering', 'Wi-Fi Direct', 'Aparelho a aparelho, sem roteador'],
  ['mesh', 'hub', 'Wi-Fi Mesh', 'Arquivos e mídia · por um roteador com Piu Node'],
  ['lora', 'settings_input_antenna', 'Rádio LoRa', 'Alertas e texto · conecte um adaptador'],
  ['eth', 'cable', 'USB / Ethernet local', 'Gateway local, sem internet'],
];

/**
 * Meios que aparecem na lista mas que nenhum transporte deste app usa ainda: sem chave de ligar, com
 * o motivo. O Wi-Fi Mesh (pela rede local, até um roteador com Piu Node) não existe nesta versão.
 */
export const UNAVAILABLE_TX: Partial<Record<TxKey, string>> = {
  mesh: 'Indisponível nesta versão: o celular ainda não leva mensagens pela rede Wi-Fi local',
};

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
export interface ProvFamily {
  id: string; icon: IconName; name: string; cls: string; badge: string; desc: string; disabled?: boolean;
  short?: string;
  /** Como instalar o piu-node (passos reais de packaging/ e apps/piu-node). */
  steps?: [string, string][];
  isRadio?: boolean; isAp?: boolean;
}

const PAIR_STEPS: [string, string][] = [
  ['Abra o painel do equipamento', 'https://piu-node.local:8420 · confira a impressão digital do certificado'],
  ['Entre com o código do equipamento', '8 dígitos no console do nó · vale 10 min'],
  ['Configurações → Parear celular', 'o painel mostra um QR que vale 10 min'],
];

export const PROV_FAMILIES: ProvFamily[] = [
  { id: 'router', icon: 'router', name: 'Roteador com OpenWrt', cls: 'Home Node', badge: 'Beta', desc: 'OpenWrt 24.10 com Node.js · fica ligado 24 h', short: 'roteador',
    steps: [['Instale o pacote', 'opkg install ./piu-node_0.1.0-1_all.ipk'], ['Inicie o serviço', '/etc/init.d/piu-node enable && /etc/init.d/piu-node start'], ...PAIR_STEPS] },
  { id: 'linux', icon: 'computer', name: 'Computador Linux ou Raspberry Pi', cls: 'Home Node · Gateway', badge: 'Beta', desc: 'Node.js 20.19 ou mais novo', short: 'computador',
    steps: [['Instale e compile', 'cd apps/piu-node && npm ci && npm run build'], ['Inicie o nó', 'npm start'], ...PAIR_STEPS] },
  { id: 'lora', icon: 'settings_input_antenna', name: 'Rádio LoRa via USB', cls: 'Super Node', badge: 'Beta', desc: '915 MHz · firmware de modem KISS · só rádios homologados pela Anatel', short: 'rádio', isRadio: true,
    steps: [['Ligue o rádio num nó seu', 'porta USB de um Home Node ou Gateway Local'], ['Aponte a porta serial', 'PIU_SERIAL=lora:/dev/ttyUSB0@115200'], ...PAIR_STEPS] },
  { id: 'ap', icon: 'wifi', name: 'Roteador comum ou repetidor', cls: 'Ponto de Acesso', badge: 'Sem instalação', desc: 'Manda e recebe ao vivo. Guardar e comprovar fica com o nó pai.', short: 'roteador comum', isAp: true,
    steps: [['Desative o isolamento de clientes', 'às vezes chamado “AP isolation”'], ['Permita multicast e mDNS', 'para os aparelhos se encontrarem'], ['Ligue a um nó seu', 'por cabo ou repetição sem fio']] },
  { id: 'ptp', icon: 'cell_tower', name: 'Enlace de rádio ponto a ponto', cls: 'Super Node', badge: 'Em avaliação', desc: 'Liga bairros distantes · ainda em testes de homologação', disabled: true },
];

export const PROV_CLASSES: { icon: IconName; name: string; what: string; desc: string; ex: string }[] = [
  { icon: 'router', name: 'Home Node', what: 'Roteador ou computador ligado em casa', desc: 'Guarda e entrega mensagens 24 h para a vizinhança.', ex: 'OpenWrt · Linux · Raspberry Pi' },
  { icon: 'settings_input_antenna', name: 'Super Node', what: 'Antena ou rádio de maior alcance', desc: 'Liga áreas distantes. Precisa de validação de alcance.', ex: 'LoRa 915 MHz · enlaces de rádio' },
  { icon: 'dns', name: 'Gateway Local', what: 'Mini-PC ou adaptador', desc: 'Traduz entre tecnologias. Não precisa de internet.', ex: 'Wi-Fi + LoRa + USB + Ethernet' },
];

/** Nomes `piu.*` reservados (usados pelo protótipo do painel); a checagem real é feita pelo piu-node. */
export const TAKEN_PUB: string[] = [];
