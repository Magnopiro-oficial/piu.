import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Entrada das telas (design: `piuPush` e `piuTab`):
 * - `push`: tela interna entra deslizando 32 px da direita com fade, 0,36 s, cubic-bezier(.2,.85,.3,1);
 * - `tab`: conteúdo da aba sobe 10 px com fade, 0,34 s, cubic-bezier(.2,.8,.3,1), a cada vez que a aba aparece.
 * Com "reduzir movimento" do sistema, nada anima.
 */
export type EnterKind = 'push' | 'tab' | 'none';

const SPEC = {
  push: { dur: 360, ease: Easing.bezier(0.2, 0.85, 0.3, 1), dx: 32, dy: 0 },
  tab: { dur: 340, ease: Easing.bezier(0.2, 0.8, 0.3, 1), dx: 0, dy: 10 },
};

export function useEnter(kind: EnterKind) {
  const { reduceMotion } = useTheme();
  const p = useRef(new Animated.Value(kind === 'none' || reduceMotion ? 1 : 0)).current;
  const run = useCallback(() => {
    if (kind === 'none' || reduceMotion) { p.setValue(1); return; }
    const s = SPEC[kind];
    p.setValue(0);
    Animated.timing(p, { toValue: 1, duration: s.dur, easing: s.ease, useNativeDriver: true }).start();
  }, [kind, reduceMotion, p]);
  // Tela interna: anima ao montar. Aba: anima toda vez que ganha o foco (as abas ficam montadas).
  useEffect(() => { if (kind === 'push') run(); }, [kind, run]);
  useFocusEffect(useCallback(() => { if (kind === 'tab') run(); }, [kind, run]));
  if (kind === 'none') return null;
  const s = SPEC[kind];
  return {
    opacity: p,
    transform: [s.dx ? { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [s.dx, 0] }) } : { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [s.dy, 0] }) }],
  };
}

export function Enter({ kind, style, children }: { kind: EnterKind; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const a = useEnter(kind);
  return <Animated.View style={[{ flex: 1 }, style, a]}>{children}</Animated.View>;
}
