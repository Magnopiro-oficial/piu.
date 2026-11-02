import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import type { ProvDevice } from '../data/network';
import { useTheme } from '../theme/ThemeProvider';

export const statusOf = (s: ProvDevice['status']) => (s === 'active' ? 'Ativo na malha' : s === 'paused' ? 'Pausado por você' : 'Aquecendo · primeiros recibos em minutos');

/** Bolinha de status: cheia = ativo; vazia = pausado; vazia piscando = aquecendo. */
export function StatusDot({ status }: { status: ProvDevice['status'] }) {
  const { c, reduceMotion } = useTheme();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (status !== 'warming' || reduceMotion) { o.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [status, reduceMotion, o]);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.5, borderColor: c.ink, backgroundColor: status === 'active' ? c.ink : 'transparent', opacity: o }} />;
}
