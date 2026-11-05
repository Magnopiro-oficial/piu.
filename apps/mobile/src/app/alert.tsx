import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AlertView, categoryOf, type Vote } from '../messaging/communityAlerts';
import { fmtDate, useT } from '../i18n';
import { alertCategoryName, alertSeverityName, alertStatusName, officialNote } from '../i18n/alerts';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { T } from '../ui/T';

const when = (sec: number) => fmtDate(sec * 1000, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Alerta da comunidade em tela cheia (layout do "alerta de emergência" do design): publicado por um
 * membro, classificado pelos outros ("Confirmo" / "Não procede") e encerrado pelo autor ou por
 * admin/moderador. Grave vigente e não contestado: tela invertida e pulsando; o resto, rebaixado.
 */
export default function Alert() {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { showToast } = useStore();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { alerts, alertEpoch } = useMessaging();
  void alertEpoch;
  const a = id && alerts ? alerts.get(id) : null;
  const loud = !!a && a.active && a.sev === 'grave' && a.status !== 'contested';
  const rings = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || !loud) return;
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
  }, [reduceMotion, rings, breath, loud]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!a || !alerts) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24, gap: 16 }}>
        <Icon name="warning" size={34} w={300} />
        <T size={24} w={650} ls={-0.03} accessibilityRole="header">{t('alert.notFound')}</T>
        <T size={14.5} lh={1.45} color={c.ink2}>{t('alert.notFound.body')}</T>
        <View style={{ flex: 1 }} />
        <Button label={t('alert.seeAll')} height={50} onPress={() => router.replace('/notifications')} />
        <Button label={t('common.close')} variant="ghost" height={46} onPress={close} />
      </View>
    );
  }

  const act = (fn: () => AlertView, ok?: { title: string; body: string }) => {
    try { fn(); if (ok) showToast({ icon: 'schedule_send', ...ok }); }
    catch (e) { showToast({ icon: 'error', title: t('groupInfo.failed'), body: (e as Error).message }); }
  };
  const vote = (v: Vote) => act(() => alerts.vote(a.id, v), { title: v === 'confirm' ? t('alert.voted.confirm') : t('alert.voted.deny'), body: t('alert.voted.body') });
  const bg = loud ? c.ink : c.bg, fg = loud ? c.invink : c.ink;
  const cat = categoryOf(a.cat);
  const head = `${t('alert.head')} · ${(a.active ? alertSeverityName(a.sev, t) : alertStatusName(a.status, t)).toUpperCase()}`;
  const rows: [string, string][] = [
    [t('alert.row.state'), alertStatusName(a.status, t)],
    [t('alert.row.votes'), `${t('alert.confirms', { count: a.confirms })} · ${t('alert.denies', { count: a.denies })}`],
    [t('alert.row.category'), alertCategoryName(a.cat, t)],
    [t('alert.row.severity'), alertSeverityName(a.sev, t)],
    ...(a.area ? [[t('alert.row.area'), a.area] as [string, string]] : []),
    [t('alert.row.community'), a.communityName || '—'],
    [t('alert.row.author'), a.mine ? t('network.radar.you') : a.authorName],
    [t('alert.row.published'), when(a.at)],
    [a.active ? t('alert.row.validUntil') : a.closedAt ? t('alertStatus.closed') : t('alert.row.expired'), when(a.closedAt ?? a.until)],
  ];
  const line = 'rgba(127,127,127,0.45)';

  return (
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: bg, paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24, gap: 18 }}>
      <Stack.Screen options={{ animation: 'fade', gestureEnabled: !loud }} />
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg, opacity: loud ? breath : 0.4 }} />
        <T size={12} w={600} mono ls={0.08} color={fg} style={{ flex: 1 }}>{head}</T>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 22, paddingVertical: 8 }}>
        <View style={{ width: 88, height: 88 }}>
          {rings.map((r, i) => (
            <Animated.View key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, borderWidth: 1.5, borderColor: fg,
              opacity: r.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion || !loud ? 0 : 0.6, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }} />
          ))}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, backgroundColor: loud ? fg : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={cat.icon as IconName} size={44} fill color={loud ? bg : c.ink} />
          </View>
        </View>
        <View style={{ gap: 12 }} accessibilityRole={loud ? 'alert' : undefined}>
          <T size={loud ? 36 : 32} w={700} ls={loud ? -0.045 : -0.04} lh={loud ? 1.02 : 1.05} color={fg} style={{ opacity: a.status === 'contested' ? 0.7 : 1 }}>{a.title}</T>
          {!!a.text && <T size={16} lh={1.45} color={fg} style={{ opacity: 0.85 }} selectable>{a.text}</T>}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: line }}>
          <Icon name="info" size={17} color={fg} />
          <T size={13} w={600} lh={1.4} color={fg} style={{ flex: 1 }}>{officialNote(t)}{a.status === 'contested' ? ` ${t('alert.contestedNote')}` : ''}</T>
        </View>
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: line, paddingVertical: 14, paddingHorizontal: 16, gap: 9 }}>
          {rows.map(([l, v]) => (
            <View key={l} style={{ flexDirection: 'row', gap: 14 }}>
              <T size={13} color={fg} style={{ opacity: 0.65, width: 104 }}>{l}</T>
              <T size={13} w={600} color={fg} style={{ flex: 1 }} selectable>{v}</T>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ gap: 10 }}>
        {a.canVote && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={a.myVote === 'confirm' ? t('alert.confirmedByYou') : t('alert.confirm')} variant={loud ? 'inverse' : a.myVote === 'confirm' ? 'primary' : 'outline'} height={50} style={{ flex: 1 }}
              onPress={() => vote('confirm')} />
            <Button label={a.myVote === 'deny' ? t('alert.deny.yours') : t('alert.deny')} variant={loud ? 'ghostInverse' : a.myVote === 'deny' ? 'primary' : 'outline'} height={50} style={{ flex: 1, ...(loud ? { borderWidth: 1, borderColor: line } : {}) }}
              onPress={() => vote('deny')} />
          </View>
        )}
        {a.mine && a.active && <T size={12.5} lh={1.4} color={fg} style={{ opacity: 0.75 }}>{t('alert.youPublished')}</T>}
        {a.canClose && (
          <Button label={t('alert.closeAlert')} variant={loud ? 'ghostInverse' : 'outline'} height={46} style={loud ? { borderWidth: 1, borderColor: line } : undefined}
            onPress={() => act(() => alerts.close(a.id), { title: t('alert.closed'), body: t('alert.closed.body') })} />
        )}
        <Button label={t('prompt.gotIt')} variant={loud ? 'ghostInverse' : 'ghost'} height={50} style={loud ? { borderWidth: 1, borderColor: line } : undefined} onPress={close} />
      </View>
    </View>
  );
}
