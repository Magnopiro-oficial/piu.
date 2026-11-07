import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { cubicBezier, easedRange, popRange, type Range } from '../lib/walletMotion';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Relógio para coreografias com vários elementos (design: `animation: nome dur curva atraso both`):
 * um único `Animated.Value` sobe linearmente de 0 a `total` ms com driver nativo, e cada elemento
 * interpola o próprio trecho (atraso, duração e curva amostrada) a partir dele. Reinicia quando `seq` muda.
 * Com "reduzir movimento" do sistema, o relógio já nasce no fim: tudo aparece no estado final.
 */
export function useClock(total: number, seq = 0): Animated.Value {
  const { reduceMotion } = useTheme();
  const clock = useRef(new Animated.Value(reduceMotion ? total : 0)).current;
  useEffect(() => {
    if (reduceMotion) { clock.setValue(total); return; }
    clock.setValue(0);
    const a = Animated.timing(clock, { toValue: total, duration: total, easing: Easing.linear, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [clock, total, seq, reduceMotion]);
  return clock;
}

export type Bezier = readonly [number, number, number, number];
/** Curvas nomeadas do CSS. */
export const EASE: Bezier = [0.25, 0.1, 0.25, 1];
export const EASE_OUT: Bezier = [0, 0, 0.58, 1];
export const EASE_IN: Bezier = [0.42, 0, 1, 1];
export const EASE_IN_OUT: Bezier = [0.42, 0, 0.58, 1];
export const LINEAR: Bezier = [0, 0, 1, 1];

/** Interpola o relógio pelo trecho `r`, parado antes e depois (`animation-fill-mode: both`). */
export const at = (clock: Animated.Value, r: Range) => clock.interpolate({ inputRange: r.inputRange, outputRange: r.outputRange, extrapolate: 'clamp' });

/** Trecho `from → to` entre `delay` e `delay + dur` com a curva; `before` força outro valor antes do início (ex.: anéis que começam invisíveis). */
export function seg(clock: Animated.Value, delay: number, dur: number, from: number, to: number, bezier: Bezier = EASE, before?: number, samples?: number) {
  const r = easedRange(delay, dur, from, to, cubicBezier(...bezier), samples);
  if (before !== undefined && before !== from) {
    r.inputRange.unshift(delay - 0.001);
    r.outputRange.unshift(before);
  }
  return at(clock, r);
}

/** Junta trechos consecutivos (keyframes compostos, ex.: sobe e depois vira moeda). */
export function concat(...ranges: Range[]): Range {
  const out: Range = { inputRange: [], outputRange: [] };
  for (const r of ranges) {
    const skip = out.inputRange.length && r.inputRange[0]! <= out.inputRange[out.inputRange.length - 1]! ? 1 : 0;
    out.inputRange.push(...r.inputRange.slice(skip));
    out.outputRange.push(...r.outputRange.slice(skip));
  }
  return out;
}

export const range = (delay: number, dur: number, from: number, to: number, bezier: Bezier = EASE, samples?: number) =>
  easedRange(delay, dur, from, to, cubicBezier(...bezier), samples);

/** `piuFade`: opacidade 0 → 1. */
export const fadeStyle = (clock: Animated.Value, delay: number, dur: number, bezier: Bezier = EASE) => ({ opacity: seg(clock, delay, dur, 0, 1, bezier) });

/** `piuUp`: sobe `dy` px (16 por padrão) com fade. */
export const upStyle = (clock: Animated.Value, delay: number, dur: number, bezier: Bezier = EASE, dy = 16) => ({
  opacity: seg(clock, delay, dur, 0, 1, bezier),
  transform: [{ translateY: seg(clock, delay, dur, dy, 0, bezier) }],
});

/** `piuPop`: scale .4 → 1.14 (70 %) → 1, opacidade 0 → 1 até os 70 %. */
export const popStyle = (clock: Animated.Value, delay: number, dur: number, bezier: Bezier = [0.2, 0.9, 0.3, 1.4]) => ({
  opacity: at(clock, { inputRange: [delay, delay + dur * 0.7], outputRange: [0, 1] }),
  transform: [{ scale: at(clock, popRange(delay, dur, bezier)) }],
});

/** `piuRingS`/`piuRing`: anel que cresce e some a partir de `delay` (invisível antes). */
export const ringStyle = (clock: Animated.Value, delay: number, dur: number, toScale: number, fromOpacity: number, bezier: Bezier = EASE_OUT) => ({
  opacity: seg(clock, delay, dur, fromOpacity, 0, bezier, 0),
  transform: [{ scale: seg(clock, delay, dur, 1, toScale, bezier, 1) }],
});

/** Converte `#rrggbb` em `rgba(...)` com alfa (equivalente ao `color-mix(... N%, transparent)` do design). */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}

/**
 * `piuPop` declarativo: o filho entra com scale .4 → 1,14 → 1 (design: `piuPop <dur> <curva> <delay> both`).
 * Reinicia quando `seq` muda (ex.: o número do badge).
 */
export function Pop({ delay = 0, dur = 400, bezier, seq = 0, style, children }: { delay?: number; dur?: number; bezier?: Bezier; seq?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const clock = useClock(delay + dur, seq);
  return <Animated.View style={[style, popStyle(clock, delay, dur, bezier)]}>{children}</Animated.View>;
}

/** `piuUp` declarativo: sobe `dy` px (16) com fade (design: `piuUp <dur> <delay> both`, curva `ease`). */
export function Up({ delay = 0, dur = 500, dy = 16, bezier = EASE, style, children }: { delay?: number; dur?: number; dy?: number; bezier?: Bezier; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const clock = useClock(delay + dur);
  return <Animated.View style={[style, upStyle(clock, delay, dur, bezier, dy)]}>{children}</Animated.View>;
}
