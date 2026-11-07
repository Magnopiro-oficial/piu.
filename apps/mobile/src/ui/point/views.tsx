/**
 * Telas do ponto Piu (design "Piu 13", P1–P9) como componentes de apresentação: recebem tudo por props.
 * As rotas em src/app/point/* ligam estes componentes a state/point.tsx; a galeria de desenvolvimento
 * (src/app/dev-pontos.tsx, só em __DEV__) mostra cada id com dados de exemplo.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Image, Platform, Pressable, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { fmtNumber, useT } from '../../i18n';
import { fmtBytes } from '../../lib/networkCore';
import { groupId, signalBars, type PointCheckView, type PointLevel, type ScannedNet, isPiuSsid } from '../../lib/pointCore';
import { qrMatrix, qrPath } from '../../lib/pointPoster';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { Toggle } from '../Controls';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';
import { Badge, Bar, Body, KV, ListBox, Mono, NavRow, OutlineBtn, PulseDot, Radio, ResultRow, Shake, SmallBtn, Spinner, StateCard, StateDot, StepTitle, Stepper } from './parts';

const ICON = require('../../../assets/icon.png');

/** 256 MB, 1 GB, 2 GB… */
export const fmtSpace = (mb: number) => (mb >= 1024 ? `${fmtNumber(Math.round((mb / 1024) * 10) / 10)} GB` : `${mb} MB`);

const LEVEL_KEY = { multiplier: 'point.level.mult', guardian: 'point.level.guard', guardianApp: 'point.level.app', gateway: 'point.level.gw' } as const;
export const useLevelName = () => { const t = useT(); return (l: PointLevel) => t(LEVEL_KEY[l]); };

// ── P1 · Wi-Fi local em Rede ─────────────────────────────

export type LanRowState =
  | { kind: 'on'; net: string | null; peers: number }
  | { kind: 'starting' } | { kind: 'noWifi' } | { kind: 'low'; net: string | null; peers: number } | { kind: 'isolated' }
  | { kind: 'userOff' } | { kind: 'unavailable' } | { kind: 'waiting' };

/** Linha "Wi-Fi local" da lista de transportes (mesmo estilo das outras linhas da aba Rede). */
export function LanRowView({ name, state, on, onToggle, onWhy, first }: { name: string; state: LanRowState; on: boolean; onToggle: () => void; onWhy: () => void; first?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const sub = (() => {
    switch (state.kind) {
      case 'on': return state.net ? t('point.lan.on', { count: state.peers, net: state.net }) : t('point.lan.onNoName', { count: state.peers });
      case 'low': return t('point.lan.low');
      case 'starting': return t('point.lan.starting');
      case 'noWifi': return t('point.lan.noWifi');
      case 'isolated': return t('point.lan.isolated');
      case 'userOff': return t('point.lan.userOff');
      case 'unavailable': return t('point.lan.unavailable');
      case 'waiting': return t('point.lan.waiting');
    }
  })();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="router" size={20} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} w={550}>{name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {state.kind === 'on' ? <PulseDot /> : null}
          <T size={12.5} lh={1.35} color={c.ink2} style={{ flexShrink: 1 }} accessibilityLiveRegion="polite">{sub}</T>
        </View>
      </View>
      {state.kind === 'isolated'
        ? <Pressable onPress={onWhy} accessibilityRole="button" accessibilityLabel={t('point.lan.why')}
            style={{ height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, alignItems: 'center', justifyContent: 'center' }}>
            <T size={13} w={600}>{t('point.lan.why')}</T>
          </Pressable>
        : <Toggle on={on} onChange={onToggle} label={name} disabled={state.kind === 'unavailable'} />}
    </View>
  );
}

/** Seção "PONTOS PIU" da aba Rede: criar, ou o ponto deste celular. */
export function PointsRow({ point, onPress }: { point: { name: string; level: PointLevel; paused: boolean } | null; onPress: () => void }) {
  const t = useT();
  const level = useLevelName();
  return (
    <ListBox>
      {point
        ? <NavRow first icon="location_on" title={point.name} sub={t(point.paused ? 'point.row.paused' : 'point.row.active', { level: level(point.level) })} onPress={onPress} />
        : <NavRow first icon="add_location_alt" title={t('point.create')} sub={t('point.create.sub')} onPress={onPress} />}
    </ListBox>
  );
}

// ── P2 · início ──────────────────────────────────────────

