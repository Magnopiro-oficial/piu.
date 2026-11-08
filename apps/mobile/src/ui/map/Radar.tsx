/**
 * Radar do mapa da rede (desenho Piu 18, 1a): anéis em escala log, "você" no centro com a onda
 * (`mpRing`), marcadores cheios/vazados, pulso do selecionado (`mpSel`), linha "conectando" (`mpDash`)
 * e varredura do radar vazio (`mpSpin`). Com "reduzir movimento": sem onda, pulso e varredura; a linha
 * fica tracejada parada.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../../i18n';
import { layoutPoints, pointA11y, ringsFor, type MapPoint, type PointKind } from '../../lib/networkMap';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';

/** Ícone, tamanho e raio de cada tipo (tabela do spec, §1). */
export const KIND: Record<PointKind, { icon: IconName; s: number; rad: number; is: number; round: boolean }> = {
  pessoa: { icon: 'person', s: 24, rad: 12, is: 14, round: true },
  ponto: { icon: 'router', s: 28, rad: 8, is: 16, round: false },
  wifi: { icon: 'wifi', s: 24, rad: 8, is: 14, round: false },
  gateway: { icon: 'dns', s: 28, rad: 8, is: 16, round: false },
  super: { icon: 'settings_input_antenna', s: 32, rad: 10, is: 18, round: false },
  rnode: { icon: 'settings_input_antenna', s: 24, rad: 12, is: 14, round: true },
  mesh: { icon: 'sensors', s: 24, rad: 12, is: 14, round: true },
};

const NOT_A11Y = Platform.OS === 'web' ? ({ 'aria-hidden': true } as object) : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };
/** Alvo de toque de 44 px em volta de marcadores de 24–32 px. */
const HIT = 44;
const LABEL_W = 120;

const EASE_OUT = Easing.out(Easing.quad);
const LINEAR = Easing.linear;

/** Loop de 0 a 1 (onda, pulso, linha). Parado em `still`. */
function useLoop(ms: number, still: boolean, easing: (v: number) => number = EASE_OUT) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) { v.setValue(0); return; }
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [ms, still, v, easing]);
  return v;
}

export interface Edge { to: string; kind: 'flow' | 'solid' }

