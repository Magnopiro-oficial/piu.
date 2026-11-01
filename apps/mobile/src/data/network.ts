// Rede, diagnóstico e provider no celular (design/PiuApp.dc.html). Valores ilustrativos.
import type { IconName } from '../ui/Icon';

export type TxKey = 'ble' | 'direct' | 'mesh' | 'lora' | 'eth';

export const TRANSPORTS: [TxKey, IconName, string, string, string?][] = [
  ['ble', 'bluetooth', 'Bluetooth LE', 'Descoberta e texto curto · 4 vizinhos'],
  ['direct', 'wifi_tethering', 'Wi-Fi Direct', 'Aparelho a aparelho, sem roteador'],
  ['mesh', 'hub', 'Wi-Fi Mesh', 'Arquivos e mídia · 1 roteador OpenWrt'],
  ['lora', 'settings_input_antenna', 'Rádio LoRa', 'Alertas e texto · conecte um adaptador', 'Adaptador USB · Torre Serra a 4,2 km'],
  ['eth', 'cable', 'USB / Ethernet local', 'Gateway local, sem internet'],
];

export interface Neighbor { name: string; cls: string; via: string; dist: string; icon: IconName; t: TxKey; x: number; y: number; big?: boolean; spoof?: boolean }

/** Nós por perto. x/y em % do radar. Nomes `piu.*` sem assinatura aparecem como imitação. */
export const NEIGHBORS: Neighbor[] = [
  { name: 'Pixel 7a · 9C21', cls: 'Mobile Node', via: 'BLE', dist: '~8 m', icon: 'smartphone', t: 'ble', x: 64, y: 36 },
  { name: 'iPhone · 51BD', cls: 'Mobile Node', via: 'BLE', dist: '~15 m', icon: 'smartphone', t: 'ble', x: 33, y: 62 },
  { name: 'Galaxy · E07A', cls: 'Mobile Node', via: 'Wi-Fi Direct', dist: '~22 m', icon: 'smartphone', t: 'direct', x: 30, y: 28 },
  { name: 'Galpão · OpenWrt', cls: 'Home Node · piu.galpao', via: 'Wi-Fi Mesh', dist: '~40 m', icon: 'router', t: 'mesh', x: 78, y: 70, big: true },
  { name: 'Gateway Praça', cls: 'Gateway Local · piu.praca', via: 'Wi-Fi Direct', dist: '~60 m', icon: 'dns', t: 'direct', x: 14, y: 82, big: true },
  { name: 'Torre Serra · 3A0F', cls: 'Super Node · piu.torre-serra', via: 'LoRa', dist: '4,2 km', icon: 'settings_input_antenna', t: 'lora', x: 90, y: 16, big: true },
  { name: 'piu.praca · imitação', cls: 'sem assinatura válida · ignorado', via: 'Wi-Fi', dist: '—', icon: 'gpp_bad', t: 'mesh', x: 52, y: 88, spoof: true },
];

/** Diagnóstico local (NFR-008): calculado no aparelho, nada sai dele. */
export const DIAG = {
  kpis: [['Taxa de entrega', '96,4%', '1.874 de 1.944', true], ['Latência mediana', '1,8 s', 'p95: 14 s', false], ['Tempo médio na fila', '6 min', 'máx.: 3 h 10 min', false], ['Expiradas', '1,2%', '23 mensagens', false]] as [string, string, string, boolean][],
  tx: [['bluetooth', 'Bluetooth LE', 98, '0,4 s'], ['wifi_tethering', 'Wi-Fi Direct', 97, '0,2 s'], ['hub', 'Wi-Fi Mesh', 96, '0,6 s'], ['settings_input_antenna', 'LoRa 915 MHz', 89, '6,1 s']] as [IconName, string, number, string][],
  hops: [['1 salto', 99], ['2', 97], ['3', 92], ['4+', 81]] as [string, number][],
  node: [['Pacotes retransmitidos hoje', '342'], ['Bateria usada como nó', '3,1%'], ['Armazenamento de terceiros', '61 MB'], ['Rotas alternativas usadas', '14']] as [string, string][],
};

// ── provider ─────────────────────────────────────────────
export type DevStatus = 'active' | 'paused' | 'warming';
export interface ProvDevice {
  id: string; pub: string; name: string; model: string; cls: string; icon: IconName; status: DevStatus;
  pph: string; today: number; month: number; nb: number;
  ifaces: [string, string, number][]; sto: [number, number] | null; queue: string; receipts: [string, string, string, string][];
  passive?: boolean; parent?: string; fresh?: boolean;
}

