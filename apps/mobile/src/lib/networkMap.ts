/**
 * Mapa da rede (desenho Piu 18, direção Radar): pontos, escala, anéis, filtros, lista e conexão.
 * TypeScript puro, testado em __tests__/networkMap.test.ts.
 *
 * Só entra no mapa o que o app conhece de verdade: vizinhos do transporte, Super Nodes ouvidos pelo
 * LoRa (anúncio "PN") e redes Wi-Fi "Piu · …". Nenhuma dessas fontes informa posição: sem rumo, os
 * pontos ficam espalhados por igual no anel certo; a distância vem do sinal (Wi-Fi) ou fica como "até"
 * o alcance do canal (Bluetooth, Wi-Fi Direct, LoRa), sem número inventado.
 */
import { fmtNumber, t as tGlobal, type Key, type Vars } from '../i18n/core';
import type { Medium, Peer, TransportState } from '../transport/types';
import { viaLabel } from './networkCore';
import { isPiuSsid, signalBars, type ScannedNet } from './pointCore';
import type { LoraMode } from './piuLora';

type Tr = (key: Key, vars?: Vars) => string;

export type PointKind = 'pessoa' | 'ponto' | 'wifi' | 'gateway' | 'super' | 'rnode' | 'mesh';
export type Signal = 'strong' | 'medium' | 'weak';
/** Por que o ponto está no mapa (linha "No mapa porque"). */
export type Why = 'optedIn' | 'announces' | 'ssid' | 'beacon';

/** Um ponto do mapa (modelo de dados do spec, §7). */
export interface MapPoint {
  id: string;
  /** Nome público: `piu.nome`, ID do Meshtastic, nome do nó ou da rede. Nunca endereço ou nome real. */
  name: string;
  kind: PointKind;
  /** Canais pelos quais o app alcança o ponto (o primeiro é o mostrado). */
  channels: Medium[];
  /** Metros; `null` = sem posição nem sinal. */
  distM: number | null;
  /** `pos`: posição exata (o dono aceitou aparecer); `signal`: estimada pelo sinal. */
  distBy: 'pos' | 'signal' | null;
  /** Rumo em graus (0 = norte); `null` = sem localização. */
  bearing: number | null;
  inRange: boolean;
  connected: boolean;
  signal: Signal | null;
  hops: number | null;
  /** Ponto pelo qual a malha alcança este (id), se conhecido. */
  reachedVia: string | null;
  /** Último sinal (ms). */
  lastSeen: number;
  why: Why;
  /** O app sabe conectar a este ponto daqui (hoje: só o Wi-Fi de um ponto Piu). */
  connectable: boolean;
}

// ── escala do radar ──────────────────────────────────────

export const MIN_D = 10;
export const MAX_D = 10_000;
/** Alcance de cada canal (anéis de alcance: 30 m Bluetooth, 100 m Wi-Fi, 5 km LoRa). */
export const REACH_M: Record<Medium, number> = { ble: 30, sim: 30, nearby: 100, lan: 100, piulora: 5000, lora: 5000 };
/** Anel de dentro de cada canal (o de fora do canal mais curto). */
const INNER_M: Record<Medium, number> = { ble: MIN_D, sim: MIN_D, nearby: 30, lan: 30, piulora: 100, lora: 100 };
/** Rumo dos rótulos dos anéis. */
export const RING_LABEL_BEARING = 162;

/** Raio normalizado (0 = centro, 1 = borda): `0,26 + 0,70 × (log10(d) − 1) / 3`, d de 10 m a 10 km. */
export function radarRadius(d: number): number {
  const x = Math.min(MAX_D, Math.max(MIN_D, d));
  return 0.26 + 0.7 * (Math.log10(x) - 1) / 3;
}

/** Coordenadas em % do quadrado do radar: `x = 50 + sin(b)·r·50`, `y = 50 − cos(b)·r·50`. */
export function polar(r: number, bearing: number): { x: number; y: number } {
  const a = bearing * Math.PI / 180;
  return { x: 50 + Math.sin(a) * r * 50, y: 50 - Math.cos(a) * r * 50 };
}