export function IntroView({ onStart, onLater, available }: { onStart: () => void; onLater: () => void; available: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const items: [IconName, string, string][] = [
    ['device_hub', t('point.intro.mult'), t('point.intro.mult.d')],
    ['inventory_2', t('point.intro.guard'), t('point.intro.guard.d')],
    ['tune', t('point.intro.control'), t('point.intro.control.d')],
    ['visibility_off', t('point.intro.privacy'), t('point.intro.privacy.d')],
  ];
  return (
    <Body footer={
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <Icon name="toll" size={16} color={c.ink2} />
          <T size={12.5} color={c.ink2}>{available ? t('point.intro.foot') : t('point.intro.unavailable')}</T>
        </View>
        <View style={{ gap: 6 }}>
          <Button label={t('point.intro.start')} onPress={onStart} disabled={!available} />
          <Button label={t('point.intro.later')} variant="ghost" height={44} onPress={onLater} />
        </View>
      </View>
    }>
      <StepTitle step={t('point.title')} title={t('point.intro.title')} sub={t('point.intro.sub')} />
      <View>
        {items.map(([icon, title, d]) => (
          <View key={icon} style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={21} w={300} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <T size={15} w={600}>{title}</T>
              <T size={13.5} lh={1.38} color={c.ink2}>{d}</T>
            </View>
          </View>
        ))}
      </View>
    </Body>
  );
}

// ── P3 · escolher a rede ─────────────────────────────────

const BARS: IconName[] = ['wifi_1_bar', 'wifi_2_bar', 'wifi', 'wifi'];

export function NetworkView(p: {
  current: { connected: boolean; ssid: string | null };
  selected: 'current' | 'hotspot' | null;
  separated: boolean; onSeparated: (v: boolean) => void;
  onPickCurrent: () => void;
  nearby: ScannedNet[]; nearbyNote: string | null; onNearby: (n: ScannedNet) => void;
  hotspot: { on: boolean; ssid: string | null; busy: boolean; error: string | null; available: boolean };
  onHotspot: () => void;
  onTest: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const cur = p.current;
  return (
    <Body footer={
      <View style={{ gap: 16 }}>
        <T size={13} lh={1.45} color={c.ink2}>{t('point.net.foot')}</T>
        <Button label={t('point.net.test')} onPress={p.onTest} disabled={!p.selected} />
      </View>
    }>
      <StepTitle step={t('point.step', { n: 1, total: 4 })} title={t('point.net.title')} />
      <Mono>{t('point.net.current')}</Mono>
      <View style={{ paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
        <Pressable onPress={cur.connected ? p.onPickCurrent : undefined} disabled={!cur.connected} accessibilityRole="radio" accessibilityState={{ checked: p.selected === 'current', disabled: !cur.connected }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
          <Radio on={p.selected === 'current'} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15} w={600}>{cur.connected ? cur.ssid ?? t('point.net.unknownName') : t('point.net.noWifi')}</T>
            <T size={12.5} color={c.ink2}>{cur.connected ? (cur.ssid ? t('point.net.connected') : t('point.net.hiddenName')) : t('point.net.noWifi.d')}</T>
          </View>
          <Icon name={cur.connected ? 'wifi' : 'wifi_off'} size={20} />
        </Pressable>
        {cur.connected && p.selected === 'current' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T size={14} w={550}>{t('point.net.separated')}</T>
              <T size={12.5} lh={1.35} color={c.ink2}>{t('point.net.separated.d')}</T>
            </View>
            <Toggle on={p.separated} onChange={() => p.onSeparated(!p.separated)} label={t('point.net.separated')} />
          </View>
        ) : null}
      </View>
      <Mono>{t('point.net.nearby')}</Mono>
      <View>
        {p.nearby.map((n, i) => (
          <Pressable key={n.ssid} onPress={() => p.onNearby(n)} accessibilityRole="button" accessibilityLabel={n.ssid}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.line2 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15} w={600} numberOfLines={1}>{n.ssid}</T>
              <T size={12.5} color={c.ink2}>{isPiuSsid(n.ssid) ? t('point.net.piuPoint') : n.secure ? t('point.net.secured') : t('point.net.open')}</T>
            </View>
            <Icon name={BARS[signalBars(n.level)]!} size={20} />
          </Pressable>
        ))}
        {p.nearbyNote ? <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingVertical: 6 }}>{p.nearbyNote}</T> : null}
      </View>
      <Shake trigger={p.hotspot.error}>
        <ListBox>
          <NavRow first icon="wifi_tethering" title={t('point.net.hotspot')}
            sub={p.hotspot.error ?? (p.hotspot.on ? (p.hotspot.ssid ? t('point.net.hotspotOn', { ssid: p.hotspot.ssid }) : t('point.net.hotspotOnNoName')) : t('point.net.hotspot.d'))}
            right={p.hotspot.busy ? <Spinner /> : p.selected === 'hotspot' ? <Radio on /> : undefined}
            onPress={p.hotspot.available && !p.hotspot.busy ? p.onHotspot : undefined} />
        </ListBox>
      </Shake>
    </Body>
  );
}

// ── P4 · teste automático ────────────────────────────────

export type StepKey = 'peers' | 'home' | 'internet' | 'capacity';
const STEPS: StepKey[] = ['peers', 'home', 'internet', 'capacity'];
const STEP_LABEL = { peers: 'point.test.s.peers', home: 'point.test.s.home', internet: 'point.test.s.internet', capacity: 'point.test.s.capacity' } as const;
const STEP_MS = 1100;

