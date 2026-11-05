/**
 * Dados reais do piu-node no formato do painel: equipamentos, totais do dia e do mês, semanas.
 * Nada aqui inventa número: o que o nó não mede vira `null`/"—" e a tela diz por quê.
 */
import { CLASS_ICON } from '../data/seed';
import { dateFormat, t } from '../i18n';
import type { ApiDay, ApiDevice, ApiHistory, ApiReceipts, ApiRelay, ApiTotals, ApiWalletTx } from './api';
import { fmt, fmtInt } from './format';
import type { Iface, NodeClass, RelayNode, WalletTx } from '../types';

export interface Live { relay: ApiRelay | null; history: ApiHistory | null; receipts: ApiReceipts | null }
export type RelayOn = Extract<ApiRelay, { enabled: true }>;
export type HistoryOn = Extract<ApiHistory, { enabled: true }>;
export type ReceiptsOn = Extract<ApiReceipts, { enabled: true }>;

export const relayOn = (l: Live | null): RelayOn | null => (l?.relay && l.relay.enabled ? l.relay : null);
export const historyOn = (l: Live | null): HistoryOn | null => (l?.history && l.history.enabled ? l.history : null);
export const receiptsOn = (l: Live | null): ReceiptsOn | null => (l?.receipts && l.receipts.enabled ? l.receipts : null);

const KEYS = ['received', 'stored', 'forwarded', 'duplicates', 'rejected', 'relayOff', 'full', 'expired', 'receipts', 'receiptsReceived'] as const;
export const ZERO: ApiTotals = { received: 0, stored: 0, forwarded: 0, duplicates: 0, rejected: 0, relayOff: 0, full: 0, expired: 0, receipts: 0, receiptsReceived: 0 };
function add(a: ApiTotals, b: ApiTotals): ApiTotals {
  const r = { ...a };
  for (const k of KEYS) r[k] = a[k] + b[k];
  return r;
}
export const sum = (days: ApiTotals[]) => days.reduce(add, { ...ZERO });

/** Totais de hoje (o nó já soma o que ainda não virou amostra). */
export function todayTotals(h: HistoryOn | null): ApiTotals { return h?.days.find(d => d.day === h.today) ?? { ...ZERO }; }

/** Dias do mês corrente (do nó), do dia 1 até hoje, com zero onde não houve nada. */
export function monthDays(h: HistoryOn | null): ApiDay[] {
  if (!h) return [];
  const [y, m, d] = h.today.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: d }, (_, i) => {
    const key = `${y}-${pad(m)}-${pad(i + 1)}`;
    return h.days.find(x => x.day === key) ?? { day: key, ...ZERO };
  });
}

/** Encaminhados na última hora (amostras + o que ainda não virou amostra). */
export function lastHour(h: HistoryOn | null, now = Date.now()): number {
  if (!h) return 0;
  return h.samples.filter(s => s.at >= now - 3_600_000).reduce((a, s) => a + s.forwarded, 0) + h.unsampled.forwarded;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Semanas (segunda a domingo), da mais nova para a mais antiga. */
export function weeks(h: HistoryOn | null, n = 8): { start: string; totals: ApiTotals }[] {
  if (!h) return [];
  const map = new Map<string, ApiTotals>();
  for (const d of h.days) {
    const dt = new Date(d.day + 'T12:00:00');
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const k = keyOf(dt);
    map.set(k, add(map.get(k) ?? { ...ZERO }, d));
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, n).map(([start, totals]) => ({ start, totals }));
}

// Datas na região do idioma atual do painel.
const MONTH = () => dateFormat({ month: 'long' });
const DAY = () => dateFormat({ day: 'numeric', month: 'short' });
const FULL = () => dateFormat({ weekday: 'long', day: 'numeric', month: 'long' });
const HM = () => dateFormat({ hour: '2-digit', minute: '2-digit' });
const dateOf = (key: string) => new Date(key + 'T12:00:00');
export const monthName = (key: string) => MONTH().format(dateOf(key));
export const dayLabel = (key: string) => DAY().format(dateOf(key)).replace('.', '');
export const dayKeyOf = (ms: number) => keyOf(new Date(ms));
export const fullDate = (ms = Date.now()) => { const s = FULL().format(ms); return s.charAt(0).toUpperCase() + s.slice(1); };
export const clock = (ms: number) => HM().format(ms);

/** "agora", "12 min", "3 h", "2 d". */
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return t('ago.now');
  if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  return t('ago.d', { n: Math.floor(s / 86400) });
}