/** Rótulo acima do marcador: ponto a menos de 100 m na metade de cima (para não cobrir o "você"). */
export const labelAbove = (d: number, bearing: number) => d < 100 && Math.cos(bearing * Math.PI / 180) > 1e-9;

/** Distância usada para desenhar: a medida, ou o meio (log) da faixa do canal quando não há medida. */
export function placeDistance(p: Pick<MapPoint, 'distM' | 'channels'>): number {
  if (p.distM !== null) return p.distM;
  const m = p.channels[0] ?? 'ble';
  return Math.sqrt(INNER_M[m] * REACH_M[m]);
}

/** Faixa entre anéis (para espalhar pontos sem rumo no anel certo). */
const bandOf = (d: number) => (d <= 30 ? 0 : d <= 100 ? 1 : d <= 1000 ? 2 : d <= 5000 ? 3 : 4);
/** Ângulo do primeiro ponto da faixa mais de dentro (as de fora vêm intercaladas). */
const FIRST_ANGLE = 20;

export interface Placed { id: string; x: number; y: number; r: number; angle: number; d: number; above: boolean }

/**
 * Posição de cada ponto no radar. Com rumo: a direção real. Sem rumo: espalhados por igual dentro da
 * mesma faixa, em ordem de distância e id (a mesma entrada dá sempre a mesma posição); cada faixa
 * começa no meio do vão da faixa de dentro, para os pontos de anéis vizinhos não se cobrirem.
 */
