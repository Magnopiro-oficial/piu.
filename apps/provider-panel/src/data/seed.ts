// Dados de exemplo do protótipo (ilustrativos). Quando o daemon piu-node expuser
// a API local, estes valores passam a vir de lá; o formato acompanha o modelo
// conceitual (RelayNode, RelayReceipt, RewardSettlement).
// Os textos saem do dicionário (idioma do painel): por isso a maioria são funções, não constantes.
import { t } from '../i18n';
import { fmt } from '../lib/format';
import type { DeviceFamily, Iface, NodeClass, Receipt, RelayNode, WalletTx } from '../types';

const ifs = (rows: [string, string, number][]): Iface[] => rows.map(([name, detail, load]) => ({ name, detail, load }));
const rcpts = (rows: [string, string, string, string][]): Receipt[] => rows.map(([time, kind, hops, state]) => ({ time, kind, hops, state }));

export const NODE = { host: 'piu-node.local:8420', get label() { return t('seed.nodeLabel'); } };
export const OPERATOR = { name: 'Cardeal', initial: 'C', fingerprint: ['A41F', '0C9E', '77B2', 'D3A0', '18EF', '5C64', '9B0D', 'E2C7'] };
/** `monthSlug` é fixo (nomes de arquivo); `month`/`today`/… seguem o idioma. */
export const PERIOD = {
  monthSlug: 'outubro', lot: '#0047',
  get month() { return t('seed.month'); }, get today() { return t('seed.today'); }, get closes() { return t('seed.closes'); }, get lastSync() { return t('seed.lastSync'); },
};
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
export const PAID_TOTAL = 1284.6;

const hops = (n: number) => t('seed.rc.hops', { count: n });

export function seedDevices(): RelayNode[] {
  return [
    { id: 'mini', name: t('seed.dev.mini'), cls: 'Gateway Local', short: 'Intel N100', pub: 'piu.vila-esperanca', model: t('seed.dev.miniModel'), icon: 'dns', status: 'active', pph: 1280, today: 6.6, month: 138.37, neighbors: 14, storage: [3.1, 8], uptime: '12 d',
      ifaces: ifs([['Ethernet', t('seed.if.gateways'), 34], [t('seed.if.wifi6'), t('seed.if.mbps', { a: 41, b: 120 }), 34], [t('seed.if.lora'), t('seed.if.duty'), 62]]),
      receipts: rcpts([['14:31', t('seed.rc.text'), hops(2), t('seed.rc.confirmed')], ['14:31', t('seed.rc.loraAlert'), hops(3), t('seed.rc.confirmed')], ['14:30', t('seed.rc.file'), hops(1), t('seed.rc.confirmed')], ['14:30', t('seed.rc.text'), '—', t('seed.rc.duplicate')]]) },
    { id: 'antena', name: t('seed.dev.antena'), cls: 'Super Node', short: 'LoRa 915 MHz', pub: 'piu.serra-norte', model: t('seed.dev.antenaModel'), icon: 'settings_input_antenna', status: 'active', pph: 420, today: 5.8, month: 103.04, neighbors: 9, storage: [0.4, 2], uptime: '31 d',
      ifaces: ifs([['LoRa 915 MHz', t('seed.if.range'), 48], ['Wi-Fi 2,4 GHz', t('seed.if.phones', { count: 3 }), 12]]),
      receipts: rcpts([['14:31', t('seed.rc.communityAlert'), hops(3), t('seed.rc.confirmed')], ['14:28', t('seed.rc.text'), hops(4), t('seed.rc.confirmed')], ['14:26', t('seed.rc.text'), '—', t('seed.rc.circular')]]) },
    { id: 'router', name: t('seed.dev.router'), cls: 'Home Node', short: 'GL-MT3000', pub: 'piu.vila-esperanca-2', model: t('seed.dev.routerModel'), icon: 'router', status: 'active', pph: 610, today: 2.9, month: 52.99, neighbors: 11, storage: [1.2, 4], uptime: '6 d',
      ifaces: ifs([['Wi-Fi Mesh 5 GHz', t('seed.if.mbps', { a: 18, b: 40 }), 45], ['Wi-Fi 2,4 GHz', t('seed.if.phones', { count: 11 }), 28], ['Ethernet', t('seed.dev.mini'), 22]]),
      receipts: rcpts([['14:32', t('seed.rc.text'), hops(1), t('seed.rc.confirmed')], ['14:31', t('seed.rc.group'), hops(2), t('seed.rc.confirmed')], ['14:29', t('seed.rc.photo'), hops(1), t('seed.rc.confirmed')]]) },
    { id: 'rep', name: t('seed.dev.rep'), cls: 'Ponto de Acesso', short: t('seed.dev.repShort'), pub: 'piu.vila-esperanca-3', model: t('seed.dev.repModel'), icon: 'wifi', status: 'active', pph: 0, today: 0, month: 0, neighbors: 6, storage: null, uptime: '9 d', passive: true, parent: 'mini',
      ifaces: ifs([['Wi-Fi 2,4 GHz', t('seed.if.phonesConnected'), 30], [t('seed.if.linkMini'), t('seed.if.repeat'), 70]]), receipts: [] },
  ];
}