const GB = 1024 ** 3;
const gb = (b: number) => Math.round((b / GB) * 100) / 100;
/** Nome do meio do enlace no idioma atual (`eth`, `lora`, `ble`, `direct`, `mesh`); outros voltam como vieram. */
export const medium = (m: string): string => (m === 'eth' ? t('medium.eth') : m === 'lora' ? t('medium.lora') : m === 'ble' ? t('medium.ble') : m === 'direct' ? t('medium.direct') : m === 'mesh' ? t('medium.mesh') : m);
export const MEDIUM_ICON: Record<string, string> = { eth: 'lan', lora: 'settings_input_antenna', ble: 'bluetooth', direct: 'wifi_tethering', mesh: 'hub' };
export const shortAddr = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-4)}` : a);

/** Equipamento da API no formato do painel, com as estatísticas reais quando é o nó que serve o painel. */
export function liveDevice(d: ApiDevice, live: Live | null): RelayNode {
  const cls = (d.cls in CLASS_ICON ? d.cls : 'Home Node') as NodeClass;
  const base: RelayNode = {
    id: d.id, name: d.name, cls, short: '', pub: d.pub ?? '', icon: CLASS_ICON[cls], status: d.status,
    model: t('live.registeredByWizard'),
    pph: 0, today: 0, month: 0, neighbors: 0, storage: null, uptime: '—', ifaces: [], receipts: [], passive: cls === 'Ponto de Acesso', telemetry: 'none',
    ...(d.nodeId ? { nodeId: d.nodeId, signed: !!d.signed } : {}), ...(d.limits ? { limits: d.limits } : {}),
    ...(d.parent ? { parent: d.parent } : {}), ...(d.report ? { report: d.report } : {}), ...(d.policy ? { policy: d.policy } : {}),
  };
  if (!d.self && d.nodeId) {
    // Vinculado a um vizinho: o enlace real (o nó diz se está conectado e quando foi visto por último).
    // Conectado também quando a leitura de equipamentos ainda não pegou a conexão nova, mas o relay já.
    const on = relayOn(live)?.neighbors.find(n => n.id === d.nodeId);
    const link = on ? { online: true, lastSeen: Date.now(), address: on.address } : d.link ?? null;
    if (link) base.link = link;
    base.model = link?.online ? t('live.identityLinked', { id: d.nodeId, addr: link.address ?? t('live.unknownAddr') }) : t('live.identityNoLink', { id: d.nodeId });
    // Resumo assinado pelo próprio equipamento (chega pela malha quando ele é do mesmo operador).
    if (d.report) {
      base.uptime = ago(d.report.startedAt);
      base.neighbors = d.report.neighbors;
    }
  } else if (!d.self) {
    base.model = cls === 'Ponto de Acesso'
      ? t('live.apModel')
      : t('live.noIdModel');
  }
  if (!d.self) return base;
  const r = relayOn(live), h = historyOn(live), rc = receiptsOn(live);
  const ifaces: Iface[] = [];
  if (r) {
    const lan = r.neighbors.filter(n => n.link === 'eth').length - (r.serial ?? []).filter(s => s.kind === 'usb').length;
    const n = Math.max(0, lan);
    ifaces.push({ name: t('live.lanIface'), detail: `${t('live.neighbors', { count: n })}${r.lan ? ` · TCP ${r.lan.port}` : ''}`, load: null });
    for (const s of r.serial ?? []) {
      ifaces.push(s.kind === 'lora'
        ? { name: `LoRa · ${s.label}`, detail: t('live.loraDetail', { sent: fmtInt(s.packetsSent), duty: s.dutyUsedPercent ?? 0 }), load: s.dutyPercent ? Math.min(100, ((s.dutyUsedPercent ?? 0) / s.dutyPercent) * 100) : null }
        : { name: `USB · ${s.label}`, detail: t('live.usbDetail', { sent: fmtInt(s.packetsSent), recv: fmtInt(s.packetsReceived) }), load: null });
    }
  }
  return {
    ...base, telemetry: 'live', passive: false,
    model: r ? t('live.selfModel', { v: r.lnnp.version, id: r.node }) : t('live.selfOff'),
    pph: lastHour(h), receiptsToday: todayTotals(h).receipts, neighbors: r?.neighbors.length ?? 0,
    storage: r ? [gb(r.store.bytes), gb(r.store.maxBytes)] : null,
    uptime: r?.startedAt ? ago(r.startedAt) : '—', ifaces,
    receipts: (rc?.recent ?? []).slice(0, 6).map(x => ({ time: clock(x.at), kind: x.own ? t('live.ownReceipt') : t('live.peerReceipt'), hops: '', state: t('live.awaitingValidator') })),
  };
}

/** Movimentação real da carteira no formato da lista. */
export function liveTx(tx: ApiWalletTx): WalletTx {
  const date = dayLabel(dayKeyOf(tx.at));
  if (tx.kind === 'in') return { id: tx.id, icon: 'call_received', title: t('live.settlement', { from: tx.from ?? '' }).trim(), date, status: t('live.received'), value: '+' + fmt(tx.amount), amount: tx.amount, at: tx.at };
  return { id: tx.id, icon: 'call_made', title: tx.to === 'personal' ? t('live.toPersonal') : t('live.toAddr', { addr: shortAddr(tx.to) }), date, status: t('live.registeredHere'), value: '−' + fmt(tx.amount), amount: -tx.amount, at: tx.at };
}