export function layoutPoints(points: readonly MapPoint[]): Placed[] {
  const free = new Map<number, MapPoint[]>();
  for (const p of points) if (p.bearing === null) { const b = bandOf(placeDistance(p)); free.set(b, [...(free.get(b) ?? []), p]); }
  const angleOf = new Map<string, number>();
  let start = FIRST_ANGLE, prevStep = 0;
  for (const b of [...free.keys()].sort((x, y) => x - y)) {
    const sorted = [...free.get(b)!].sort((a, c) => placeDistance(a) - placeDistance(c) || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
    const step = 360 / sorted.length;
    start = (start + prevStep / 2) % 360;
    sorted.forEach((p, i) => angleOf.set(p.id, (start + i * step) % 360));
    prevStep = step;
  }
  return points.map(p => {
    const d = placeDistance(p), angle = p.bearing ?? angleOf.get(p.id)!, r = radarRadius(d);
    return { id: p.id, ...polar(r, angle), r, angle, d, above: labelAbove(d, angle) };
  });
}

export interface Ring { d: number; r: number; kind: 'reach' | 'ref'; label: string | null; lx: number; ly: number }

/**
 * Anéis, de fora para dentro: 10 km (tracejado, sem rótulo), 5 km de LoRa (só com rádio LoRa), 1 km
 * (tracejado), 100 m e 30 m. Offline: nenhum canal alcança, então todos viram referência.
 */
export function ringsFor(o: { lora: boolean; offline: boolean }): Ring[] {
  const mk = (d: number, kind: Ring['kind'], label: string | null): Ring => {
    const r = radarRadius(d), at = polar(r, RING_LABEL_BEARING);
    return { d, r, kind: o.offline ? 'ref' : kind, label, lx: at.x, ly: at.y };
  };
  return [
    mk(10_000, 'ref', null),
    ...(o.lora && !o.offline ? [mk(5000, 'reach', fmtDist(5000))] : []),
    mk(1000, 'ref', fmtDist(1000)),
    mk(100, 'reach', null),
    mk(30, 'reach', null),
  ];
}

// ── filtros ──────────────────────────────────────────────

export type FilterKey = 'all' | 'pessoa' | 'ponto' | 'wifi' | 'gateway' | 'super' | 'lora';
export const FILTERS: readonly FilterKey[] = ['all', 'pessoa', 'ponto', 'wifi', 'gateway', 'super', 'lora'];
/** Rádio do Piu de outra pessoa e nó Meshtastic ficam juntos em "Rádios LoRa". */
export const filterOf = (k: PointKind): Exclude<FilterKey, 'all'> => (k === 'rnode' || k === 'mesh' ? 'lora' : k);

/** Contagem de cada filtro (sobre todos os pontos: não muda com a seleção). */
export function filterCounts(points: readonly MapPoint[]): Record<FilterKey, number> {
  const c = Object.fromEntries(FILTERS.map(k => [k, 0])) as Record<FilterKey, number>;
  for (const p of points) { c.all++; c[filterOf(p.kind)]++; }
  return c;
}

/** Filtros somam; "Todos" limpa; tirar o último volta para "Todos" (lista vazia). */
export function toggleFilter(active: readonly FilterKey[], k: FilterKey): FilterKey[] {
  if (k === 'all') return [];
  return active.includes(k) ? active.filter(x => x !== k) : [...active, k];
}

export const applyFilters = (points: readonly MapPoint[], active: readonly FilterKey[]) =>
  (active.length ? points.filter(p => active.includes(filterOf(p.kind))) : [...points]);

export type MapMode = 'full' | 'empty' | 'offline';

/** Resumo embaixo do radar. */
export function mapSummary(o: { all: readonly MapPoint[]; shown: readonly MapPoint[]; filters: readonly FilterKey[]; mode: MapMode }, t: Tr = tGlobal): string {
  if (o.mode === 'offline') return t('map.summary.offline', { count: o.all.length });
  if (o.mode === 'empty') return t('map.summary.searching');
  if (o.filters.length) {
    const names = FILTERS.filter(k => o.filters.includes(k)).map(k => t(`map.filter.${k}` as Key)).join(', ');
    return t('map.summary.filtered', { shown: o.shown.length, total: o.all.length, names });
  }
  return t('map.summary', { count: o.shown.length, near: o.shown.filter(p => p.inRange).length });
}

// ── lista ────────────────────────────────────────────────

export const sortByDistance = (points: readonly MapPoint[]) =>
  [...points].sort((a, b) => placeDistance(a) - placeDistance(b) || a.name.localeCompare(b.name));

export interface ListGroup { key: 'near' | 'far' | 'seen'; points: MapPoint[] }

/** Grupos "No alcance" e "Longe" (offline: "Vistos antes"), cada um em ordem de distância. */
export function listGroups(points: readonly MapPoint[], o: { offline: boolean }): ListGroup[] {
  const s = sortByDistance(points);
  const near = s.filter(p => p.inRange), far = s.filter(p => !p.inRange);
  const out: ListGroup[] = [];
  if (near.length) out.push({ key: 'near', points: near });
  if (far.length) out.push({ key: o.offline ? 'seen' : 'far', points: far });
  return out;
}

// ── memória (sumidos e offline) ──────────────────────────

/** Ponto que sumiu fica vazado este tempo antes de sair do mapa. */
export const STALE_MS = 2 * 60_000;
/** Memória dos vistos antes (para o mapa offline): teto e idade máxima. */
export const MEMORY_MAX = 64;
export const MEMORY_MS = 24 * 3_600_000;

/** Guarda o que foi visto agora (o último sinal de cada ponto), sem passar do teto nem da idade. */
export function trackPoints(memory: Readonly<Record<string, MapPoint>>, current: readonly MapPoint[], now: number): Record<string, MapPoint> {
  const all: Record<string, MapPoint> = { ...memory };
  for (const p of current) all[p.id] = p;
  const keep = Object.values(all).filter(p => now - p.lastSeen <= MEMORY_MS).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MEMORY_MAX);
  return Object.fromEntries(keep.map(p => [p.id, p]));
}

const gone = (p: MapPoint): MapPoint => ({ ...p, inRange: false, connected: false });

