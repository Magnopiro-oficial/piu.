/**
 * Tela do mapa da rede (desenho Piu 18, direção Radar) só com props: o app liga aos dados reais
 * (useNetworkMap, src/app/network-map.tsx); a galeria de desenvolvimento usa dados de exemplo.
 * Filtros com contagem, radar ou lista, folha do ponto (conectar, conectando, conectado, longe),
 * avisos (offline, sem localização), cartão "Nada por perto" e aviso rápido de conectado.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { fmtDate, useT } from '../../i18n';
import type { Key } from '../../i18n/core';
import {
  ageText, applyFilters, bearingDir, channelLabel, connectChannel, connectSteps, distanceText, farMissing, FILTERS, filterCounts, fmtDist,
  listGroups, mapSummary, REACH_M, toggleFilter, type ConnectPhase, type FilterKey, type MapMode, type MapPoint,
} from '../../lib/networkMap';
import type { LoraMode } from '../../lib/piuLora';
import { useTheme } from '../../theme/ThemeProvider';
import type { Medium } from '../../transport/types';
import { BackHeader } from '../Controls';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';
import { KIND, Radar } from './Radar';

export interface ConnectState { id: string; phase: ConnectPhase }
export type MapBanner = 'offline' | 'noLoc' | 'noDir';

export interface MapViewProps {
  points: MapPoint[];
  mode: MapMode;
  /** Há rumo dos pontos (bússola, setas da lista). */
  located: boolean;
  /** Rádio LoRa conectado (anel de 5 km). */
  lora: boolean;
  loraMode: LoraMode;
  now: number;
  banner: MapBanner | null;
  /** "Ligar" (offline) ou "Permitir" (sem localização); sem ele, o aviso não tem botão. */
  onBanner?: () => void;
  /** Até quando foi visto o último ponto (aviso offline). */
  lastSeenAt?: number | null;
  connect: ConnectState | null;
  onConnect?: (id: string) => void;
  onCancel?: () => void;
  onDisconnect?: (id: string) => void;
  canDisconnect?: (p: MapPoint) => boolean;
  /** Pontos que passaram a ser alcançáveis por cada conexão (ficha "+N"), por id do ponto. */
  gained?: Readonly<Record<string, number>>;
  /** Linhas a mais no detalhe (ex.: "Desde 14:06" do ponto conectado). */
  extraRows?: (p: MapPoint) => [string, string][];
  /** Nome do rádio do Piu (para "Liga pelo seu Rádio do Piu (RNode 3F2A)"). */
  radioName?: string | null;
  toast: string | null;
  onAddLora?: () => void;
  /** Fora da tela: a varredura pausa. */
  paused?: boolean;
  initial?: { selected?: string | null; view?: 'radar' | 'list'; filters?: FilterKey[] };
}

const DOT = { ok: 'ok', ink: 'ink', far: 'ink3' } as const;