/** Texto curto de cada etapa a partir do resultado real. */
export function stepSubs(v: PointCheckView, t: ReturnType<typeof useT>, hotspot: boolean): Record<StepKey, { state: 'ok' | 'warn' | 'bad'; sub: string }> {
  const row = (k: string) => v.rows.find(r => r.key === k);
  const iso = row('isolation'), lanOff = row('lanOff');
  const peers = iso ? { state: 'warn' as const, sub: t('point.test.isolation') }
    : lanOff ? { state: 'warn' as const, sub: t('point.test.lanOff') }
    : v.peers > 0 ? { state: 'ok' as const, sub: t('point.test.peers.n', { count: v.peers }) } : { state: 'warn' as const, sub: t('point.test.peers.none') };
  const homeBad = row('homeNetwork') ?? (row('home')?.state === 'bad' ? row('home') : undefined);
  const home = homeBad ? { state: 'bad' as const, sub: homeBad.key === 'homeNetwork' ? t('point.test.home.network') : t('point.test.home.bad') }
    : row('routerAdmin') ? { state: 'warn' as const, sub: t('point.test.router') }
    : { state: 'ok' as const, sub: hotspot ? t('point.test.home.hotspot') : t('point.test.home.ok') };
  const internet = { state: 'ok' as const, sub: v.internet ? t('point.test.internet.yes') : t('point.test.internet.no') };
  const capacity = { state: 'ok' as const, sub: v.subnet ? t('point.test.capacity.n', { count: v.subnet }) : t('point.test.capacity.unknown') };
  return { peers, home, internet, capacity };
}

/**
 * P4: as 4 etapas andam uma a cada 1,1 s enquanto o teste real roda (o spinner percorre as etapas);
 * quando o resultado chega, cada etapa mostra o que foi medido, uma a cada 1,1 s, e o resultado
 * (P4a–c) acende no fim. Com "reduzir movimento", tudo aparece de uma vez.
 */
export function TestView(p: {
  net: string; running: boolean; view: PointCheckView | null; error: string | null; hotspot: boolean;
  onContinue: () => void; onRetry: () => void; onAltRouter: () => void; onAltHotspot: () => void;
  /** Galeria: congela a animação numa etapa. */
  freezeAt?: number;
}) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const [tick, setTick] = useState(p.freezeAt ?? 0);
  const [shown, setShown] = useState(p.view && (reduceMotion || p.freezeAt === undefined) ? STEPS.length : 0);
  useEffect(() => {
    if (p.freezeAt !== undefined) return;
    if (p.running) { setShown(0); setTick(0); const iv = setInterval(() => setTick(x => Math.min(x + 1, STEPS.length - 1)), STEP_MS); return () => clearInterval(iv); }
    if (!p.view) return;
    if (reduceMotion) { setShown(STEPS.length); return; }
    setShown(0);
    let i = 0;
    const iv = setInterval(() => { i += 1; setShown(i); if (i >= STEPS.length) clearInterval(iv); }, STEP_MS);
    return () => clearInterval(iv);
  }, [p.running, p.view, reduceMotion, p.freezeAt]);
  const subs = p.view ? stepSubs(p.view, t, p.hotspot) : null;
  const total = STEPS.length;
  const doneN = p.view ? shown : 0;
  const ready = !!p.view && doneN >= total;
  const runIdx = p.view ? doneN : p.running || p.freezeAt !== undefined ? tick : -1;
  const pct = p.view ? (doneN / total) * 100 : p.running || p.freezeAt !== undefined ? (tick / total) * 100 : 0;
  const status = ready ? t('point.test.done') : p.error ? t('point.test.error', { msg: p.error }) : t('point.test.status', { n: Math.min(runIdx + 1, total), total });
  const bar = useRef(new Animated.Value(pct)).current;
  useEffect(() => { Animated.timing(bar, { toValue: pct, duration: reduceMotion ? 0 : 400, useNativeDriver: false }).start(); }, [pct, reduceMotion, bar]);

  const v = p.view;
  return (
    <Body footer={ready && v ? <ResultCard view={v} hotspot={p.hotspot} onContinue={p.onContinue} onRetry={p.onRetry} onAltRouter={p.onAltRouter} onAltHotspot={p.onAltHotspot} inline /> : p.error ? <Button label={t('point.test.retry')} onPress={p.onRetry} /> : null}>
      <StepTitle step={t('point.step', { n: 2, total: 4 })} title={t('point.test.title', { net: p.net })} />
      <T size={15} lh={1.45} color={c.ink2} style={{ marginTop: -7 }} accessibilityLiveRegion="polite">{status}</T>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.bg3, overflow: 'hidden' }}>
        <Animated.View style={{ height: '100%', borderRadius: 3, backgroundColor: c.ink, width: bar.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
      </View>
      <View>
        {STEPS.map((k, i) => {
          // Rodando: as medições correm juntas, então as etapas já iniciadas ficam todas em "Testando…".
          const done = i < doneN, run = !done && (p.view ? i === runIdx : i <= runIdx), wait = !done && !run;
          const r = subs?.[k];
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line, opacity: wait ? 0.45 : 1 }}>
              <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                {done && r ? (r.state === 'ok' ? <Icon name="check_circle" size={22} fill /> : <StateDot state={r.state} />) : run ? <Spinner /> : <Icon name="radio_button_unchecked" size={22} color={c.ink3} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={15} w={600}>{t(STEP_LABEL[k])}</T>
                <T size={12.5} color={c.ink2}>{done && r ? r.sub : run ? t('point.test.testing') : t('point.test.waiting')}</T>
              </View>
            </View>
          );
        })}
      </View>
    </Body>
  );
}