/** O que o mapa mostra: os de agora e os sumidos há até 2 min (vazados); offline, todos os vistos antes. */
export function visiblePoints(memory: Readonly<Record<string, MapPoint>>, current: readonly MapPoint[], now: number, o: { offline: boolean }): MapPoint[] {
  if (o.offline) return Object.values(memory).map(gone);
  const ids = new Set(current.map(p => p.id));
  const stale = Object.values(memory).filter(p => !ids.has(p.id) && now - p.lastSeen <= STALE_MS).map(gone);
  return [...current, ...stale];
}

// ── estados ──────────────────────────────────────────────

/** Algum canal ligado agora (Bluetooth/Wi-Fi Direct, Wi-Fi local ou rádio LoRa). */
export const isOnline = (o: { transport: TransportState; lan: boolean; lora: boolean }) => o.transport === 'running' || o.lan || o.lora;

export const mapMode = (o: { online: boolean; count: number }): MapMode => (!o.online ? 'offline' : o.count ? 'full' : 'empty');

// ── conectar ─────────────────────────────────────────────

/** Ordem do canal para conectar: Wi-Fi local > Wi-Fi Direct > Bluetooth > LoRa (Piu) > LoRa (Meshtastic). */
export const CONNECT_ORDER: readonly Medium[] = ['lan', 'nearby', 'ble', 'piulora', 'lora', 'sim'];

/** Melhor canal do ponto, respeitando o modo da linha LoRa (Só Piu tira o Meshtastic e vice-versa). */
export function connectChannel(channels: readonly Medium[], mode: LoraMode): Medium | null {
  const ok = (m: Medium) => !(mode === 'piu' && m === 'lora') && !(mode === 'mesh' && m === 'piulora');
  return CONNECT_ORDER.find(m => channels.includes(m) && ok(m)) ?? null;
}

export type ConnectPhase = 'idle' | 'link' | 'keys' | 'mesh' | 'done' | 'failed';
/** Depois de entrar no Wi-Fi, quanto espera um vizinho Piu na rede antes de dar por conectado. */
export const WIFI_SETTLE_MS = 15_000;

/**
 * Conectar pelo Wi-Fi de um ponto Piu (o caminho do visitante, state/point.tsx): entrando no Wi-Fi →
 * trocando chaves (o LNNP abre o enlace na rede) → conectado quando aparece um vizinho, ou depois de
 * `WIFI_SETTLE_MS` no Wi-Fi.
 */
export function wifiPhase(o: { ssid: string; joining: boolean; joinedSsid: string | null; error: boolean; lanPeers: number; joinedAt: number | null; now: number }): ConnectPhase {
  if (o.error) return 'failed';
  if (o.joining) return 'link';
  if (o.joinedSsid !== o.ssid) return 'idle';
  if (o.lanPeers > 0 || o.joinedAt === null || o.now - o.joinedAt >= WIFI_SETTLE_MS) return 'done';
  return 'keys';
}

export type StepState = 'done' | 'now' | 'wait';
/** As três etapas (ligando → trocando chaves → entrando na malha). */
export function connectSteps(phase: ConnectPhase): [StepState, StepState, StepState] {
  const at = phase === 'link' ? 0 : phase === 'keys' ? 1 : phase === 'mesh' ? 2 : phase === 'done' ? 3 : 0;
  return [0, 1, 2].map(i => (i < at ? 'done' : i === at ? 'now' : 'wait')) as [StepState, StepState, StepState];
}

/** Pontos que entraram no alcance desde o começo da conexão (aviso "+N pontos"). */
export const gainedCount = (before: ReadonlySet<string>, after: readonly MapPoint[]) => after.filter(p => p.inRange && !before.has(p.id)).length;

/** Quanto falta para o ponto entrar no alcance do canal (só com distância conhecida). */
export function farMissing(p: MapPoint): number | null {
  if (p.distM === null) return null;
  return Math.max(0, p.distM - REACH_M[p.channels[0] ?? 'lan']);
}

export type AddLoraStep = 'type' | 'mesh' | 'piu' | 'region' | 'regionFirst';
/** "Conectar rádio LoRa" (mapa vazio): o mesmo primeiro passo do "+" da linha LoRa. `null` = sem módulo de rádio. */
export function addLoraStep(o: { piu: boolean; mesh: boolean; region: boolean }): AddLoraStep | null {
  if (o.piu && o.mesh) return 'type';
  if (o.piu) return o.region ? 'piu' : 'regionFirst';
  return o.mesh ? 'mesh' : null;
}