export function NetworkMapView(props: MapViewProps) {
  const { c } = useTheme();
  const t = useT();
  const { points, mode, located, initial } = props;
  const [filters, setFilters] = useState<FilterKey[]>(initial?.filters ?? []);
  const [view, setView] = useState<'radar' | 'list'>(initial?.view ?? 'radar');
  const [selected, setSelected] = useState<string | null>(initial?.selected ?? null);
  const offline = mode === 'offline';
  const counts = useMemo(() => filterCounts(points), [points]);
  const shown = useMemo(() => applyFilters(points, filters), [points, filters]);
  const sel = selected ? points.find(p => p.id === selected) ?? null : null;
  // O ponto selecionado que sumiu do mapa fecha a folha.
  useEffect(() => { if (selected && !sel) setSelected(null); }, [selected, sel]);
  // Esc fecha o detalhe (navegador / teclado).
  useEffect(() => {
    if (Platform.OS !== 'web' || !selected || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const edgeKind = props.connect && sel && props.connect.id === sel.id && props.connect.phase !== 'failed' && props.connect.phase !== 'done' ? 'flow' : sel?.connected ? 'solid' : null;
  const summary = mapSummary({ all: points, shown, filters, mode });

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title={t('map.title')} right={
        <Pressable onPress={() => setView(v => (v === 'radar' ? 'list' : 'radar'))} accessibilityRole="button" accessibilityLabel={view === 'radar' ? t('map.toList') : t('map.toRadar')}
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}>
          <Icon name={view === 'radar' ? 'view_list' : 'radar'} size={20} />
        </Pressable>
      } />
      <Chips counts={counts} active={filters} zero={mode === 'empty'} onToggle={k => setFilters(f => toggleFilter(f, k))} />
      {props.banner ? <Banner kind={props.banner} onPress={props.onBanner} lastSeenAt={props.lastSeenAt ?? null} /> : null}

      <View style={{ flex: 1, minHeight: 0, marginHorizontal: 12, borderRadius: 24, backgroundColor: c.bg2, overflow: 'hidden' }}
        accessibilityLabel={view === 'radar' ? t('map.a11y.radar', { count: shown.length }) : undefined}>
        {view === 'radar' ? (
          <>
            {located ? (
              <View style={{ position: 'absolute', left: 12, top: 10, zIndex: 3, flexDirection: 'row', alignItems: 'center', gap: 2 }} accessible={false}>
                <Icon name="navigation" size={14} color={c.ink2} />
                <T size={10.5} w={600} mono color={c.ink2}>{t('map.north')}</T>
              </View>
            ) : null}
            <Radar points={shown} selected={selected} onSelect={setSelected} lora={props.lora} offline={offline} sweep={mode === 'empty'} paused={props.paused}
              edge={sel && edgeKind ? { to: sel.id, kind: edgeKind } : null} align={sel ? 'flex-start' : 'center'} />
          </>
        ) : (
          <MapList points={shown} offline={offline} now={props.now} selected={selected} onSelect={setSelected} located={located} />
        )}
        {mode === 'empty' ? <EmptyCard onAddLora={props.onAddLora} /> : null}
      </View>

      {view === 'radar' && !offline ? (
        <T size={9.5} w={500} mono color={c.ink3} style={{ paddingTop: 10, paddingHorizontal: 20 }}>{props.lora ? t('map.rings') : t('map.rings.noLora')}</T>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 14 }}>
        <T size={11.5} w={500} mono color={c.ink2} style={{ flexShrink: 1 }} accessibilityLiveRegion="polite">{summary}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /><T size={11} color={c.ink2}>{t('map.legend.near')}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: c.ink3 }} /><T size={11} color={c.ink2}>{t('map.legend.far')}</T>
          </View>
        </View>
      </View>

      {sel ? <PointSheet p={sel} all={points} {...props} onClose={() => setSelected(null)} /> : null}
      <MapToast text={props.toast} />
    </View>
  );
}

// ── filtros ──────────────────────────────────────────────