/** Resultado do teste: P4a verde, P4b amarelo (com instrução), P4c vermelho (bloqueia: só alternativas). */
export function ResultCard({ view: v, hotspot, onContinue, onRetry, onAltRouter, onAltHotspot, inline }: {
  view: PointCheckView; hotspot: boolean; onContinue: () => void; onRetry: () => void; onAltRouter: () => void; onAltHotspot: () => void; inline?: boolean;
}) {
  const t = useT();
  const { c } = useTheme();
  const subs = stepSubs(v, t, hotspot);
  if (v.verdict === 'green') {
    if (inline) return (
      <View style={{ gap: 10 }}>
        <View style={{ paddingVertical: 13, paddingHorizontal: 15, borderRadius: 18, backgroundColor: c.bg2, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Icon name="check_circle" size={22} fill />
          <T size={14} w={600}>{t('point.test.greenBox')}</T>
        </View>
        <Button label={t('common.continue')} onPress={onContinue} />
      </View>
    );
    return (
      <StateCard icon="check_circle" inv title={t('point.test.green')} body={t('point.test.green.d')} actions={<SmallBtn primary label={t('common.continue')} onPress={onContinue} />}>
        <View>
          <ResultRow state="ok" title={t('point.test.s.peers')} />
          <ResultRow state="ok" title={t('point.test.s.home')} />
          <ResultRow state="ok" title={t('point.test.s.internet')} sub={subs.internet.sub} />
          <ResultRow state="ok" title={t('point.test.s.capacity')} sub={subs.capacity.sub} />
        </View>
      </StateCard>
    );
  }
  if (v.verdict === 'yellow') {
    const iso = v.rows.some(r => r.key === 'isolation');
    const warns = v.rows.filter(r => r.state === 'warn');
    const homeOk = v.rows.some(r => r.key === 'home' && r.state === 'ok');
    return (
      <StateCard icon="warning" title={t('point.test.yellow')} body={iso ? t('point.test.yellow.iso') : t('point.test.yellow.d')}
        actions={<><SmallBtn label={t('point.test.retry')} onPress={onRetry} /><SmallBtn primary label={t('point.test.continueAnyway')} onPress={onContinue} /></>}>
        <View>
          {homeOk ? <ResultRow state="ok" title={t('point.test.s.home')} sub={hotspot ? t('point.test.home.hotspot') : undefined} /> : null}
          {warns.map(r => (
            r.key === 'isolation' ? <ResultRow key={r.key} state="warn" title={t('point.test.isolation')} sub={t('point.test.isolation.d')} />
              : r.key === 'routerAdmin' ? <ResultRow key={r.key} state="warn" title={t('point.test.router')} sub={t('point.test.router.d')} />
              : r.key === 'lanOff' ? <ResultRow key={r.key} state="warn" title={t('point.test.lanOff')} sub={t('point.test.lanOff.d')} />
              : <ResultRow key={r.key} state="warn" title={t('point.test.peers.none')} sub={t('point.test.peers.none.d')} />
          ))}
        </View>
      </StateCard>
    );
  }
  const noWifi = v.rows.some(r => r.key === 'noWifi');
  const homeNet = v.rows.find(r => r.key === 'homeNetwork');
  const homeBad = v.rows.find(r => r.key === 'home' && r.state === 'bad');
  return (
    <StateCard icon="gpp_bad" inv title={t('point.test.red')} body={noWifi ? t('point.test.red.noWifi') : t('point.test.red.d')}>
      <View>
        {homeNet ? <ResultRow state="bad" title={t('point.test.home.network')} sub={t('point.test.home.network.d')} /> : null}
        {homeBad ? <ResultRow state="bad" title={t('point.test.home.bad')} sub={t('point.test.home.bad.d', { count: homeBad.count ?? 1 })} /> : null}
      </View>
      <Mono>{t('point.test.alternatives')}</Mono>
      <ListBox>
        <NavRow first icon="router" title={t('point.test.alt.router')} sub={t('point.test.alt.router.d')} onPress={onAltRouter} />
        <NavRow icon="wifi_tethering" title={t('point.test.alt.hotspot')} sub={t('point.test.alt.hotspot.d')} onPress={onAltHotspot} />
      </ListBox>
    </StateCard>
  );
}

// ── P5 · nível ───────────────────────────────────────────

export function LevelView(p: {
  level: PointLevel; spaceMb: number; days: number; internet: boolean;
  onLevel: (l: PointLevel) => void; onSpace: (dir: 1 | -1) => void; onDays: (dir: 1 | -1) => void;
  onContinue: () => void; cta?: string; step?: boolean;
}) {
  const { c } = useTheme();
  const t = useT();
  const stores = p.level !== 'multiplier';
  const opts: [PointLevel, string, string, boolean][] = [
    ['multiplier', t('point.level.mult'), t('point.level.mult.d'), true],
    ['guardian', t('point.level.guard'), t('point.level.guard.d'), true],
    ['guardianApp', t('point.level.app'), t('point.level.app.d'), true],
    ['gateway', t('point.level.gw'), p.internet ? t('point.level.gw.d') : t('point.level.gw.noInternet'), p.internet],
  ];
  return (
    <Body gap={12} footer={
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, gap: 2 }}>
            <T size={12} color={c.ink2}>{t('point.level.battery')}</T>
            <T size={15} w={650}>{t('point.level.batteryV')}</T>
          </View>
          <View style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, gap: 2 }}>
            <T size={12} color={c.ink2}>{t('point.level.space')}</T>
            <T size={15} w={650}>{stores ? t('point.level.upTo', { size: fmtSpace(p.spaceMb) }) : t('point.level.nothing')}</T>
          </View>
        </View>
        <Button label={p.cta ?? t('common.continue')} onPress={p.onContinue} />
      </View>
    }>
      {p.step !== false ? <StepTitle step={t('point.step', { n: 3, total: 4 })} title={t('point.level.title')} /> : <StepTitle title={t('point.level.title')} />}
      <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
        {opts.map(([k, name, d, enabled]) => {
          const on = p.level === k;
          const showLimits = on && (k === 'guardian' || k === 'guardianApp' || k === 'gateway');
          return (
            <Pressable key={k} onPress={enabled ? () => p.onLevel(k) : undefined} disabled={!enabled} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !enabled }}
              style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.line2, gap: 10, opacity: enabled ? 1 : 0.45, margin: on ? 0 : 0.5 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <Radio on={on} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15} w={650}>{name}</T>
                  <T size={12.5} lh={1.35} color={c.ink2}>{d}</T>
                </View>
              </View>
              {showLimits ? (
                <>
                  <Stepper label={t('point.level.space')} value={fmtSpace(p.spaceMb)} onMinus={() => p.onSpace(-1)} onPlus={() => p.onSpace(1)} a11y={{ minus: t('point.level.minus'), plus: t('point.level.plus') }} />
                  <Stepper label={t('point.level.days')} value={t('point.level.daysN', { count: p.days })} onMinus={() => p.onDays(-1)} onPlus={() => p.onDays(1)} a11y={{ minus: t('point.level.minus'), plus: t('point.level.plus') }} />
                </>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Body>
  );
}

// ── P6o · antes de ativar ────────────────────────────────

export function ActivateView(p: {
  net: string; level: PointLevel; spaceMb: number; days: number; gateway: boolean;
  name: string; onName: (s: string) => void; namePlaceholder: string;
  qr: { hotspot: boolean; ssid: string; onSsid: (s: string) => void; open: boolean; onOpen: (v: boolean) => void; password: string; onPassword: (s: string) => void; passError: boolean };
  onActivate: () => void; busy: boolean; error: string | null;
}) {
  const { c } = useTheme();
  const t = useT();
  const level = useLevelName();
  const stores = p.level !== 'multiplier';
  const input = { height: 50, borderRadius: 14, backgroundColor: c.bg2, paddingHorizontal: 14, fontSize: 15, color: c.ink, fontFamily: Platform.OS === 'web' ? 'Geist, system-ui' : undefined } as const;
  return (
    <Body footer={
      <View style={{ gap: 10 }}>
        {p.error ? <Shake trigger={p.error}><T size={13} color={c.ink2} align="center">{p.error}</T></Shake> : null}
        <Button label={t('point.act.go')} onPress={p.onActivate} disabled={p.busy || p.qr.passError} />
      </View>
    }>
      <StepTitle step={t('point.step', { n: 4, total: 4 })} title={t('point.act.title')} />
      <KV rows={[
        [t('point.act.net'), p.net],
        [t('point.act.level'), level(p.level)],
        [t('point.act.space'), stores ? t('point.act.spaceV', { size: fmtSpace(p.spaceMb), days: t('point.level.daysN', { count: p.days }) }) : t('point.level.nothing')],
        [t('point.act.internet'), p.gateway ? t('point.act.internetGw') : t('point.act.internetOff')],
        [t('point.act.rewards'), t('point.act.rewardsOff')],
      ]} />
      <View style={{ gap: 6 }}>
        <Mono>{t('point.act.name')}</Mono>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 14, backgroundColor: c.bg2, paddingLeft: 14 }}>
          <T size={15} w={550}>Piu · </T>
          <TextInput value={p.name} onChangeText={p.onName} placeholder={p.namePlaceholder} placeholderTextColor={c.ink3} maxLength={40} accessibilityLabel={t('point.act.name')}
            style={{ flex: 1, height: 50, fontSize: 15, fontWeight: '550' as never, color: c.ink, paddingRight: 14 }} />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Mono>{t('point.act.qr')}</Mono>
        {p.qr.hotspot
          ? <T size={13} lh={1.4} color={c.ink2}>{t('point.act.hotspotQr')}</T>
          : <>
            <TextInput value={p.qr.ssid} onChangeText={p.qr.onSsid} placeholder={t('point.act.ssid')} placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('point.act.ssid')} style={input} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
              <T size={14} w={550} style={{ flex: 1 }}>{t('point.act.open')}</T>
              <Toggle on={p.qr.open} onChange={() => p.qr.onOpen(!p.qr.open)} label={t('point.act.open')} />
            </View>
            {!p.qr.open ? <TextInput value={p.qr.password} onChangeText={p.qr.onPassword} placeholder={t('point.act.pass')} placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false} secureTextEntry accessibilityLabel={t('point.act.pass')} style={input} /> : null}
            <T size={12.5} lh={1.35} color={p.qr.passError ? c.ink : c.ink2}>{p.qr.passError ? t('point.act.passInvalid') : t('point.act.passHint')}</T>
          </>}
      </View>
      <View style={{ paddingVertical: 13, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1, borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
        <Icon name="key" size={20} w={300} />
        <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{t('point.act.key')}</T>
      </View>
    </Body>
  );
}

