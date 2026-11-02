import { router, Stack } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EMERGENCY } from '../data/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { T } from '../ui/T';

/** Alerta de emergência assinado por fonte oficial: tela cheia invertida, sempre visível. */
export default function Alert() {
  const { c, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const rings = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loops = [
      ...rings.map((r, i) => Animated.loop(Animated.sequence([
        Animated.delay(i * 1200),
        Animated.timing(r, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))),
      Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])),
    ];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduceMotion, rings, breath]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  return (
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.ink, paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24, gap: 22 }}>
      <Stack.Screen options={{ animation: 'fade', gestureEnabled: false }} />
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.invink, opacity: breath }} />
        <T size={12} w={600} mono ls={0.08} color={c.invink}>ALERTA DE EMERGÊNCIA</T>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 26 }}>
        <View style={{ width: 88, height: 88 }}>
          {rings.map((r, i) => (
            <Animated.View key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, borderWidth: 1.5, borderColor: c.invink,
              opacity: r.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 0.6, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }} />
          ))}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="warning" size={44} fill color={c.ink} />
          </View>
        </View>
        <View style={{ gap: 12 }} accessibilityRole="alert">
          <T size={36} w={700} ls={-0.045} lh={1.02} color={c.invink}>{EMERGENCY.title}</T>
          <T size={16} lh={1.45} color={c.invink} style={{ opacity: 0.82 }}>{EMERGENCY.body}</T>
        </View>
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: 'rgba(127,127,127,0.45)', paddingVertical: 14, paddingHorizontal: 16, gap: 9 }}>
          {EMERGENCY.rows.map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', gap: 14 }}>
              <T size={13} color={c.invink} style={{ opacity: 0.65, width: 76 }}>{l}</T>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {i === 2 && <Icon name="verified" size={16} fill color={c.invink} />}
                <T size={13} w={600} color={c.invink} style={{ flexShrink: 1 }}>{v}</T>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Button label="Ver no canal" variant="inverse" onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: 'defesa' } })} />
        <Button label="Entendi" variant="ghostInverse" height={50} style={{ borderWidth: 1, borderColor: 'rgba(127,127,127,0.5)' }} onPress={close} />
      </View>
    </View>
  );
}