export function seedTxs(): WalletTx[] {
  return [
    { id: 't46', icon: 'call_received', title: t('seed.tx.lot', { lot: '#0046' }), date: t('seed.tx.oct1'), status: 'tx 7c1e…a90f', value: '+' + fmt(512.08) },
    { id: 't-p', icon: 'call_made', title: t('live.toPersonal'), date: t('seed.tx.sep5'), status: 'tx 4a90…c21e', value: '−' + fmt(400) },
    { id: 't45', icon: 'call_received', title: t('seed.tx.lot', { lot: '#0045' }), date: t('seed.tx.sep1'), status: 'tx 21bd…04c3', value: '+' + fmt(448.44) },
    { id: 't44', icon: 'call_received', title: t('seed.tx.lot', { lot: '#0044' }), date: t('seed.tx.aug1'), status: 'tx e09a…7b11', value: '+' + fmt(324.08) },
  ];
}

export function families(): DeviceFamily[] {
  const waiting = t('seed.if.waiting');
  return [
    { id: 'router', icon: 'router', name: t('seed.fam.router'), cls: 'Home Node', badge: t('seed.badge.beta'), desc: t('seed.fam.routerDesc'), pkg: 'piu-node_0.4.2_aarch64.ipk', cmd: 'opkg install ./piu-node_0.4.2_aarch64.ipk', install: true,
      found: t('seed.fam.routerFound'), addr: t('seed.fam.routerAddr'), where: t('seed.fam.routerWhere'), hw: t('seed.fam.routerHw'), ifs: 'Wi-Fi 2,4/5 GHz (802.11s) · Ethernet ×4 · USB 2.0',
      result: 'Home Node', bw: '22 Mbps', lat: '14 ms', nb: '7', model: 'Archer C7 · OpenWrt 23.05 · Piu Node 0.4.2', short: 'Archer C7', defName: t('seed.fam.routerName'), defPub: 'vila-esperanca-4',
      ifaces: ifs([['Wi-Fi Mesh 5 GHz', waiting, 3], ['Wi-Fi 2,4 GHz', waiting, 3]]) },
    { id: 'linux', icon: 'computer', name: t('seed.fam.linux'), cls: 'Home Node · Gateway', badge: t('seed.badge.stable'), desc: t('seed.fam.linuxDesc'), pkg: 'piu-node_0.4.2_arm64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_arm64.deb', install: true,
      found: 'Raspberry Pi 5 · Raspberry Pi OS 12', addr: 'raspberrypi.local · 192.168.0.42', where: t('seed.fam.linuxWhere'), hw: t('seed.fam.linuxHw'), ifs: 'Wi-Fi 5 GHz · Bluetooth LE · Ethernet',
      result: 'Home Node', bw: '31 Mbps', lat: '11 ms', nb: '6', model: 'Raspberry Pi 5 · Debian 12 · Piu Node 0.4.2', short: 'Raspberry Pi 5', defName: t('seed.fam.linuxName'), defPub: 'vila-esperanca-4',
      ifaces: ifs([['Wi-Fi', waiting, 3], ['Bluetooth LE', waiting, 3], ['Ethernet', waiting, 3]]) },
    { id: 'minipc', icon: 'dns', name: t('seed.fam.minipc'), cls: 'Gateway Local', badge: t('seed.badge.stable'), desc: t('seed.fam.minipcDesc'), pkg: 'piu-node_0.4.2_amd64.deb', cmd: 'sudo apt install ./piu-node_0.4.2_amd64.deb', install: true,
      found: 'mini-n95 · Debian 12', addr: 'mini-n95.local · 192.168.0.12', where: t('seed.fam.linuxWhere'), hw: t('seed.fam.minipcHw'), ifs: 'Ethernet ×2 · Wi-Fi 6 · USB ×4',
      result: 'Gateway Local', bw: '210 Mbps', lat: '5 ms', nb: '8', model: 'Intel N95 · Debian 12 · Piu Node 0.4.2', short: 'Intel N95', defName: t('seed.fam.minipcName'), defPub: 'vila-esperanca-4',
      ifaces: ifs([['Ethernet', waiting, 3], ['Wi-Fi 6', waiting, 3]]) },
    { id: 'lora', icon: 'settings_input_antenna', name: t('seed.fam.lora'), cls: 'Super Node', badge: t('seed.badge.beta'), desc: t('seed.fam.loraDesc'), pkg: 'adapter-lora_0.2.0', cmd: '', install: false, isRadio: true,
      found: t('seed.fam.loraFound'), addr: t('seed.fam.loraAddr'), where: t('seed.fam.loraWhere'), hw: t('seed.fam.loraHw'), ifs: t('seed.fam.loraIfs'),
      result: 'Super Node', bw: '5,5 kbps', lat: '1,1 s', nb: '5', model: 'LoRa 915 MHz · USB · adapter 0.2.0', short: 'LoRa 915 MHz', defName: t('seed.fam.loraName'), defPub: 'serra-sul',
      ifaces: ifs([['LoRa 915 MHz', waiting, 3]]) },
    { id: 'ap', icon: 'wifi', name: t('seed.fam.ap'), cls: 'Ponto de Acesso', badge: t('seed.badge.noInstall'), desc: t('seed.fam.apDesc'), install: false, isAp: true, pkg: '',
      found: t('seed.fam.apFound'), addr: t('seed.fam.apAddr'), where: '', hw: '', ifs: '', result: 'Ponto de Acesso', bw: '~25 m', lat: '9 ms', nb: '6',
      model: t('seed.fam.apModel'), short: t('seed.dev.repShort'), defName: t('seed.fam.apName'), defPub: 'vila-esperanca-4',
      ifaces: ifs([['Wi-Fi 2,4 GHz', t('seed.if.waitingPhones'), 3], [t('seed.if.linkParent'), t('seed.if.repeatWireless'), 60]]) },
    { id: 'ptp', icon: 'cell_tower', name: t('seed.fam.ptp'), cls: 'Super Node', badge: t('seed.badge.evaluating'), desc: t('seed.fam.ptpDesc'), disabled: true },
  ];
}

