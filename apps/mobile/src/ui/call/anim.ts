import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { CURVES } from '../../calls/callVisual';
import { useTheme } from '../../theme/ThemeProvider';

/** Curvas da chamada (§5.6) já como `Easing`. */
export const EASE_ENTER = Easing.bezier(...CURVES.enter);
export const EASE_BOUNCE = Easing.bezier(...CURVES.bounce);
export const EASE_SPRING = Easing.bezier(...CURVES.spring);
export const EASE_CSS = Easing.bezier(0.25, 0.1, 0.25, 1);
export const EASE_LINEAR = Easing.linear;

/**
 * Valor 0 → 1 que segue `on` (como a `transition` do CSS do protótipo): anima nos dois sentidos com a
 * mesma duração e curva, e na montagem parte de `initial` (0 = entra animado). Com "reduzir
 * movimento" do sistema, troca na hora.
 */
export function useShown(on: boolean, ms: number, easing: (v: number) => number = EASE_ENTER, native = true, initial = 0): Animated.Value {
  const { reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? (on ? 1 : 0) : initial)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(on ? 1 : 0); return; }
    const a = Animated.timing(v, { toValue: on ? 1 : 0, duration: ms, easing, useNativeDriver: native });
    a.start();
    return () => a.stop();
  }, [on, ms, easing, native, reduceMotion, v]);
  return v;
}

/** Continua montado por `exitMs` depois de `on` desligar (para a animação de saída terminar). */
export function usePresence(on: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(on);
  useEffect(() => {
    if (on) { setMounted(true); return; }
    const h = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(h);
  }, [on, exitMs]);
  return on || mounted;
}

/** Laço por quadro (requestAnimationFrame) enquanto `on`; `cb` recebe o tempo em segundos. */
export function useFrameLoop(on: boolean, cb: (tSec: number) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!on) return;
    let id = 0;
    const loop = () => { ref.current(performance.now() / 1000); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [on]);
}

/** Re-renderiza a cada `ms` enquanto `on` (cronômetro e "quem fala": o protótipo atualiza a cada 250 ms). */
export function useTick(on: boolean, ms = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(h);
  }, [on, ms]);
  return n;
}

/** Guarda a última cena não nula (as peças saem animadas com o conteúdo que tinham). */
export function useLast<T>(v: T | null): T | null {
  const ref = useRef<T | null>(v);
  if (v) ref.current = v;
  return ref.current;
}