// ── QR (P6, P6c) ─────────────────────────────────────────

/** QR com o texto em UTF-8 (lib/pointPoster.ts), preto no branco com margem de 1 módulo (como o design). */
export function PointQr({ value, size, label }: { value: string; size: number; label: string }) {
  const m = qrMatrix(value);
  const n = m.length;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, backgroundColor: '#ffffff' }}>
      <Svg width={size} height={size} viewBox={`-1 -1 ${n + 2} ${n + 2}`}>
        <Rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#ffffff" />
        <Path d={qrPath(m)} fill="#0c0c0c" />
      </Svg>
    </View>
  );
}

export function QrView(p: { name: string; ssid: string | null; qr: string | null; onShare: () => void; onPoster: () => void; onPanel: () => void; sharing: boolean }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Body footer={
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <OutlineBtn icon="ios_share" label={t('point.qr.share')} onPress={p.onShare} disabled={p.sharing} />
          <OutlineBtn icon="print" label={t('point.qr.poster')} onPress={p.onPoster} />
        </View>
        <Button label={t('point.qr.panel')} onPress={p.onPanel} />
      </View>
    }>
      <StepTitle step={t('point.step', { n: 4, total: 4 })} title={t('point.qr.title')} sub={t('point.qr.sub')} />
      <View style={{ alignSelf: 'center', padding: 20, borderRadius: 28, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, alignItems: 'center', gap: 12 }}>
        {p.qr ? <PointQr value={p.qr} size={200} label={t('point.qr.a11y', { name: p.name })} /> : <T size={13} lh={1.4} color={c.ink2} align="center" style={{ maxWidth: 220 }}>{t('point.qr.none')}</T>}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <T size={17} w={700} ls={-0.02}>{p.name}</T>
          {p.ssid ? <T size={12} w={500} mono color={c.ink2}>{t('point.qr.wifi', { ssid: p.ssid })}</T> : null}
        </View>
      </View>
    </Body>
  );
}