/** Ganhos diários de outubro (o último valor é substituído pelo total de hoje). */
export const DAILY = [3.8, 4.2, 5.1, 5.8, 4.9, 6.3, 6.9, 7.4, 6.1, 7.8, 8.2, 7.1, 8.9, 9.4, 8.7, 9.9, 10.6, 9.2, 10.8, 11.4, 10.1, 11.9, 12.6, 11.3, 12.8, 13.4, 12.2, 13.9, 14.6, 13.8];

/** [ícone, rótulo, valor já formatado, detalhe] */
export const kpis = (fmtInt: (n: number) => string): [string, string, string, string][] => [
  ['swap_vert', t('seed.kpi.packets'), fmtInt(24880), t('seed.kpi.packetsD')],
  ['done_all', t('seed.kpi.confirmed'), '97,8%', t('seed.kpi.confirmedD')],
  ['content_copy', t('seed.kpi.dupes'), '412', t('seed.kpi.dupesD')],
  ['hub', t('seed.kpi.neighbors'), '27', t('seed.kpi.neighborsD')],
];

export const feed = (): [string, string, string, string][] => [
  ['system_update_alt', t('seed.feed.update'), t('seed.feed.updateD'), t('seed.feed.updateT')],
  ['settings_input_antenna', t('seed.feed.duty'), t('seed.feed.dutyD'), t('seed.feed.dutyT')],
  ['verified', t('seed.feed.range'), t('seed.feed.rangeD'), t('seed.feed.rangeT')],
  ['content_copy', t('seed.feed.dupes'), t('seed.feed.dupesD'), t('seed.feed.dupesT')],
  ['check_circle', t('seed.feed.lot'), t('seed.feed.lotD'), t('seed.tx.oct1')],
];

export const transports = (): [string, string, string][] => [
  ['hub', 'Wi-Fi Mesh', '58%'], ['cable', 'Ethernet / USB', '19%'], ['wifi_tethering', t('seed.tr.direct'), '12%'],
  ['settings_input_antenna', 'LoRa 915 MHz', '7%'], ['bluetooth', 'Bluetooth LE', '4%'],
];

