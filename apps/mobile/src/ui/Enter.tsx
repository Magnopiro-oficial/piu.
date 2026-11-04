import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { ENTER_SPEC, type EnterKind } from '../lib/enterSpec';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Entrada das telas (design: `piuPush`, `piuTab`, `reveal`, `fade`; parâmetros em lib/enterSpec.ts):
 * - `push`: tela interna entra deslizando 56 px da direita com fade, 0,36 s, cubic-bezier(.2,.85,.3,1);
 * - `tab`: conteúdo da aba sobe 16 px e cresce de .985 com fade, 0,34 s, cubic-bezier(.2,.8,.3,1), a cada vez que a aba aparece;
 * - `reveal`: cresce de .965 com fade, 0,5 s, cubic-bezier(.2,.85,.3,1) (boas-vindas);
 * - `fade`: só opacidade, 0,3 s, ease-out (telas cheias: tela bloqueada, encontro de Por perto).
 * Com "reduzir movimento" do sistema, nada anima.
 */
export type { EnterKind };

export function useEnter(kind: EnterKind) {
  const { reduceMotion } = useTheme();
  const p = useRef(new Animated.Value(kind === 'none' || reduceMotion ? 1 : 0)).current;
  const run = useCallback(() => {
    if (kind === 'none' || reduceMotion) { p.setValue(1); return; }
    const s = ENTER_SPEC[kind];
    p.setValue(0);
    Animated.timing(p, { toValue: 1, duration: s.dur, easing: Easing.bezier(...s.bezier), useNativeDriver: true }).start();
  }, [kind, reduceMotion, p]);
  // Tela (push/reveal/fade): anima ao montar. Aba: anima toda vez que ganha o foco (as abas ficam montadas).
  useEffect(() => { if (kind !== 'tab' && kind !== 'none') run(); }, [kind, run]);
  useFocusEffect(useCallback(() => { if (kind === 'tab') run(); }, [kind, run]));
  return useMemo(() => {
    if (kind === 'none') return null;
    const s = ENTER_SPEC[kind];
    const at = (from: number) => p.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
    // Só entra na lista o que o design move nesse tipo (translate/scale ausentes = 0/1).
    const transform = [
      ...(s.dx ? [{ translateX: at(s.dx) }] : []),
      ...(s.dy ? [{ translateY: at(s.dy) }] : []),
      ...(s.scale !== 1 ? [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [s.scale, 1] }) }] : []),
    ];
    return { opacity: p, transform };
  }, [kind, p]);
}

export function Enter({ kind, style, children }: { kind: EnterKind; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const a = useEnter(kind);
  return <Animated.View style={[{ flex: 1 }, style, a]}>{children}</Animated.View>;
}