/** P6c: cartaz (proporção A4) como aparece; o PDF (lib/pointPoster.ts) segue o mesmo desenho. */
export function PosterCard(p: { name: string; qr: string | null; id: string; footerUrl: string | null }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ borderRadius: 24, backgroundColor: '#ffffff', borderWidth: 1, borderColor: c.line2, aspectRatio: 1 / 1.414, paddingVertical: 24, paddingHorizontal: 24, alignItems: 'center', gap: 12 }}>
      <Image source={ICON} style={{ width: 52, height: 52, borderRadius: 14 }} accessibilityIgnoresInvertColors />
      <T size={28} w={700} ls={-0.045} lh={1.05} align="center" color="#0c0c0c">{`${t('point.poster.t1')}\n${t('point.poster.t2')}`}</T>
      <T size={13} lh={1.4} color="#5f5f5c" align="center" style={{ maxWidth: 240 }}>{t('point.poster.sub')}</T>
      {p.qr ? <PointQr value={p.qr} size={150} label={t('point.qr.a11y', { name: p.name })} /> : null}
      <T size={15} w={650} color="#0c0c0c" align="center">{p.name}</T>
      <View style={{ flex: 1 }} />
      <T size={10.5} w={500} mono color="#5f5f5c" align="center">{t('point.poster.id', { id: groupId(p.id) })}</T>
      {p.footerUrl ? <T size={10.5} w={500} mono color="#5f5f5c" align="center">{t('point.poster.noApp', { url: p.footerUrl })}</T> : null}
    </View>
  );
}

