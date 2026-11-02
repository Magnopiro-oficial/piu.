// Dados de exemplo do protótipo (ilustrativos). Quando o daemon piu-node expuser
// a API local, estes valores passam a vir de lá; o formato acompanha o modelo
// conceitual (RelayNode, RelayReceipt, RewardSettlement).
import type { DeviceFamily, Iface, NodeClass, Receipt, RelayNode, WalletTx } from '../types';

const ifs = (rows: [string, string, number][]): Iface[] => rows.map(([name, detail, load]) => ({ name, detail, load }));
const rcpts = (rows: [string, string, string, string][]): Receipt[] => rows.map(([time, kind, hops, state]) => ({ time, kind, hops, state }));

export const NODE = { host: 'piu-node.local:8420', label: 'painel local do Mini-PC da garagem' };
export const OPERATOR = { name: 'Cardeal', initial: 'C', fingerprint: ['A41F', '0C9E', '77B2', 'D3A0', '18EF', '5C64', '9B0D', 'E2C7'] };
export const PERIOD = { month: 'outubro', today: 'Sábado, 31 de outubro', lot: '#0047', closes: '1º de novembro', lastSync: '30 out, 18:02' };
export const WALLETS = {
  provider: { short: 'lunes:9Hk2…pW4a', long: 'lunes:9Hk2mVq…r3pW4a' },
  personal: { short: 'lunes:3P8x…Q7nM' },
  other: { short: 'lunes:7Qe1…k9Za' },
};
export const SIGN_CODE = '731 204';
export const PAIR_CODE = ['5', '0', '3', '8', '2', '6'];
export const START_BALANCE = 884.6;
export const PENDING = 25.6;
export const REJECTED = 3.92;
export const PAID_TOTAL = '1.284,60';

export function seedDevices(): RelayNode[] {
  return [
    { id: 'mini', name: 'Mini-PC da garagem', cls: 'Gateway Local', short: 'Intel N100', pub: 'piu.vila-esperanca', model: 'Intel N100 · Debian 12 · Piu Node 0.4.2', icon: 'dns', status: 'active', pph: 1280, today: 6.6, month: 138.37, neighbors: 14, storage: [3.1, 8], uptime: '12 d',
      ifaces: ifs([['Ethernet', '2 gateways ligados', 34], ['Wi-Fi 6 · malha', '41 de 120 Mbps', 34], ['USB · LoRa 915 MHz', '62% do ciclo permitido', 62]]),
      receipts: rcpts([['14:31', 'texto', '2 saltos', 'confirmado'], ['14:31', 'alerta LoRa', '3 saltos', 'confirmado'], ['14:30', 'arquivo 1,2 MB', '1 salto', 'confirmado'], ['14:30', 'texto', '—', 'duplicata']]) },
    { id: 'antena', name: 'Antena do telhado', cls: 'Super Node', short: 'LoRa 915 MHz', pub: 'piu.serra-norte', model: 'LoRa 915 MHz · antena 5 dBi · Raspberry Pi 4', icon: 'settings_input_antenna', status: 'active', pph: 420, today: 5.8, month: 103.04, neighbors: 9, storage: [0.4, 2], uptime: '31 d',
      ifaces: ifs([['LoRa 915 MHz', 'alcance medido 4,1 km', 48], ['Wi-Fi 2,4 GHz', '3 celulares', 12]]),
      receipts: rcpts([['14:31', 'alerta Defesa Civil', '3 saltos', 'confirmado'], ['14:28', 'texto', '4 saltos', 'confirmado'], ['14:26', 'texto', '—', 'rota circular']]) },
    { id: 'router', name: 'Roteador da sala', cls: 'Home Node', short: 'GL-MT3000', pub: 'piu.vila-esperanca-2', model: 'GL-MT3000 · OpenWrt 23.05 · Piu Node 0.4.2', icon: 'router', status: 'active', pph: 610, today: 2.9, month: 52.99, neighbors: 11, storage: [1.2, 4], uptime: '6 d',
      ifaces: ifs([['Wi-Fi Mesh 5 GHz', '18 de 40 Mbps', 45], ['Wi-Fi 2,4 GHz', '11 celulares', 28], ['Ethernet', 'Mini-PC da garagem', 22]]),
      receipts: rcpts([['14:32', 'texto', '1 salto', 'confirmado'], ['14:31', 'recibo de grupo', '2 saltos', 'confirmado'], ['14:29', 'foto 2,4 MB', '1 salto', 'confirmado']]) },
    { id: 'rep', name: 'Repetidor do quintal', cls: 'Ponto de Acesso', short: 'repetidor', pub: 'piu.vila-esperanca-3', model: 'Repetidor comum · firmware original · ligado ao Mini-PC da garagem', icon: 'wifi', status: 'active', pph: 0, today: 0, month: 0, neighbors: 6, storage: null, uptime: '9 d', passive: true, parent: 'mini',
      ifaces: ifs([['Wi-Fi 2,4 GHz', '6 celulares conectados', 30], ['Ligação ao Mini-PC', 'repetição sem fio · −61 dBm', 70]]), receipts: [] },
  ];
}