// ── textos ───────────────────────────────────────────────

/** "40 m", "4,2 km", "1 km". */
export function fmtDist(d: number): string {
  if (d < 1000) return `${Math.round(d)} m`;
  return `${fmtNumber(Math.round(d / 100) / 10, { maximumFractionDigits: 1 })} km`;
}

/** Distância como o mapa mostra: exata, "~" pelo sinal, ou "até" o alcance do canal. */
export function distanceText(p: MapPoint, t: Tr = tGlobal): string {
  if (p.distM === null) return t('map.dist.upTo', { d: fmtDist(REACH_M[p.channels[0] ?? 'ble']) });
  return p.distBy === 'signal' ? `~${fmtDist(p.distM)}` : fmtDist(p.distM);
}

export type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const DIRS: Dir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const bearingDir = (b: number): Dir => DIRS[Math.round((((b % 360) + 360) % 360) / 45) % 8]!;

/** Distância falada: "4,2 quilômetros", com plural do idioma. */
function spokenDist(d: number, t: Tr): string {
  if (d < 1000) { const n = Math.round(d); return t('map.a11y.m', { count: n, n: String(n) }); }
  const km = Math.round(d / 100) / 10;
  return t('map.a11y.km', { count: km, n: fmtNumber(km, { maximumFractionDigits: 1 }) });
}

/** Rótulo do leitor de tela: "piu.torre-serra, Super Node, 4,2 quilômetros ao norte, no alcance". */
export function pointA11y(p: MapPoint, t: Tr = tGlobal): string {
  const dist = p.distM === null
    ? t('map.a11y.upTo', { d: spokenDist(REACH_M[p.channels[0] ?? 'ble'], t) })
    : p.distBy === 'signal' ? t('map.a11y.about', { d: spokenDist(p.distM, t) }) : spokenDist(p.distM, t);
  const dir = p.bearing === null ? t('map.a11y.noDir') : t(`map.dir.${bearingDir(p.bearing)}` as Key);
  const state = p.connected ? t('map.a11y.connected') : p.inRange ? t('map.a11y.near') : t('map.a11y.far');
  return t('map.a11y.point', { name: p.name, kind: t(`map.kind.${p.kind}` as Key), dist: p.bearing === null ? `${dist}, ${dir}` : `${dist} ${dir}`, state });
}

/** "agora", "há 20 s", "há 12 min", "há 3 h". */
export function ageText(ms: number, t: Tr = tGlobal): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return t('map.age.now');
  if (s < 60) return t('map.age.s', { n: s });
  if (s < 3600) return t('map.age.min', { n: Math.round(s / 60) });
  return t('map.age.h', { n: Math.round(s / 3600) });
}

/** Nome do canal como a aba Rede mostra. */
export const channelLabel = (m: Medium, t: Tr = tGlobal) => viaLabel(m, t);

// ── sinal ────────────────────────────────────────────────

/** Forte/médio/fraco pelas barras do Wi-Fi (as mesmas da lista de redes). */
export function signalOf(dbm: number): Signal {
  const b = signalBars(dbm);
  return b >= 3 ? 'strong' : b === 2 ? 'medium' : 'weak';
}

/**
 * Distância estimada pelo sinal Wi-Fi (perda log-distância: −40 dBm a 1 m, expoente 2,5). Só uma
 * ordem de grandeza (paredes e antenas mudam muito): a tela mostra com "~". Arredonda a 5 m (até
 * 100 m) ou a 10 m.
 */
export function wifiDistance(dbm: number): number {
  const d = 10 ** ((-40 - dbm) / 25);
  const r = d < 100 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10;
  return Math.min(MAX_D, Math.max(MIN_D, r));
}

// ── fontes reais ─────────────────────────────────────────

