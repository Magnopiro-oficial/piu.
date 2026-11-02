import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Barra horizontal que cresce em 700 ms. */
export function GrowBar({ pct, height = 4 }: { pct: number; height?: number }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(); }, [reduceMotion, v]);
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', backgroundColor: c.ink, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] }) }} />
    </View>
  );
}

/** Coluna vertical que cresce em 600 ms (gráficos de barras). */
export function GrowCol({ pct, opacity, delay }: { pct: number; opacity: number; delay: number }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(v, { toValue: 1, duration: 600, delay, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(); }, [reduceMotion, v, delay]);
  return <Animated.View style={{ width: '100%', borderRadius: 6, backgroundColor: c.ink, opacity, height: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] }) }} />;
}
