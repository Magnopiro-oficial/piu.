import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { MIG_META, migItems } from '../data/settings';
import { SAFETY_WORDS } from '../data/wallet';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { StepHeader } from '../ui/StepHeader';
import { T } from '../ui/T';

const STEP_MS = 750;

/** Migração: identidades, contatos, carteira e sessões chegam em 5 etapas; no fim, as chaves de sessão são trocadas. */
export default function Migrate() {
  const { c, reduceMotion } = useTheme();
  const { restoreMode } = useSettings();
  const { finishOnboarding, onboarded } = useStore();
  const [n, setN] = useState(0);
  const meta = MIG_META[restoreMode];
  const items = migItems(restoreMode);
  const done = n >= items.length;

  useEffect(() => {
    const t = setInterval(() => setN(x => { if (x + 1 >= items.length) clearInterval(t); return x + 1; }), STEP_MS);
    return () => clearInterval(t);
  }, [items.length]);

  // Ponto que viaja do aparelho antigo para este, pela linha tracejada.
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion || done) return;
    const loop = Animated.loop(Animated.timing(dot, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, done, dot]);

  const open = () => {
    if (!onboarded) finishOnboarding();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <StepHeader step={done ? 'CONCLUÍDO' : 'MIGRAÇÃO'} title={done ? 'Tudo pronto.' : meta.title} sub={meta.sub} />
        <View accessibilityLabel={`De ${meta.label} para este aparelho`} style={{ marginTop: 8, marginHorizontal: 28, height: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ position: 'absolute', left: 70, right: 70, top: 48, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: c.ink, opacity: 0.45 }} />
          {!done && !reduceMotion && (
            <Animated.View style={{ position: 'absolute', top: 44, width: 7, height: 7, borderRadius: 4, backgroundColor: c.ink,
              left: dot.interpolate({ inputRange: [0, 1], outputRange: ['22%', '74%'] }) }} />
          )}
          <View style={{ alignItems: 'center', gap: 8 }}>
            <View style={{ width: 62, height: 94, borderRadius: 16, borderWidth: 1.5, borderColor: c.ink, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={meta.icon} size={26} w={300} /></View>
            <T size={11} w={500} mono color={c.ink2}>{meta.label}</T>
          </View>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <View style={{ width: 62, height: 94, borderRadius: 16, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="smartphone" size={26} color={c.invink} /></View>
            <T size={11} w={500} mono color={c.ink2}>este aparelho</T>
          </View>
        </View>

        {restoreMode === 'device' && (
          <View style={{ marginTop: 8, marginHorizontal: 20, padding: 14, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
            <T size={13} color={c.ink2}>Confira se as mesmas palavras aparecem no aparelho antigo:</T>
            <View accessibilityLabel={'Código: ' + SAFETY_WORDS.join(', ')} style={{ flexDirection: 'row', gap: 6 }}>
              {SAFETY_WORDS.map(w => <View key={w} style={{ flex: 1, height: 38, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><T size={15} w={650}>{w}</T></View>)}
            </View>
          </View>
        )}

        <View style={{ paddingTop: 8, paddingHorizontal: 24 }}>
          {items.map(([t, d], i) => {
            const ok = i < n, cur = i === n;
            return (
              <View key={t} accessibilityLabel={`${t}: ${ok ? 'concluído' : cur ? 'em andamento' : 'aguardando'}`}
                style={{ flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line, opacity: ok || cur ? 1 : 0.4 }}>
                <Icon name={ok ? 'check_circle' : cur ? 'pending' : 'radio_button_unchecked'} size={22} fill={ok} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T size={15} w={600}>{t}</T>
                  <T size={11.5} mono lh={1.45} color={c.ink2}>{d}</T>
                </View>
              </View>
            );
          })}
        </View>

        {done && (
          <View accessibilityLiveRegion="polite" style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.ink, flexDirection: 'row', gap: 12 }}>
            <Icon name="sync_lock" size={20} w={300} color={c.invink} />
            <T size={13} lh={1.45} color={c.invink} style={{ flex: 1 }}>{meta.done}</T>
          </View>
        )}
        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Abrir o Piu" disabled={!done} onPress={open} />
        </View>
      </ScrollView>
    </Screen>
  );
}