function Chips({ counts, active, zero, onToggle }: { counts: Record<FilterKey, number>; active: FilterKey[]; zero: boolean; onToggle: (k: FilterKey) => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 4, paddingBottom: 10, paddingHorizontal: 12 }}>
        {FILTERS.map(k => {
          const on = k === 'all' ? active.length === 0 : active.includes(k);
          const name = t(`map.filter.${k}` as Key);
          return (
            <Pressable key={k} onPress={() => onToggle(k)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t('map.filter.a11y', { name, count: counts[k] })}
              style={{ height: 32, paddingHorizontal: 11, borderRadius: 16, backgroundColor: on ? c.ink : c.bg2, flexDirection: 'row', alignItems: 'center', gap: 5, opacity: zero && k !== 'all' ? 0.5 : 1 }}>
              <T size={12.5} w={600} color={on ? c.invink : c.ink}>{name}</T>
              <T size={10.5} w={500} mono color={on ? c.invink : c.ink} style={{ opacity: 0.7 }}>{String(counts[k])}</T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── avisos ───────────────────────────────────────────────

function Banner({ kind, onPress, lastSeenAt }: { kind: MapBanner; onPress?: () => void; lastSeenAt: number | null }) {
  const { c } = useTheme();
  const t = useT();
  const warn = kind === 'offline';
  const fg = warn ? c.warn : c.ink;
  const [icon, title, desc, action]: [IconName, string, string, string] = kind === 'offline'
    ? ['portable_wifi_off', t('map.offline.title'), lastSeenAt ? t('map.offline.desc', { time: fmtDate(lastSeenAt, { hour: '2-digit', minute: '2-digit' }) }) : t('map.offline.none'), t('map.offline.on')]
    : kind === 'noLoc' ? ['location_off', t('map.noLoc.title'), t('map.noLoc.desc'), t('map.noLoc.allow')]
      : ['location_off', t('map.noDir.title'), t('map.noDir.desc'), ''];
  return (
    <View accessibilityRole={warn ? 'alert' : undefined} style={{ marginHorizontal: 12, marginBottom: 8, paddingVertical: 11, paddingLeft: 14, paddingRight: 12, borderRadius: 16, backgroundColor: warn ? c.warnbg : c.bg2, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={20} color={fg} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <T size={13} w={650} color={fg}>{title}</T>
        <T size={11.5} lh={1.35} color={c.ink2}>{desc}</T>
      </View>
      {onPress && action ? (
        <Pressable onPress={onPress} accessibilityRole="button" style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T size={12.5} w={650} color={c.invink}>{action}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyCard({ onAddLora }: { onAddLora?: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const tips: [IconName, Key][] = [['bluetooth', 'map.empty.tip.near'], ['settings_input_antenna', 'map.empty.tip.lora'], ['directions_walk', 'map.empty.tip.walk']];
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, alignItems: 'center', zIndex: 4 }}>
      <View style={{ width: '100%', maxWidth: 400, padding: 16, borderRadius: 20, backgroundColor: c.bg, gap: 10, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 14 }, elevation: 8 }}>
        <T size={16} w={700} ls={-0.02} accessibilityRole="header">{t('map.empty.title')}</T>
        {tips.map(([icon, k]) => (
          <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
            <Icon name={icon} size={16} />
            <T size={12.5} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{t(k)}</T>
          </View>
        ))}
        {onAddLora ? (
          <Pressable onPress={onAddLora} accessibilityRole="button" style={{ marginTop: 4, height: 42, borderRadius: 21, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="add_link" size={18} color={c.invink} />
            <T size={13.5} w={650} color={c.invink}>{t('map.empty.lora')}</T>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ── lista ────────────────────────────────────────────────

function Tile({ p, size, ok }: { p: MapPoint; size: number; ok?: boolean }) {
  const { c } = useTheme();
  const k = KIND[p.kind];
  const on = p.inRange;
  return (
    <View style={{ width: size, height: size, borderRadius: k.round ? size / 2 : size * 0.3, backgroundColor: on ? c.ink : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: c.ink3,
      alignItems: 'center', justifyContent: 'center', ...(ok ? { borderWidth: 2.5, borderColor: c.ok } : {}) }}>
      <Icon name={k.icon} size={Math.round(size * 0.5)} color={on ? c.invink : c.ink3} />
    </View>
  );
}

function MapList({ points, offline, now, selected, onSelect, located }: { points: MapPoint[]; offline: boolean; now: number; selected: string | null; onSelect: (id: string) => void; located: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const groups = listGroups(points, { offline });
  if (!groups.length) return <T size={12.5} lh={1.5} color={c.ink2} style={{ padding: 16 }}>{t('map.list.empty')}</T>;
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 8, paddingBottom: 16 }}>
      {groups.map(g => (
        <View key={g.key}>
          <T size={10.5} w={500} mono ls={0.06} color={c.ink2} style={{ paddingTop: 12, paddingHorizontal: 8, paddingBottom: 6 }} accessibilityRole="header">
            {t(g.key === 'near' ? 'map.group.near' : g.key === 'far' ? 'map.group.far' : 'map.group.seen', { count: g.points.length })}
          </T>
          {g.points.map((p, i) => {
            const kind = t(`map.kind.${p.kind}` as Key);
            const sub = offline ? t('map.list.seen', { kind, age: ageText(now - p.lastSeen, t) }) : t('map.list.sub', { kind, channel: channelLabel(p.channels[0] ?? 'ble', t) });
            return (
              <Pressable key={p.id} onPress={() => onSelect(p.id)} accessibilityRole="button" accessibilityState={{ selected: selected === p.id }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, borderRadius: selected === p.id ? 12 : 0, backgroundColor: selected === p.id ? c.bg3 : 'transparent' }}>
                <Tile p={p} size={34} ok={p.connected} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={13.5} w={600} numberOfLines={1}>{p.name}</T>
                  <T size={11.5} color={c.ink2} numberOfLines={1}>{sub}</T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 64, justifyContent: 'flex-end' }}>
                  <T size={11} w={500} mono color={c.ink2}>{distanceText(p, t)}</T>
                  {located && p.bearing !== null ? <Icon name="navigation" size={15} color={c.ink2} style={{ transform: [{ rotate: `${p.bearing}deg` }] }} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

// ── folha do ponto ───────────────────────────────────────

type Btn = { t: string; icon: IconName; kind: 'primary' | 'second' | 'off'; onPress?: () => void };

function PointSheet({ p, all, onClose, ...o }: MapViewProps & { p: MapPoint; all: MapPoint[]; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const kind = t(`map.kind.${p.kind}` as Key);
  const ch: Medium = connectChannel(p.channels, o.loraMode) ?? p.channels[0] ?? 'ble';
  const chName = channelLabel(ch, t);
  const isLora = ch === 'lora' || ch === 'piulora';
  const conn = o.connect && o.connect.id === p.id ? o.connect : null;
  const connecting = conn && conn.phase !== 'failed' && conn.phase !== 'done' && conn.phase !== 'idle' ? conn : null;
  const failed = conn?.phase === 'failed';
  const offline = o.mode === 'offline';
  const dir = p.bearing !== null ? ` ${t(`map.dir.${bearingDir(p.bearing)}` as Key)}` : '';
  const sig = p.signal ? t(`map.chip.${p.signal}` as Key) : null;
  const age = ageText(o.now - p.lastSeen, t);
  const why = t(`map.why.${p.why}` as Key);
  const reach = `~${fmtDist(REACH_M[ch])}`;

  let tile: 'on' | 'off' | 'ok' = p.inRange ? 'on' : 'off';
  let name = p.name, sub = t('map.sub', { kind, dist: distanceText(p, t) + dir });
  let chips: { t: string; dot: keyof typeof DOT }[] = [];
  let rows: [string, string][] = [];
  let steps: { t: string; s: 'done' | 'now' | 'wait' }[] | null = null;
  let btn: Btn | null = null;
  let how = '';

  if (connecting) {
    sub = t('map.connecting', { channel: chName });
    chips = [{ t: chName, dot: 'ink' }, ...(sig ? [{ t: sig, dot: 'ink' as const }] : [])];
    const st = connectSteps(connecting.phase);
    steps = [
      { t: isLora ? t('map.step.link.lora') : t('map.step.link.wifi', { name: p.name }), s: st[0] },
      { t: t('map.step.keys', { name: p.name }), s: st[1] },
      { t: t('map.step.mesh'), s: st[2] },
    ];
    btn = o.onCancel ? { t: t('common.cancel'), icon: 'close', kind: 'second', onPress: o.onCancel } : null;
    how = isLora ? t('map.how.connectingLora') : t('map.how.connecting');
  } else if (p.connected) {
    tile = 'ok';
    name = t('map.connectedTo', { name: p.name });
    sub = [kind, chName, sig].filter(Boolean).join(' · ');
    chips = [{ t: t('map.chip.connected'), dot: 'ok' }, ...(o.gained?.[p.id] ? [{ t: t('map.chip.gained', { count: o.gained[p.id]! }), dot: 'ink' as const }] : [])];
    rows = [[t('map.row.why'), why]];
    btn = o.onDisconnect && o.canDisconnect?.(p) ? { t: t('map.disconnect'), icon: 'link_off', kind: 'second', onPress: () => o.onDisconnect!(p.id) } : null;
    how = t('map.how.connected');
  } else if (p.inRange) {
    chips = [{ t: t('map.chip.near'), dot: 'ok' }, { t: chName, dot: 'ink' }, ...(sig ? [{ t: sig, dot: 'ink' as const }] : [])];
    rows = [[t('map.row.channel'), chName], [t('map.row.reach'), reach], [t('map.row.last'), age], [t('map.row.why'), why]];
    btn = p.connectable && o.onConnect ? { t: t('map.connect'), icon: 'link', kind: 'primary', onPress: () => o.onConnect!(p.id) } : null;
    how = p.connectable
      ? isLora ? (o.radioName ? t('map.how.radio', { radio: o.radioName }) : t('map.how.lora')) : ch === 'lan' ? t('map.how.wifi') : t('map.how.auto', { channel: chName })
      : isLora ? t('map.how.lora') : p.kind === 'wifi' ? t('map.how.noJoin') : t('map.how.auto', { channel: chName });
  } else {
    const missing = farMissing(p);
    const via = p.reachedVia ? all.find(x => x.id === p.reachedVia)?.name ?? null : null;
    chips = [{ t: t('map.chip.far'), dot: 'far' }, { t: chName, dot: 'ink' }];
    rows = [
      [t('map.row.reach'), reach],
      ...(missing ? [[t('map.row.missing'), `~${fmtDist(missing)}`] as [string, string]] : []),
      ...(via ? [[t('map.row.reachedBy'), via] as [string, string]] : []),
      [t('map.row.last'), age],
      [t('map.row.why'), why],
    ];
    btn = p.connectable && !offline ? { t: t('map.farBtn'), icon: 'block', kind: 'off' } : null;
    how = offline ? t('map.how.seen') : !p.connectable ? t('map.how.gone') : via ? t('map.how.farVia', { via }) : t('map.how.far');
  }
  rows = [...rows, ...(o.extraRows?.(p) ?? [])];

  const tileBg = tile === 'off' ? 'transparent' : c.ink;
  const btnBg = btn?.kind === 'primary' ? c.ink : btn?.kind === 'second' ? c.bg2 : c.bg3;
  const btnFg = btn?.kind === 'primary' ? c.invink : btn?.kind === 'second' ? c.ink : c.ink3;
  return (
    <View accessibilityViewIsModal={false} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingTop: 10, paddingHorizontal: 18, paddingBottom: 24, gap: 13, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: -14 }, elevation: 18 }}>
      <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: tileBg, borderWidth: tile === 'off' ? 1.5 : tile === 'ok' ? 2.5 : 0, borderColor: tile === 'ok' ? c.ok : c.ink3, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={KIND[p.kind].icon} size={22} color={tile === 'off' ? c.ink3 : c.invink} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={17} w={700} ls={-0.02} lh={1.2} accessibilityRole="header">{name}</T>
          <T size={12.5} color={c.ink2}>{sub}</T>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('map.a11y.close')} hitSlop={6}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={18} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chips.map(x => (
          <View key={x.t} style={{ height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c[DOT[x.dot]] }} />
            <T size={11} w={500} mono>{x.t}</T>
          </View>
        ))}
      </View>
      {steps ? (
        <View style={{ gap: 12, paddingVertical: 4, paddingHorizontal: 2 }}>
          {steps.map(s => <Step key={s.t} text={s.t} state={s.s} />)}
        </View>
      ) : null}
      {rows.length ? (
        <View style={{ borderRadius: 16, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {rows.map(([k, v], i) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <T size={12.5} color={c.ink2}>{k}</T>
              <T size={12.5} w={600} align="right" style={{ flexShrink: 1 }}>{v}</T>
            </View>
          ))}
        </View>
      ) : null}
      {failed && o.onConnect ? (
        <Pressable onPress={() => o.onConnect!(p.id)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="error" size={16} color={c.err} />
          <T size={12.5} w={600} color={c.err}>{t('map.retry')}</T>
        </Pressable>
      ) : null}
      {btn ? (
        <Pressable onPress={btn.onPress} disabled={!btn.onPress} accessibilityRole="button" accessibilityState={{ disabled: !btn.onPress }}
          style={({ pressed }) => ({ height: 48, borderRadius: 24, backgroundColor: btnBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
          <Icon name={btn.icon} size={19} color={btnFg} />
          <T size={14.5} w={650} color={btnFg}>{btn.t}</T>
        </Pressable>
      ) : null}
      {how ? <T size={12} lh={1.45} color={c.ink2} align="center">{how}</T> : null}
    </View>
  );
}

/** Etapa: feita (✓), agora (gira, 0,9 s; parada com "reduzir movimento") ou esperando. */
function Step({ text, state }: { text: string; state: 'done' | 'now' | 'wait' }) {
  const { c, reduceMotion } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'now' || reduceMotion) return;
    const l = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [state, reduceMotion, spin]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {state === 'done' ? (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={15} color={c.invink} /></View>
      ) : state === 'now' ? (
        <Animated.View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.bg3, borderTopColor: c.ink, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
      ) : (
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.line2 }} />
      )}
      <T size={13.5} w={state === 'now' ? 620 : 450} color={state === 'wait' ? c.ink3 : c.ink} accessibilityState={{ busy: state === 'now' }}>{text}</T>
    </View>
  );
}

/** Aviso rápido: sobe 16 px + fade (240 ms), fica 2,5 s, sai em 200 ms. */
function MapToast({ text }: { text: string | null }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    setShown(text);
    if (reduceMotion) { v.setValue(1); const id = setTimeout(() => setShown(null), 2900); return () => clearTimeout(id); }
    v.setValue(0);
    const a = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(v, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    a.start(({ finished }) => { if (finished) setShown(null); });
    return () => a.stop();
  }, [text, reduceMotion, v]);
  if (!shown) return null;
  return (
    <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" pointerEvents="none"
      style={{ position: 'absolute', left: 16, right: 16, top: 56, zIndex: 6, alignSelf: 'center', maxWidth: 420, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.ink,
        flexDirection: 'row', alignItems: 'center', gap: 10, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <Icon name="link" size={19} color={c.invink} />
      <T size={13} w={600} color={c.invink} style={{ flex: 1 }}>{shown}</T>
    </Animated.View>
  );
}