/** Id do vizinho virtual da malha LoRa (meshtastic/link.ts): não é um ponto, é a malha. */
const LORA_PEER = 'lora:mesh';
const isMeshPeer = (p: Peer) => p.id === LORA_PEER || p.via === 'lora' || p.via === 'piulora';

/**
 * Vizinhos do transporte (Bluetooth LE, Wi-Fi Direct, Wi-Fi local; o simulado no navegador): outros
 * aparelhos com o Piu, pelo nome curto do nó. O transporte não mede distância nem direção. Meio
 * desligado na aba Rede = longe (o transporte deixa de usá-lo).
 */
export function peerPoints(peers: readonly Peer[], o: { live: (p: Peer) => boolean; now: number }): MapPoint[] {
  return peers.filter(p => !isMeshPeer(p)).map(p => {
    const on = o.live(p);
    return {
      id: p.id, name: p.name, kind: 'pessoa', channels: [p.via, ...(p.media ?? []).filter(m => m !== p.via)], distM: null, distBy: null, bearing: null,
      inRange: on, connected: on && p.connected, signal: null, hops: 1, reachedVia: null, lastSeen: o.now, why: 'announces', connectable: false,
    } satisfies MapPoint;
  });
}

/** Super Node ouvido por um dos rádios LoRa (`last` em segundos). */
export interface HeardBy { medium: 'lora' | 'piulora'; nodes: readonly { id: string; gateway: boolean; last: number }[] }

/**
 * Super Nodes e gateways que se anunciaram na malha LoRa (anúncio "PN" assinado, últimos 40 min). O
 * anúncio não leva nome público nem posição: o nome é `piu.` + o começo da chave.
 */
export function superNodePoints(heard: readonly HeardBy[]): MapPoint[] {
  const by = new Map<string, { gateway: boolean; last: number; channels: Medium[] }>();
  for (const h of heard) for (const n of h.nodes) {
    const cur = by.get(n.id);
    if (!cur) by.set(n.id, { gateway: n.gateway, last: n.last, channels: [h.medium] });
    else { cur.last = Math.max(cur.last, n.last); cur.gateway ||= n.gateway; if (!cur.channels.includes(h.medium)) cur.channels.push(h.medium); }
  }
  return [...by].map(([id, v]) => ({
    id: 'pn:' + id, name: 'piu.' + id.slice(0, 4), kind: v.gateway ? 'gateway' : 'super', channels: v.channels, distM: null, distBy: null, bearing: null,
    inRange: true, connected: false, signal: null, hops: null, reachedVia: null, lastSeen: v.last * 1000, why: 'beacon', connectable: false,
  } satisfies MapPoint));
}

/**
 * Redes Wi-Fi de pontos Piu ("Piu · …", o nome público que o operador escolheu) na última varredura,
 * com distância e força pelo sinal. A rede em que o celular está como visitante = conectado.
 */
export function wifiPoints(nets: readonly ScannedNet[], o: { joinedSsid: string | null; scannedAt: number; canJoin: boolean }): MapPoint[] {
  const out: MapPoint[] = nets.filter(n => isPiuSsid(n.ssid)).map(n => {
    const connected = n.ssid === o.joinedSsid;
    return {
      id: 'wifi:' + n.ssid, name: n.ssid, kind: 'wifi', channels: ['lan'], distM: wifiDistance(n.level), distBy: 'signal', bearing: null,
      inRange: true, connected, signal: signalOf(n.level), hops: 1, reachedVia: null, lastSeen: o.scannedAt, why: 'ssid', connectable: o.canJoin && !connected,
    } satisfies MapPoint;
  });
  if (o.joinedSsid && !out.some(p => p.name === o.joinedSsid)) {
    out.push({
      id: 'wifi:' + o.joinedSsid, name: o.joinedSsid, kind: 'wifi', channels: ['lan'], distM: null, distBy: null, bearing: null,
      inRange: true, connected: true, signal: null, hops: 1, reachedVia: null, lastSeen: o.scannedAt, why: 'ssid', connectable: false,
    });
  }
  return out;
}