export function seedTxs(): WalletTx[] {
  return [
    { id: 't46', icon: 'call_received', title: 'Lote #0046 liquidado', date: '1 out', status: 'tx 7c1e…a90f', value: '+512,08' },
    { id: 't-p', icon: 'call_made', title: 'Para carteira pessoal', date: '5 set', status: 'tx 4a90…c21e', value: '−400,00' },
    { id: 't45', icon: 'call_received', title: 'Lote #0045 liquidado', date: '1 set', status: 'tx 21bd…04c3', value: '+448,44' },
    { id: 't44', icon: 'call_received', title: 'Lote #0044 liquidado', date: '1 ago', status: 'tx e09a…7b11', value: '+324,08' },
  ];
}

export const FAMILIES: DeviceFamily[] = [
  { id: 'router', icon: 'router', name: 'Roteador com OpenWrt', cls: 'Home Node', badge: 'Beta', desc: 'Wi-Fi Mesh 802.11s · fica ligado 24 h', pkg: 'piu-node_0.4.2_aarch64.ipk', cmd: 'opkg install ./piu-node_0.4.2_aarch64.ipk', install: true,
    found: 'Archer C7 · OpenWrt 23.05.3', addr: '192.168.0.31 · Wi-Fi Piu-Escritório', where: 'na interface do roteador', hw: 'MIPS QCA9558 · 128 MB RAM · USB para armazenamento', ifs: 'Wi-Fi 2,4/5 GHz (802.11s) · Ethernet ×4 · USB 2.0',
    result: 'Home Node', bw: '22 Mbps', lat: '14 ms', nb: '7', model: 'Archer C7 · OpenWrt 23.05 · Piu Node 0.4.2', short: 'Archer C7', defName: 'Roteador do escritório', defPub: 'vila-esperanca-4',
    ifaces: ifs([['Wi-Fi Mesh 5 GHz', 'aguardando tráfego', 3], ['Wi-Fi 2,4 GHz', 'aguardando tráfego', 3]]) },
  { id: 'linux', icon: 'computer', name: 'Computador Linux ou Raspberry Pi', cls: 'Home Node · Gateway', badge: 'Estável', desc: 'Pacote .deb ou imagem pronta para cartão SD', pkg: 'piu-node_0.4.2_arm64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_arm64.deb', install: true,
    found: 'Raspberry Pi 5 · Raspberry Pi OS 12', addr: 'raspberrypi.local · 192.168.0.42', where: 'no terminal', hw: 'ARM64 · 8 GB RAM · 54 GB livres', ifs: 'Wi-Fi 5 GHz · Bluetooth LE · Ethernet',
    result: 'Home Node', bw: '31 Mbps', lat: '11 ms', nb: '6', model: 'Raspberry Pi 5 · Debian 12 · Piu Node 0.4.2', short: 'Raspberry Pi 5', defName: 'Raspberry do quarto', defPub: 'vila-esperanca-4',
    ifaces: ifs([['Wi-Fi', 'aguardando tráfego', 3], ['Bluetooth LE', 'aguardando tráfego', 3], ['Ethernet', 'aguardando tráfego', 3]]) },
  { id: 'minipc', icon: 'dns', name: 'Mini-PC com adaptadores', cls: 'Gateway Local', badge: 'Estável', desc: 'Liga Wi-Fi, LoRa, USB e Ethernet entre si', pkg: 'piu-node_0.4.2_amd64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_amd64.deb', install: true,
    found: 'mini-n95 · Debian 12', addr: 'mini-n95.local · 192.168.0.12', where: 'no terminal', hw: 'x86-64 N95 · 8 GB RAM · 210 GB livres', ifs: 'Ethernet ×2 · Wi-Fi 6 · USB ×4',
    result: 'Gateway Local', bw: '210 Mbps', lat: '5 ms', nb: '8', model: 'Intel N95 · Debian 12 · Piu Node 0.4.2', short: 'Intel N95', defName: 'Mini-PC da sala', defPub: 'vila-esperanca-4',
    ifaces: ifs([['Ethernet', 'aguardando tráfego', 3], ['Wi-Fi 6', 'aguardando tráfego', 3]]) },
  { id: 'lora', icon: 'settings_input_antenna', name: 'Rádio LoRa via USB', cls: 'Super Node', badge: 'Beta', desc: '915 MHz · só rádios homologados pela Anatel', pkg: 'adapter-lora_0.2.0', cmd: '', install: false, isRadio: true,
    found: 'Rádio LoRa USB · SX1262', addr: 'ttyACM1 · no Mini-PC da garagem', where: 'no painel do Mini-PC', hw: 'SX1262 · 915 MHz · homologação Anatel conferida', ifs: 'LoRa 915 MHz · antena externa 8 dBi',
    result: 'Super Node', bw: '5,5 kbps', lat: '1,1 s', nb: '5', model: 'LoRa 915 MHz · USB · adapter 0.2.0', short: 'LoRa 915 MHz', defName: 'Rádio LoRa da caixa d’água', defPub: 'serra-sul',
    ifaces: ifs([['LoRa 915 MHz', 'aguardando tráfego', 3]]) },
  { id: 'ap', icon: 'wifi', name: 'Roteador comum ou repetidor', cls: 'Ponto de Acesso', badge: 'Sem instalação', desc: 'Manda e recebe ao vivo. Guardar e comprovar fica com o nó pai.', install: false, isAp: true, pkg: '',
    found: 'TP-Link RE200 · repetidor', addr: 'visto pelo Mini-PC da garagem · −58 dBm', where: '', hw: '', ifs: '', result: 'Ponto de Acesso', bw: '~25 m', lat: '9 ms', nb: '6',
    model: 'Repetidor comum · firmware original', short: 'repetidor', defName: 'Repetidor da varanda', defPub: 'vila-esperanca-4',
    ifaces: ifs([['Wi-Fi 2,4 GHz', 'aguardando celulares', 3], ['Ligação ao nó pai', 'repetição sem fio', 60]]) },
  { id: 'ptp', icon: 'cell_tower', name: 'Enlace de rádio ponto a ponto', cls: 'Super Node', badge: 'Em avaliação', desc: 'Liga bairros distantes · em testes de homologação', disabled: true },
];

