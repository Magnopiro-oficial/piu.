import { router, useLocalSearchParams } from 'expo-router';
import { Animated, ScrollView, View } from 'react-native';
import { fmtLunes } from '../../data/wallet';
import { useT } from '../../i18n';
import { chatIdFor, useMessaging } from '../../state/messaging';
import { initialsOf } from '../../lib/text';
import { useLayout } from '../../lib/responsive';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { Stripes } from '../../ui/Stripes';
import { T } from '../../ui/T';
import { popStyle, seg, upStyle, useClock, type Bezier } from '../../ui/motion';

/** `piuInL`/`piuInR .7s cubic-bezier(.2,.9,.3,1.15)`: ±70 px e ∓8° até o lugar. */
const IN: Bezier = [0.2, 0.9, 0.3, 1.15];

const SIZE = 124;

/** Conversa aberta depois de aceitar um pedido de Por perto. */
export default function Match() {
  const { c } = useTheme();
  const t = useT();
  const { compact, short } = useLayout();
  const { profile } = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nearby } = useMessaging();
  const req = nearby?.requests.find(x => x.id === id);
  const r = { name: req?.name ?? t('match.contact'), initials: initialsOf(req?.name ?? ''), fee: req?.fee ?? 0, chat: req ? chatIdFor(req.from) : null };
  // Coreografia do design: avatares .7s; título `piuUp .5s .35s`; pílula `piuPop .45s .6s`.
  const clock = useClock(1050);
  const slide = (dir: -1 | 1) => ({
    opacity: seg(clock, 0, 700, 0, 1, IN),
    transform: [{ translateX: seg(clock, 0, 700, dir * 70, 0, IN) }, { rotate: seg(clock, 0, 700, dir * 8, 0, IN).interpolate({ inputRange: [-8, 8], outputRange: ['-8deg', '8deg'] }) }],
  });
  const ring = { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 5, borderColor: c.ink, overflow: 'hidden' } as const;

  return (
    <Screen enter="fade" style={{ backgroundColor: c.ink }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: short ? 16 : 96, paddingBottom: short ? 16 : 30, gap: short ? 20 : 30 }}>
        <View accessible accessibilityLabel={t('match.youAnd', { name: r.name })} style={{ flexDirection: 'row' }}>
          <Animated.View style={[ring, slide(-1), { marginRight: -28, zIndex: 1 }]}>
            <Stripes period={14} a={c.ink2} b={c.ink3} style={{ flex: 1 }} label={t('nearby.photoOf', { name: r.name })}>
              <T size={30} w={650} color={c.invink}>{r.initials}</T>
            </Stripes>
          </Animated.View>
          <Animated.View style={[ring, slide(1), { backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }]}>
            <T size={30} w={650} color={c.ink}>{initialsOf(profile.name)}</T>
          </Animated.View>
        </View>
        <View style={{ alignItems: 'center', alignSelf: 'stretch', gap: 10 }}>
          <Animated.View style={upStyle(clock, 350, 500)}>
            <T size={compact ? 34 : 40} w={700} ls={-0.05} lh={1} color={c.invink} align="center" accessibilityRole="header">{t('match.title')}</T>
          </Animated.View>
          <T size={15} lh={1.45} color={c.invink} align="center" style={{ opacity: 0.75, maxWidth: 290 }}>{t('match.body', { name: r.name })}</T>
        </View>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, borderColor: c.invink }, popStyle(clock, 600, 450)]}>
          <Icon name="toll" size={17} color={c.invink} />
          <T size={13.5} w={600} color={c.invink} style={{ flexShrink: 1 }}>{t('match.toReceive', { fee: fmtLunes(r.fee) })}</T>
        </Animated.View>
      </ScrollView>
      <View style={{ paddingHorizontal: 28, paddingBottom: short ? 20 : 40, gap: 10 }}>
        <Button label={t('match.send')} variant="inverse" disabled={!r.chat} onPress={() => r.chat && router.replace({ pathname: '/chat/[id]', params: { id: r.chat } })} />
        <Button label={t('match.later')} variant="ghostInverse" height={46} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
