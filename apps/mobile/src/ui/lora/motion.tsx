import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Animações do Rádio do Piu (desenho Piu 17, RADIO-DO-PIU.md):
 * - lrSpin: anel de borda girando, 0,9 s linear (busca e etapas);
 * - lrPulse: círculo que cresce de .6 a 2,4 e some (opacidade .7 → 0), ease-out (busca vazia 2 s, botão PRG 1,6 s);
 * - lrBlink: opacidade 1 → .35 → 1 em 2 s, ease-in-out (ampulheta e fila);
 * - lrIn: rádio novo entrando na lista, uma vez só (o trecho 40–60 % dos 4 s do desenho: 0,8 s ease-out);
 * - lrDrain: a barra de "Próxima mensagem" (LoraBlock.tsx, `AirLine`).
 * Com "reduzir movimento", tudo fica parado: sem pulso, anel parado, ícone aceso, item já no lugar.
 */

/** No navegador não há driver nativo: lá, o driver JS. */
export const NATIVE = Platform.OS !== 'web';

const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
/** lrBlink: vai e volta, cada metade com ease-in-out (como os dois trechos do keyframe). */
const BLINK = (x: number) => EASE_IN_OUT(x < 0.5 ? x * 2 : 2 - x * 2);

/** Relógio 0 → 1 em laço, com a curva. `still`: "reduzir movimento". */
function useLoop(dur: number, easing: (x: number) => number) {
  const { reduceMotion } = useTheme();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion) { v.setValue(0); return; }
    // Laço feito à mão: `Animated.loop` para depois da primeira volta no navegador (como em PhoneNode.tsx).
    let live = true;
    let a: Animated.CompositeAnimation | null = null;
    const run = () => {
      if (!live) return;
      v.setValue(0);
      a = Animated.timing(v, { toValue: 1, duration: dur, easing, useNativeDriver: NATIVE });
      a.start(({ finished }) => { if (finished) run(); });
    };
    run();
    return () => { live = false; a?.stop(); };
  }, [v, dur, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  return { v, still: reduceMotion };
}

/** lrSpin: anel de `size` px (borda `bg3`, topo `ink`) no lugar do ActivityIndicator. */
export function LrSpin({ size, border }: { size: number; border: number }) {
  const { c } = useTheme();
  const { v, still } = useLoop(900, Easing.linear);
  const rotate = useMemo(() => (still ? '0deg' : v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })), [v, still]);
  return <Animated.View accessibilityRole="progressbar" style={{ width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: c.bg3, borderTopColor: c.ink, transform: [{ rotate }] }} />;
}

/** lrPulse: círculo cheio que ocupa o pai e pulsa por trás do conteúdo. */
export function LrPulse({ dur, color, radius }: { dur: number; color: string; radius: number }) {
  const { v, still } = useLoop(dur, EASE_OUT);
  const style = useMemo(() => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) }],
  }), [v]);
  if (still) return null;
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, backgroundColor: color }, style]} />;
}

/** lrBlink: o filho (um ícone) apaga até .35 e volta, a cada 2 s. */
export function LrBlink({ children }: { children: ReactNode }) {
  const { v, still } = useLoop(2000, BLINK);
  const opacity = useMemo(() => (still ? 1 : v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] })), [v, still]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/** lrIn: o filho entra uma vez, ao montar (fade e sobe 8 px). `skip`: já estava ali (sem animar). */
export function LrIn({ skip, style, children }: { skip?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { reduceMotion } = useTheme();
  const still = !!skip || reduceMotion;
  const [v] = useState(() => new Animated.Value(still ? 1 : 0));
  useEffect(() => {
    if (still) { v.setValue(1); return; }
    const a = Animated.timing(v, { toValue: 1, duration: 800, easing: EASE_OUT, useNativeDriver: NATIVE });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- só ao entrar na lista
  const anim = useMemo(() => ({ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }), [v]);
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