export function Radar({ points, selected, onSelect, lora, offline, sweep, edge, align, paused, showLabels = true }: {
  points: MapPoint[]; selected: string | null; onSelect: (id: string | null) => void;
  /** Rádio LoRa conectado: anel de 5 km. */
  lora: boolean; offline: boolean;
  /** Radar vazio: varredura girando. */
  sweep: boolean;
  edge: Edge | null;
  /** Com a folha aberta no celular, o radar sobe (`flex-start`). */
  align: 'center' | 'flex-start';
  /** Fora da tela: a varredura pausa. */
  paused?: boolean;
  showLabels?: boolean;
}) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => { const { width: w, height: h } = e.nativeEvent.layout; if (w !== box.w || h !== box.h) setBox({ w, h }); };
  const size = Math.max(0, Math.min(box.w, box.h) - 16);
  const rings = useMemo(() => ringsFor({ lora, offline }), [lora, offline]);
  const placed = useMemo(() => layoutPoints(points), [points]);
  const still = reduceMotion || !!paused;
  const wave = useLoop(3200, still);
  const spin = useLoop(4000, still || !sweep, LINEAR);

  // Pontos que acabaram de entrar no alcance acendem um depois do outro (60 ms entre eles).
  const prevIn = useRef(new Map<string, boolean>());
  const delays = new Map<string, number>();
  let k = 0;
  for (const p of points) if (p.inRange && prevIn.current.get(p.id) === false) delays.set(p.id, 60 * k++);
  useEffect(() => { prevIn.current = new Map(points.map(p => [p.id, p.inRange])); }, [points]);

  const at = (id: string) => { const p = placed.find(x => x.id === id); return p ? { x: (p.x / 100) * size, y: (p.y / 100) * size } : null; };
  const target = edge ? at(edge.to) : null;

  return (
    <View onLayout={onLayout} style={{ flex: 1, alignItems: 'center', justifyContent: align, padding: 8 }}>
      {size > 0 ? (
        <Pressable onPress={() => onSelect(null)} accessible={false} style={{ width: size, height: size }}>
          {rings.map(r => (
            <View key={r.d} pointerEvents="none" style={{
              position: 'absolute', left: size / 2 - (r.r * size) / 2, top: size / 2 - (r.r * size) / 2, width: r.r * size, height: r.r * size,
              borderRadius: (r.r * size) / 2, borderWidth: 1, borderColor: c.line2, borderStyle: r.kind === 'ref' ? 'dashed' : 'solid',
              backgroundColor: r.kind === 'reach' ? c.reach : 'transparent',
            }} />
          ))}
          {rings.filter(r => r.label).map(r => (
            <View key={'l' + r.d} pointerEvents="none" {...NOT_A11Y} style={{ position: 'absolute', left: (r.lx / 100) * size - 30, top: (r.ly / 100) * size - 8, width: 60, alignItems: 'center' }}>
              <T size={9.5} w={500} mono color={c.ink3} style={{ paddingHorizontal: 6, borderRadius: 6, backgroundColor: c.bg2 }}>{r.label}</T>
            </View>
          ))}
          {sweep && !reduceMotion ? <Sweep size={size} spin={spin} /> : null}
          {edge && target ? <EdgeLine from={{ x: size / 2, y: size / 2 }} to={target} kind={edge.kind} still={reduceMotion} /> : null}
          {/* "você" e a onda */}
          {!reduceMotion ? (
            <Animated.View pointerEvents="none" style={{ position: 'absolute', left: size / 2 - 18, top: size / 2 - 18, width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: c.ink,
              opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }] }} />
          ) : null}
          <View pointerEvents="none" {...NOT_A11Y} style={{ position: 'absolute', left: size / 2 - 23, top: size / 2 - 23, width: 46, height: 46, borderRadius: 23, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
              <T size={10.5} w={650} color={c.invink}>{t('map.you')}</T>
            </View>
          </View>
          {points.map((p, i) => {
            const pos = placed[i]!;
            return (
              <Marker key={p.id} p={p} x={(pos.x / 100) * size} y={(pos.y / 100) * size} span={size} above={pos.above} sel={selected === p.id} dim={!!selected && selected !== p.id}
                delay={delays.get(p.id) ?? 0} label={showLabels || selected === p.id} label11y={pointA11y(p, t)} onPress={() => onSelect(selected === p.id ? null : p.id)} />
            );
          })}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Varredura do radar vazio: fatia que gira (4 s), mais forte na borda que vai à frente. */
function Sweep({ size, spin }: { size: number; spin: Animated.Value }) {
  const { c } = useTheme();
  const s = size * 0.96, r = s / 2;
  const wedge = (a0: number, a1: number) => {
    const p = (a: number) => `${r + r * Math.sin(a * Math.PI / 180)} ${r - r * Math.cos(a * Math.PI / 180)}`;
    return `M ${r} ${r} L ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)} Z`;
  };
  const N = 14;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: (size - s) / 2, top: (size - s) / 2, width: s, height: s,
      transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
      <Svg width={s} height={s}>
        {Array.from({ length: N }, (_, i) => <Path key={i} d={wedge(290 + (70 / N) * i, 290 + (70 / N) * (i + 1) + 0.5)} fill={c.line2} opacity={(i + 1) / N} />)}
      </Svg>
    </Animated.View>
  );
}

/** Linha de você até o ponto: tracejada andando (conectando) ou verde fixa (conectado). */
function EdgeLine({ from, to, kind, still }: { from: { x: number; y: number }; to: { x: number; y: number }; kind: Edge['kind']; still: boolean }) {
  const { c } = useTheme();
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy), deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const h = kind === 'solid' ? 2 : 1.5;
  const run = useLoop(600, still || kind !== 'flow', LINEAR);
  const solid = useRef(new Animated.Value(kind === 'solid' ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(solid, { toValue: kind === 'solid' ? 1 : 0, duration: still ? 0 : 300, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [kind, still, solid]);
  const dashes = Math.ceil(len / 12) + 2;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: (from.x + to.x) / 2 - len / 2, top: (from.y + to.y) / 2 - h / 2, width: len, height: h, overflow: 'hidden', transform: [{ rotate: `${deg}deg` }] }}>
      <Animated.View style={{ flexDirection: 'row', position: 'absolute', left: -12, top: 0, height: h, transform: [{ translateX: run.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) }], opacity: solid.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        {Array.from({ length: dashes }, (_, i) => <View key={i} style={{ width: 6, height: h, marginRight: 6, backgroundColor: c.ink }} />)}
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: len, height: h, backgroundColor: c.ok, opacity: solid }} />
    </View>
  );
}

