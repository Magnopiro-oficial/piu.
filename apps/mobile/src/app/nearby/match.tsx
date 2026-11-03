import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { fmtLunes } from '../../data/wallet';
import { useWallet } from '../../state/wallet';
import { initialsOf } from '../../lib/text';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { Stripes } from '../../ui/Stripes';
import { T } from '../../ui/T';

const SIZE = 124;

/** Conversa aberta depois de aceitar um pedido de Por perto. */
export default function Match() {
  const { c, reduceMotion } = useTheme();
  const { profile } = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { requests } = useWallet();
  const r = requests.find(x => x.id === id) ?? { id: id ?? '', name: 'Contato', initials: '··', fee: 0 };
  const t = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(t, { toValue: 1, duration: 520, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: true }).start();
  }, [reduceMotion, t]);
  const slide = (from: number) => ({ opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] });
  const ring = { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 4, borderColor: c.ink, overflow: 'hidden' } as const;

  return (
    <Screen style={{ backgroundColor: c.ink }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
        <View accessible accessibilityLabel={`Você e ${r.name}`} style={{ flexDirection: 'row', marginBottom: 18 }}>
          <Animated.View style={[ring, slide(-60), { marginRight: -18, zIndex: 1 }]}>
            <Stripes period={14} a={c.bg2} b={c.bg3} style={{ flex: 1 }} label={`Foto de ${r.name}`}>
              <T size={34} w={650} ls={-0.03}>{r.initials}</T>
            </Stripes>
          </Animated.View>
          <Animated.View style={[ring, slide(60), { backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }]}>
            <T size={34} w={650} ls={-0.03}>{initialsOf(profile.name)}</T>
          </Animated.View>
        </View>
        <T size={32} w={700} ls={-0.04} color={c.invink} align="center" accessibilityRole="header">Conversa aberta</T>
        <T size={15} lh={1.45} color={c.invink} align="center" style={{ opacity: 0.75 }}>{`Você e ${r.name} podem conversar agora, cifrado de ponta a ponta.`}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(127,127,127,0.45)' }}>
          <Icon name="toll" size={17} color={c.invink} />
          <T size={13} w={600} mono color={c.invink}>+{fmtLunes(r.fee)} LUNES na sua carteira</T>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}>
        <Button label="Enviar mensagem" variant="inverse" onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: 'near-' + r.id } })} />
        <Button label="Depois" variant="ghostInverse" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