export function PosterView(p: { name: string; qr: string | null; id: string; footerUrl: string | null; onPrint: () => void; busy: boolean; error: string | null }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Body footer={
      <View style={{ gap: 10 }}>
        {p.error ? <Shake trigger={p.error}><T size={13} color={c.ink2} align="center">{p.error}</T></Shake> : null}
        <Button label={t('point.poster.print')} onPress={p.onPrint} disabled={p.busy || !p.qr} left={<Icon name="print" size={20} color={c.invink} />} />
      </View>
    }>
      <PosterCard {...p} />
      <T size={13} lh={1.45} color={c.ink2}>{t('point.poster.note')}</T>
    </Body>
  );
}

// ── P7 · painel ──────────────────────────────────────────

export interface PanelData {
  name: string; level: PointLevel; net: string; paused: boolean;
  health: 'ok' | 'paused' | 'netDown' | 'isolating';
  peersToday: number; delivered: number | null; stored: number | null; relayed: number;
  storedBytes: number | null; spaceBytes: number; dataToday: number | null; dataCap: number;
  pageUrl: string | null; pageError: boolean;
}

export function PanelView({ d, onQr, onLevel, onPause, onResume, onEnd, onRetest }: {
  d: PanelData; onQr: () => void; onLevel: () => void; onPause: () => void; onResume: () => void; onEnd: () => void; onRetest: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const level = useLevelName();
  const num = (v: number | null) => (v === null ? '—' : fmtNumber(v));
  const tiles: [string, string][] = [
    [num(d.peersToday), t('point.panel.peers')], [num(d.delivered), t('point.panel.proofs')],
    [num(d.stored), t('point.panel.stored')], [num(d.relayed), t('point.panel.relayed')],
  ];
  const stores = d.level !== 'multiplier';
  return (
    <Body gap={14} footer={
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {d.paused ? <OutlineBtn icon="play_arrow" label={t('point.panel.resume')} onPress={onResume} /> : <OutlineBtn icon="pause" label={t('point.panel.pause')} onPress={onPause} />}
        <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel={t('point.panel.end')} style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <T size={16} w={600}>{t('point.panel.end')}</T>
        </Pressable>
      </View>
    }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {d.health === 'ok' ? <PulseDot /> : <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: c.ink }} />}
        <T size={14} w={600} style={{ flexShrink: 1 }}>{`${d.paused ? t('point.panel.paused') : t('point.panel.active')} · ${level(d.level)} · ${d.net}`}</T>
      </View>
      {d.health === 'paused' ? <StateCard icon="pause" title={t('point.panel.pausedTitle')} body={t('point.panel.paused.d')} actions={<SmallBtn primary label={t('point.panel.resume')} onPress={onResume} />} /> : null}
      {d.health === 'netDown' ? <StateCard icon="wifi_off" inv title={t('point.panel.down', { net: d.net })} body={t('point.panel.down.d')} /> : null}
      {d.health === 'isolating' ? <StateCard icon="router" inv title={t('point.panel.iso')} body={t('point.panel.iso.d')} actions={<SmallBtn primary label={t('point.test.retry')} onPress={onRetest} />} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tiles.map(([v, l]) => (
          <View key={l} style={{ flexBasis: '47%', flexGrow: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.bg2, gap: 2 }}>
            <T size={22} w={700} ls={-0.03} tabular>{v}</T>
            <T size={12} color={c.ink2}>{l}</T>
          </View>
        ))}
      </View>
      <View style={{ gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.line2 }}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T size={13.5}>{t('point.panel.space')}</T>
            <T size={12} w={500} mono color={c.ink2}>{stores ? t('point.panel.spaceV', { used: d.storedBytes === null ? '—' : fmtBytes(d.storedBytes), total: fmtBytes(d.spaceBytes) }) : t('point.level.nothing')}</T>
          </View>
          <Bar pct={stores && d.storedBytes !== null && d.spaceBytes ? (d.storedBytes / d.spaceBytes) * 100 : 0} />
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <T size={13.5}>{t('point.panel.data')}</T>
            <T size={12} w={500} mono color={c.ink2} style={{ flexShrink: 1 }} align="right">{t('point.panel.dataV', { used: d.dataToday === null ? '—' : fmtBytes(d.dataToday), total: fmtBytes(d.dataCap) })}</T>
          </View>
          <Bar pct={d.dataToday !== null && d.dataCap ? (d.dataToday / d.dataCap) * 100 : 0} />
        </View>
      </View>
      <ListBox>
        <NavRow first icon="toll" title={t('point.panel.rewards')} sub={t('point.panel.rewards.d')} right={<Badge>{t('point.panel.rewards.off')}</Badge>} />
        <NavRow icon="qr_code_2" title={t('point.panel.qr')} onPress={onQr} />
        <NavRow icon="tune" title={t('point.panel.level')} onPress={onLevel} />
        {d.level === 'guardianApp' ? <NavRow icon="download" title={t('point.panel.page')} sub={d.pageUrl ?? (d.pageError ? t('point.panel.pageErr') : '…')} right={null} /> : null}
      </ListBox>
    </Body>
  );
}