/** Um ponto: cheio = no alcance, vazado = longe, anel verde = conectado; entra com fade + escala. */
function Marker({ p, x, y, span, above, sel, dim, delay, label, label11y, onPress }: {
  p: MapPoint; x: number; y: number; span: number; above: boolean; sel: boolean; dim: boolean; delay: number; label: boolean; label11y: string; onPress: () => void;
}) {
  const { c, reduceMotion } = useTheme();
  const k = KIND[p.kind];
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const on = useRef(new Animated.Value(p.inRange ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(p.connected ? 1 : 0)).current;
  const pulse = useLoop(1800, reduceMotion || !sel || p.connected);
  const delayRef = useRef(delay); delayRef.current = delay;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(enter, { toValue: 1, duration: 240, easing: Easing.bezier(0.2, 0.9, 0.3, 1.2), useNativeDriver: true }).start();
  }, [enter, reduceMotion]);
  useEffect(() => {
    Animated.timing(on, { toValue: p.inRange ? 1 : 0, duration: reduceMotion ? 0 : 200, delay: reduceMotion ? 0 : delayRef.current, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [p.inRange, on, reduceMotion]);
  useEffect(() => {
    Animated.timing(ring, { toValue: p.connected ? 1 : 0, duration: reduceMotion ? 0 : 300, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [p.connected, ring, reduceMotion]);
  const halo = k.s + 6, outer = k.s + 11;
  // Rótulo de 120 px centrado no ponto; perto da borda do radar, encosta nela por dentro (não corta).
  const box = Math.min(Math.max(x - LABEL_W / 2, 0), Math.max(0, span - LABEL_W));
  const labelLeft = box - (x - HIT / 2);
  const labelAlign = box > x - LABEL_W / 2 ? 'flex-start' : box < x - LABEL_W / 2 ? 'flex-end' : 'center';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label11y} accessibilityState={{ selected: sel }}
      style={{ position: 'absolute', left: x - HIT / 2, top: y - HIT / 2, width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', zIndex: sel ? 4 : p.inRange ? 3 : 1, opacity: dim ? 0.5 : 1 }}>
      <Animated.View {...NOT_A11Y} style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
        {sel && !p.connected && !reduceMotion ? (
          <Animated.View style={{ position: 'absolute', width: k.s, height: k.s, borderRadius: k.rad, borderWidth: 2, borderColor: c.ink,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }] }} />
        ) : null}
        {sel && !p.connected && reduceMotion ? <View style={{ position: 'absolute', width: k.s + 10, height: k.s + 10, borderRadius: k.rad + 5, borderWidth: 2, borderColor: c.ink }} /> : null}
        <Animated.View style={{ position: 'absolute', width: outer, height: outer, borderRadius: k.rad + 5.5, borderWidth: 2.5, borderColor: c.ok, opacity: ring }} />
        <View style={{ width: halo, height: halo, borderRadius: k.rad + 3, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: k.s, height: k.s, borderRadius: k.rad, borderWidth: 1.5, borderColor: c.ink3, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={k.icon} size={k.is} color={c.ink3} />
          </View>
          <Animated.View style={{ position: 'absolute', width: k.s, height: k.s, borderRadius: k.rad, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', opacity: on }}>
            <Icon name={k.icon} size={k.is} color={c.invink} />
          </Animated.View>
        </View>
      </Animated.View>
      {label ? (
        <View pointerEvents="none" {...NOT_A11Y} style={{ position: 'absolute', left: labelLeft, width: LABEL_W, alignItems: labelAlign, ...(above ? { bottom: HIT / 2 + outer / 2 - 2 } : { top: HIT / 2 + outer / 2 - 2 }) }}>
          <T size={9.5} w={500} mono color={sel ? c.ink : c.ink2} numberOfLines={1} style={{ paddingHorizontal: 3, borderRadius: 4, backgroundColor: c.bg2, maxWidth: LABEL_W }}>{p.name}</T>
        </View>
      ) : null}
    </Pressable>
  );
}