export interface Rate { icon: string; title: string; rule: string; volume: string; lunes: number }
export const rates = (): Rate[] => [
  { icon: 'chat_bubble', title: t('seed.rate.text'), rule: t('seed.rate.textRule'), volume: t('seed.rate.textVol'), lunes: 184.2 },
  { icon: 'campaign', title: t('seed.rate.alert'), rule: t('seed.rate.alertRule'), volume: t('seed.rate.alertVol'), lunes: 33.6 },
  { icon: 'description', title: t('seed.rate.file'), rule: t('seed.rate.fileRule'), volume: t('seed.rate.fileVol'), lunes: 73.7 },
  { icon: 'alt_route', title: t('seed.rate.route'), rule: t('seed.rate.routeRule'), volume: t('seed.rate.routeVol'), lunes: 2.9 },
];

export interface Lot { id: string; period: string; deliveries: string; value: number | null; state: string; icon: string; done: boolean; tx: string }
/** value null = em formação (soma dos equipamentos no mês). */
export const lots = (fmtInt: (n: number) => string): Lot[] => [
  { id: '#0047', period: t('seed.month'), deliveries: t('seed.lot.deliveries', { n: fmtInt(20598) }), value: null, state: t('seed.lot.forming'), icon: 'hourglass_top', done: false, tx: t('seed.lot.awaiting') },
  { id: '#0046', period: t('seed.lot.september'), deliveries: t('seed.lot.deliveries', { n: fmtInt(36120) }), value: 512.08, state: t('seed.lot.settled'), icon: 'check_circle', done: true, tx: 'tx 7c1e…a90f' },
  { id: '#0045', period: t('seed.lot.august'), deliveries: t('seed.lot.deliveries', { n: fmtInt(31904) }), value: 448.44, state: t('seed.lot.settled'), icon: 'check_circle', done: true, tx: 'tx 21bd…04c3' },
  { id: '#0044', period: t('seed.lot.july'), deliveries: t('seed.lot.deliveries', { n: fmtInt(22871) }), value: 324.08, state: t('seed.lot.settled'), icon: 'check_circle', done: true, tx: 'tx e09a…7b11' },
];

export interface Peer { icon: string; name: string; cls: string; via: string; quality: string }
export const peers = (): Peer[] => [
  { icon: 'router', name: 'piu.galpao', cls: 'Home Node', via: 'Wi-Fi Mesh', quality: '98%' },
  { icon: 'dns', name: 'piu.praca', cls: 'Gateway Local', via: 'Wi-Fi Mesh', quality: '91%' },
  { icon: 'router', name: 'piu.escola', cls: 'Home Node', via: 'Wi-Fi Mesh', quality: '84%' },
  { icon: 'settings_input_antenna', name: 'piu.torre-serra', cls: 'Super Node', via: 'LoRa', quality: '76%' },
  { icon: 'settings_input_antenna', name: 'Super Node Vale', cls: 'Super Node', via: 'LoRa', quality: '61%' },
  { icon: 'smartphone', name: t('seed.peer.phones'), cls: t('seed.peer.mobile'), via: t('seed.peer.bleWifi'), quality: '—' },
  { icon: 'gpp_bad', name: t('seed.peer.fake'), cls: t('seed.peer.noSig'), via: 'Wi-Fi', quality: t('seed.peer.blocked') },
];

/** Nomes já anunciados por outros nós da malha local. */
export const TAKEN_NAMES = ['vila-esperanca', 'vila-esperanca-2', 'vila-esperanca-3', 'serra-norte', 'galpao', 'praca', 'escola', 'torre-serra'];

export const sessions = (): [string, string, string, string][] => [
  ['computer', t('seed.sess.thisComputer'), t('seed.sess.browser'), t('common.now')],
  ['smartphone', t('seed.sess.phone'), t('seed.sess.phoneD'), t('seed.sess.paired')],
];

export const pubRules = () => [
  { icon: 'badge', title: t('seed.rule.signed'), desc: t('seed.rule.signedD') },
  { icon: 'gpp_bad', title: t('seed.rule.fake'), desc: t('seed.rule.fakeD') },
  { icon: 'shield_person', title: t('seed.rule.personal'), desc: t('seed.rule.personalD') },
];

export const CLASS_ICON: Record<NodeClass, string> = { 'Home Node': 'router', 'Super Node': 'settings_input_antenna', 'Gateway Local': 'dns', 'Ponto de Acesso': 'wifi' };