/** Ganhos diários de outubro (o último valor é substituído pelo total de hoje). */
export const DAILY = [3.8, 4.2, 5.1, 5.8, 4.9, 6.3, 6.9, 7.4, 6.1, 7.8, 8.2, 7.1, 8.9, 9.4, 8.7, 9.9, 10.6, 9.2, 10.8, 11.4, 10.1, 11.9, 12.6, 11.3, 12.8, 13.4, 12.2, 13.9, 14.6, 13.8];

export const KPIS: [string, string, string, string][] = [
  ['swap_vert', 'Pacotes entregues hoje', '24.880', '+8% vs. ontem'],
  ['done_all', 'Confirmados pelo destino', '97,8%', 'meta da rede: 95%'],
  ['content_copy', 'Duplicatas descartadas', '412', 'não geram crédito'],
  ['hub', 'Vizinhos únicos', '27', '5 Home · 2 Super · 1 Gateway'],
];

export const FEED: [string, string, string, string][] = [
  ['system_update_alt', 'Piu Node 0.4.3 disponível', 'Assinada · para 3 equipamentos', '10 min'],
  ['settings_input_antenna', 'Antena perto do limite de ciclo', 'LoRa a 62% do tempo permitido pela Anatel', '32 min'],
  ['verified', 'Alcance revalidado', 'Super Node · 4,1 km por 2 nós', '2 h'],
  ['content_copy', '412 duplicatas descartadas', 'Não geram crédito', '3 h'],
  ['check_circle', 'Lote #0046 liquidado', '512,08 LUNES', '1 out'],
];

export const TRANSPORTS: [string, string, string][] = [
  ['hub', 'Wi-Fi Mesh', '58%'], ['cable', 'Ethernet / USB', '19%'], ['wifi_tethering', 'Wi-Fi Direct (celulares)', '12%'],
  ['settings_input_antenna', 'LoRa 915 MHz', '7%'], ['bluetooth', 'Bluetooth LE', '4%'],
];

