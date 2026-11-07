import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useT, type Key } from '../i18n';
import { useLayout } from '../lib/responsive';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const BENEFITS: [IconName, Key][] = [['wifi_off', 'welcome.benefit.offline'], ['lock', 'welcome.benefit.e2e'], ['hub', 'welcome.benefit.mesh']];

/** Boas-vindas (FUN-001): logotipo com órbitas girando (90 s), proposta e entrada. */
export default function Welcome() {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const { width, height, short } = useLayout();
  // "Ver boas-vindas" com identidade criada: restaurar trocaria a frase atual, então não aparece (A-01).
  const { onboarded } = useStore();
  // A órbita tem 300 px no design; encolhe para caber em telas estreitas ou baixas.
  const k = Math.max(0.55, Math.min(1, (width - 24) / 300, (height - 400) / 300));
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 90000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const dot = (size: number, x: number, y: number, outline = false) => (
    <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, left: 150 + x - size / 2, top: 150 + y - size / 2,
      backgroundColor: outline ? c.bg : c.ink, borderWidth: outline ? 1.5 : 0, borderColor: c.ink }} />
  );

  return (
    <Screen enter="reveal" style={{ paddingHorizontal: width < 360 ? 20 : 28 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ position: 'absolute', width: 300, height: 300, alignItems: 'center', justifyContent: 'center', transform: [{ scale: k }] }}>
          {[300, 210, 120].map(s => (
            <View key={s} style={{ position: 'absolute', width: s, height: s, borderRadius: s / 2, borderWidth: 1, borderColor: c.line2 }} />
          ))}
          <Animated.View style={{ position: 'absolute', width: 300, height: 300, transform: [{ rotate }] }}>
            {dot(12, 0, -150)}{dot(9, 82, 74)}{dot(9, -106, -26, true)}{dot(7, -56, 124)}{dot(7, 44, -60, true)}
          </Animated.View>
        </View>
        <T size={Math.round(112 * k)} w={750} ls={-0.07} style={{ lineHeight: Math.round(120 * k) }}>piu<T size={Math.round(112 * k)} w={750} color={c.ink3}>.</T></T>
      </View>
      <View style={{ gap: short ? 16 : 22, paddingBottom: 16 }}>
        <T size={width < 360 ? 26 : 30} w={600} ls={-0.03} lh={1.08} accessibilityRole="header">{t('welcome.title')}</T>
        <View style={{ gap: 12 }}>
          {BENEFITS.map(([icon, text]) => (
            <View key={icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name={icon} size={20} w={300} />
              <T size={15} color={c.ink2}>{t(text)}</T>
            </View>
          ))}
        </View>
        <View style={{ gap: 10, marginTop: 6 }}>
          <Button label={t('welcome.create')} onPress={() => router.push('/identity')} />
          {!onboarded && <Button label={t('welcome.restore')} variant="ghost" height={46} onPress={() => router.push('/restore')} />}
        </View>
      </View>
    </Screen>
  );
}