export function seedProvDevices(): ProvDevice[] {
  return [
    { id: 'minipc0', pub: 'piu.vila-esperanca', name: 'Mini-PC da garagem', model: 'Intel N100 · Debian 12 · Piu Node 0.4.2', cls: 'Gateway Local', icon: 'dns', status: 'active', pph: '1.280', today: 6.6, month: 105.92, nb: 14,
      ifaces: [['Ethernet', '2 gateways ligados', 34], ['Wi-Fi 6 · malha', '41 de 120 Mbps', 34], ['USB · LoRa 915 MHz', '62% do ciclo permitido', 62]], sto: [3.1, 8], queue: '4.820',
      receipts: [['14:31', 'texto', '2 saltos', 'confirmado'], ['14:31', 'alerta LoRa', '3 saltos', 'confirmado'], ['14:30', 'arquivo 1,2 MB', '1 salto', 'confirmado'], ['14:30', 'texto', '—', 'duplicata'], ['14:29', 'recibo de grupo', '2 saltos', 'confirmado']] },
    { id: 'antena0', pub: 'piu.serra-norte', name: 'Antena do telhado', model: 'LoRa 915 MHz · antena 5 dBi · Raspberry Pi 4', cls: 'Super Node', icon: 'settings_input_antenna', status: 'active', pph: '420', today: 5.8, month: 78.4, nb: 9,
      ifaces: [['LoRa 915 MHz', 'alcance medido 4,1 km', 48], ['Wi-Fi 2,4 GHz', '3 celulares', 12]], sto: [0.4, 2], queue: '312',
      receipts: [['14:31', 'alerta Defesa Civil', '3 saltos', 'confirmado'], ['14:28', 'texto', '4 saltos', 'confirmado'], ['14:26', 'texto', '—', 'rota circular']] },
  ];
}

export type ClassKey = 'home' | 'super' | 'gateway';
export interface ProvFamily {
  id: string; icon: IconName; name: string; cls: string; badge: string; desc: string; disabled?: boolean;
  short?: string; pkg?: string; cmd?: string; found?: string; addr?: string; where?: string; hw?: string; ifs?: string;
  result?: string; classes?: ClassKey[]; defName?: string; bw?: string; lat?: string; nb?: string; model?: string;
  install?: boolean; isRadio?: boolean; isAp?: boolean;
  /** [nome, descrição, ligado por padrão, travado] */
  ifaces?: [string, string, boolean, boolean?][];
}

export const PROV_FAMILIES: ProvFamily[] = [
  { id: 'router', icon: 'router', name: 'Roteador com OpenWrt', cls: 'Home Node', badge: 'Beta', desc: 'Wi-Fi Mesh 802.11s · fica ligado 24 h', short: 'roteador', pkg: 'piu-node_0.4.2_aarch64.ipk', cmd: 'opkg install ./piu-node_0.4.2_aarch64.ipk',
    found: 'GL-MT3000 · OpenWrt 23.05.3', addr: '192.168.8.1 · Wi-Fi Piu-Sala', where: 'no painel do roteador', hw: 'ARM64 MT7981 · 512 MB RAM · 7,6 GB livres', ifs: 'Wi-Fi 6 2,4/5 GHz (802.11s) · Ethernet ×3 · USB 3.0',
    result: 'Home Node + Gateway Local', classes: ['home', 'gateway'], defName: 'Roteador da sala', bw: '38 Mbps', lat: '12 ms', nb: '6', model: 'GL-MT3000 · OpenWrt 23.05 · Piu Node 0.4.2', install: true,
    ifaces: [['Wi-Fi Mesh 5 GHz', '802.11s · entre roteadores', true], ['Wi-Fi 2,4 GHz', 'acesso para celulares', true], ['Ethernet', '3 portas · gateways locais', true], ['USB', 'nenhum rádio conectado', false, true]] },
  { id: 'linux', icon: 'computer', name: 'Computador Linux ou Raspberry Pi', cls: 'Home Node · Gateway', badge: 'Estável', desc: 'Pacote .deb ou imagem pronta para cartão SD', short: 'computador', pkg: 'piu-node_0.4.2_arm64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_arm64.deb',
    found: 'Raspberry Pi 4 · Raspberry Pi OS 12', addr: 'raspberrypi.local · 192.168.0.42', where: 'no terminal', hw: 'ARM64 · 4 GB RAM · 22 GB livres', ifs: 'Wi-Fi 5 GHz · Bluetooth LE · Ethernet',
    result: 'Home Node', classes: ['home'], defName: 'Raspberry do escritório', bw: '26 Mbps', lat: '15 ms', nb: '5', model: 'Raspberry Pi 4 · Debian 12 · Piu Node 0.4.2', install: true,
    ifaces: [['Wi-Fi', 'malha e celulares', true], ['Bluetooth LE', 'descoberta de celulares', true], ['Ethernet', '1 porta', true]] },
  { id: 'minipc', icon: 'dns', name: 'Mini-PC com adaptadores', cls: 'Gateway Local', badge: 'Estável', desc: 'Liga Wi-Fi, LoRa, USB e Ethernet entre si', short: 'mini-PC', pkg: 'piu-node_0.4.2_amd64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_amd64.deb',
    found: 'mini-n100 · Debian 12', addr: 'mini-n100.local · 192.168.0.10', where: 'no terminal', hw: 'x86-64 N100 · 8 GB RAM · 180 GB livres', ifs: 'Ethernet ×2 · Wi-Fi 6 · USB ×4 · rádio LoRa detectado',
    result: 'Gateway Local + Home Node', classes: ['gateway', 'home'], defName: 'Mini-PC da sala', bw: '240 Mbps', lat: '4 ms', nb: '9', model: 'Intel N100 · Debian 12 · Piu Node 0.4.2', install: true,
    ifaces: [['Ethernet', '2 portas', true], ['Wi-Fi 6', 'malha', true], ['USB · LoRa 915 MHz', 'rádio detectado', true]] },
  { id: 'lora', icon: 'settings_input_antenna', name: 'Rádio LoRa via USB', cls: 'Super Node', badge: 'Beta', desc: '915 MHz · só rádios homologados pela Anatel', short: 'rádio', pkg: 'adapter-lora_0.2.0', cmd: '',
    found: 'Rádio LoRa USB · SX1262', addr: 'ttyACM0 · no Mini-PC da garagem', where: 'no Mini-PC da garagem', hw: 'SX1262 · 915 MHz · homologação Anatel conferida', ifs: 'LoRa 915 MHz · antena externa 5 dBi',
    result: 'Super Node · 4,1 km medidos', classes: ['super'], defName: 'Rádio LoRa da janela', bw: '5,5 kbps', lat: '1,2 s', nb: '4', model: 'LoRa 915 MHz · USB · adapter 0.2.0', install: false, isRadio: true,
    ifaces: [['LoRa 915 MHz', 'potência dentro do limite da Anatel', true], ['Só texto e alertas', 'mídia é recusada neste enlace', true, true]] },
  { id: 'ap', icon: 'wifi', name: 'Roteador comum ou repetidor', cls: 'Ponto de Acesso', badge: 'Sem instalação', desc: 'Manda e recebe ao vivo. Guardar e comprovar fica com o nó pai.', short: 'roteador comum', pkg: '', cmd: '',
    found: 'TP-Link RE200 · repetidor', addr: 'visto pelo Mini-PC da garagem · −58 dBm', where: '', hw: '', ifs: '', result: 'Ponto de Acesso', classes: [], defName: 'Repetidor da varanda', bw: '~25 m', lat: '9 ms', nb: '6',
    model: 'Repetidor comum · firmware original', install: false, isAp: true, ifaces: [['Wi-Fi 2,4 GHz', 'para celulares', true, true], ['Ligação ao nó pai', 'repetição sem fio', true, true]] },
  { id: 'ptp', icon: 'cell_tower', name: 'Enlace de rádio ponto a ponto', cls: 'Super Node', badge: 'Em avaliação', desc: 'Liga bairros distantes · ainda em testes de homologação', disabled: true },
];