/** P7d: confirmar encerrar (carta sobre o fundo escurecido). */
export function EndCard({ name, stored, onCancel, onEnd, busy }: { name: string; stored: number | null; onCancel: () => void; onEnd: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <StateCard icon="delete_forever" inv title={t('point.panel.endTitle', { name })} body={stored ? t('point.panel.end.d', { count: stored }) : t('point.panel.end.dNone')}
      actions={<><SmallBtn label={t('common.cancel')} onPress={onCancel} /><SmallBtn primary label={t('point.panel.endGo')} onPress={onEnd} disabled={busy} /></>} />
  );
}

// ── P8 · visitante ───────────────────────────────────────

/** Conteúdo da folha P8 (a moldura é ui/Sheet.tsx no app e uma caixa na galeria). */
export function VisitorSheetBody({ name, ssid, onJoin, onLater, joining, error }: { name: string; ssid: string; onJoin: () => void; onLater: () => void; joining: boolean; error: string | null }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const l = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 2400, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [reduceMotion, ring]);
  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 8 }}>
        <View style={{ width: 72, height: 72 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="location_on" size={37} color={c.invink} /></View>
          {!reduceMotion && <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, borderWidth: 2, borderColor: c.ink,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />}
        </View>
        <T size={24} w={700} ls={-0.035} align="center">{t('point.visit.title')}</T>
        <T size={14.5} lh={1.45} color={c.ink2} align="center" style={{ maxWidth: 290 }}>{t('point.visit.body', { name })}</T>
      </View>
      <KV rows={[[t('point.visit.net'), ssid], [t('point.visit.internet'), t('point.visit.internetV')], [t('point.visit.owner'), t('point.visit.ownerV')]]} />
      {error ? <Shake trigger={error}><T size={13} lh={1.4} color={c.ink2} align="center">{error}</T></Shake> : null}
      <View style={{ gap: 6 }}>
        <Button label={joining ? t('point.visit.joining') : t('point.visit.join')} onPress={onJoin} disabled={joining} />
        <Button label={t('point.visit.later')} variant="ghost" height={44} onPress={onLater} />
      </View>
    </View>
  );
}

/** P8n: como a notificação aparece (só na galeria; a real é do sistema, lib/notifications.ts). */
export function NotifPreview({ name }: { name: string }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 22, backgroundColor: '#f1f1ef', flexDirection: 'row', gap: 12, alignItems: 'flex-start', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, shadowOffset: { width: 0, height: 8 } }}>
      <Image source={ICON} style={{ width: 38, height: 38, borderRadius: 10 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={14} w={650} color="#0c0c0c">Piu</T><T size={12} color={c.ink2}>{t('point.notif.now')}</T></View>
        <T size={14} w={550} color="#0c0c0c">{t('point.notif.title')}</T>
        <T size={13.5} color="#5f5f5c">{t('point.notif.body', { name })}</T>
      </View>
    </View>
  );
}

/** P8a: faixa no topo das Conversas enquanto estiver no ponto. */
export function HereBanner({ name, peers, delivered, onPress }: { name: string; peers: number; delivered: number; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('point.here', { name })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.ink }}>
      <Icon name="location_on" size={20} color={c.invink} />
      <View style={{ flex: 1, gap: 1 }}>
        <T size={14} w={600} color={c.invink} numberOfLines={1}>{t('point.here', { name })}</T>
        <T size={12} color={c.invink} style={{ opacity: 0.75 }}>{t('point.here.d', { count: peers, delivered })}</T>
      </View>
      <Icon name="chevron_right" size={20} color={c.invink} />
    </Pressable>
  );
}

/** P8b: saiu do alcance (some sozinha em 5 s). */
export function LeftBanner({ ble, onClose }: { ble: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.bg2 }}>
      <Icon name="location_off" size={20} w={300} />
      <View style={{ flex: 1, gap: 1 }}>
        <T size={14} w={600}>{t('point.left')}</T>
        <T size={12} color={c.ink2}>{ble ? t('point.left.ble') : t('point.left.mesh')}</T>
      </View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10}><Icon name="close" size={18} /></Pressable>
    </View>
  );
}

/** Moldura de carta solta da galeria e de diálogos (raio 24, fio). */
export function CardFrame({ children, pad = 16 }: { children: ReactNode; pad?: number }) {
  const { c } = useTheme();
  return <View style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, padding: pad, gap: 14 }}>{children}</View>;
}