export interface Rate { icon: string; title: string; rule: string; volume: string; lunes: number }
export const RATES: Rate[] = [
  { icon: 'chat_bubble', title: 'Texto entregue', rule: '1 crédito / entrega', volume: '18.420 entregas', lunes: 184.2 },
  { icon: 'campaign', title: 'Alerta via rádio', rule: '3 créditos / entrega', volume: '1.120 entregas', lunes: 33.6 },
  { icon: 'description', title: 'Arquivo ou mídia', rule: '2 créditos / MB', volume: '3.685 MB', lunes: 73.7 },
  { icon: 'alt_route', title: 'Rota nova entre áreas', rule: '10 créditos / rota', volume: '29 rotas', lunes: 2.9 },
];

export interface Lot { id: string; period: string; deliveries: string; value: string | null; state: string; icon: string; done: boolean; tx: string }
/** value null = em formação (soma dos equipamentos no mês). */
export const LOTS: Lot[] = [
  { id: '#0047', period: 'outubro', deliveries: '20.598 entregas', value: null, state: 'em formação', icon: 'hourglass_top', done: false, tx: 'aguardando Mainnet' },
  { id: '#0046', period: 'setembro', deliveries: '36.120 entregas', value: '512,08', state: 'liquidado', icon: 'check_circle', done: true, tx: 'tx 7c1e…a90f' },
  { id: '#0045', period: 'agosto', deliveries: '31.904 entregas', value: '448,44', state: 'liquidado', icon: 'check_circle', done: true, tx: 'tx 21bd…04c3' },
  { id: '#0044', period: 'julho', deliveries: '22.871 entregas', value: '324,08', state: 'liquidado', icon: 'check_circle', done: true, tx: 'tx e09a…7b11' },
];

export interface Peer { icon: string; name: string; cls: string; via: string; quality: string }
export const PEERS: Peer[] = [
  { icon: 'router', name: 'piu.galpao', cls: 'Home Node', via: 'Wi-Fi Mesh', quality: '98%' },
  { icon: 'dns', name: 'piu.praca', cls: 'Gateway Local', via: 'Wi-Fi Mesh', quality: '91%' },
  { icon: 'router', name: 'piu.escola', cls: 'Home Node', via: 'Wi-Fi Mesh', quality: '84%' },
  { icon: 'settings_input_antenna', name: 'piu.torre-serra', cls: 'Super Node', via: 'LoRa', quality: '76%' },
  { icon: 'settings_input_antenna', name: 'Super Node Vale', cls: 'Super Node', via: 'LoRa', quality: '61%' },
  { icon: 'smartphone', name: '19 celulares', cls: 'Mobile Nodes', via: 'BLE e Wi-Fi', quality: '—' },
  { icon: 'gpp_bad', name: 'piu.praca · imitação', cls: 'sem assinatura válida', via: 'Wi-Fi', quality: 'bloqueado' },
];

/** Nomes já anunciados por outros nós da malha local. */
export const TAKEN_NAMES = ['vila-esperanca', 'vila-esperanca-2', 'vila-esperanca-3', 'serra-norte', 'galpao', 'praca', 'escola', 'torre-serra'];

export const SESSIONS: [string, string, string, string][] = [
  ['computer', 'Este computador', 'navegador · 192.168.0.24', 'agora'],
  ['smartphone', 'Celular de Cardeal', 'app Piu · aprova transferências', 'pareado'],
];

export const PUB_RULES = [
  { icon: 'badge', title: 'Nome assinado', desc: 'O nome é registrado com a sua chave de operador e anunciado pela malha.' },
  { icon: 'gpp_bad', title: 'Imitações são ignoradas', desc: 'Qualquer um pode criar uma rede chamada “piu.praca”. Sem assinatura válida, o app não troca mensagens com ela e avisa o usuário.' },
  { icon: 'shield_person', title: 'Sem dados pessoais', desc: 'Evite nome, sobrenome ou endereço. Prefira o bairro, um ponto de referência ou um apelido.' },
];

export const CLASS_ICON: Record<NodeClass, string> = { 'Home Node': 'router', 'Super Node': 'settings_input_antenna', 'Gateway Local': 'dns', 'Ponto de Acesso': 'wifi' };