export const PROV_CLASSES: { icon: IconName; name: string; what: string; desc: string; ex: string }[] = [
  { icon: 'router', name: 'Home Node', what: 'Roteador ou computador ligado em casa', desc: 'Guarda e entrega mensagens 24 h para a vizinhança.', ex: 'OpenWrt · Linux · Raspberry Pi' },
  { icon: 'settings_input_antenna', name: 'Super Node', what: 'Antena ou rádio de maior alcance', desc: 'Liga áreas distantes. Precisa de validação de alcance.', ex: 'LoRa 915 MHz · enlaces de rádio' },
  { icon: 'dns', name: 'Gateway Local', what: 'Mini-PC ou adaptador', desc: 'Traduz entre tecnologias. Não precisa de internet.', ex: 'Wi-Fi + LoRa + USB + Ethernet' },
];

export const CLASS_CHIPS: [ClassKey, IconName, string][] = [['home', 'router', 'Home Node'], ['super', 'settings_input_antenna', 'Super Node'], ['gateway', 'dns', 'Gateway Local']];

export const PAIR_CODE = ['4', '8', '2', '9', '1', '7'];
export const PROV_DAILY = [8.1, 9.4, 10.2, 7.6, 11.8, 12.9, 10.4, 13.6, 14.1, 11.2, 12.8, 15.3, 13.9];
export const PROV_PENDING = 21.6;
export const PROV_REJECTED = 3.08;
export const PROV_PAID = 1284.6;

export const PROV_RATES: [IconName, string, string, string, string][] = [
  ['chat_bubble', 'Texto entregue', '1 crédito por entrega', '12.840 entregas', '128,40'],
  ['campaign', 'Alerta via rádio', '3 créditos por entrega', '640 entregas', '19,20'],
  ['description', 'Arquivo ou mídia', '2 créditos por MB', '1,4 GB', '28,67'],
  ['alt_route', 'Rota nova entre áreas', '10 créditos por rota', '8 rotas', '0,80'],
];

export const PROV_WALLETS = {
  new: { addr: 'lunes:9Hk2…pW4a · nova', note: 'Recomendado. Ganhos de infraestrutura ficam separados da sua identidade de conversa e da carteira pessoal.' },
  personal: { addr: 'lunes:3P8x…Q7nM · pessoal', note: 'Mais simples, porém menos privado: ganhos e gastos pessoais ficam no mesmo endereço.' },
};

/** Nomes `piu.*` já usados por outros nós da malha local. */
export const TAKEN_PUB = ['vila-esperanca', 'vila-esperanca-2', 'vila-esperanca-3', 'serra-norte', 'galpao', 'praca', 'escola', 'torre-serra'];
