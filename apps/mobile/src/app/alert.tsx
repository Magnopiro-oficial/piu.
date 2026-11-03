import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOfficialAlerts } from '../lib/alerts';
import { alertTitle, areaLine, publisherOf, SEVERITY_PT, sourceLabel } from '../lib/alertsCore';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { T } from '../ui/T';

const when = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
};

/**
 * Alerta oficial (CAP) recebido pelo Piu Node pareado, em tela cheia invertida. A origem é explícita:
 * o órgão publicou em CAP e o nó retransmitiu; não há assinatura do órgão para o app conferir.
 */
export default function Alert() {
  const { c, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { alerts } = useOfficialAlerts();
  const a = id ? alerts.find(x => x.id === id) : undefined;
  const live = !!a && a.until > Date.now();
  const rings = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || !live) return;
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
  }, [reduceMotion, rings, breath, live]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!a) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24, gap: 16 }}>
        <Icon name="warning" size={34} w={300} />
        <T size={24} w={650} ls={-0.03} accessibilityRole="header">Alerta não encontrado</T>
        <T size={14.5} lh={1.45} color={c.ink2}>Ele pode ter vencido ou sido cancelado pelo órgão que publicou. Os alertas vigentes ficam em Ajustes → Notificações → Alertas oficiais.</T>
        <View style={{ flex: 1 }} />
        <Button label="Ver alertas oficiais" height={50} onPress={() => router.replace('/notifications')} />
        <Button label="Fechar" variant="ghost" height={46} onPress={close} />
      </View>
    );
  }

  const rows: [string, string][] = [
    ['Evento', a.info.event || '—'],
    ['Severidade', SEVERITY_PT[a.info.severity]],
    ['Área', areaLine(a, 400) || '—'],
    ['Emitido', when(a.sent)],
    ...(a.info.expires ? [['Vale até', when(a.info.expires)] as [string, string]] : []),
    ['Publicado por', `${publisherOf(a)} · ${a.sender}`],
    ['Recebido por', `seu Piu Node ${a.via} · ${new Date(a.receivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`],
  ];

  return (
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.ink, paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 16) + 16, paddingHorizontal: 24, gap: 18 }}>
      <Stack.Screen options={{ animation: 'fade', gestureEnabled: false }} />
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.invink, opacity: live ? breath : 0.4 }} />
        <T size={12} w={600} mono ls={0.08} color={c.invink}>{live ? 'ALERTA OFICIAL' : 'ALERTA OFICIAL · VENCIDO'}</T>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 22, paddingVertical: 8 }}>
        <View style={{ width: 88, height: 88 }}>
          {rings.map((r, i) => (
            <Animated.View key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, borderWidth: 1.5, borderColor: c.invink,
              opacity: r.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion || !live ? 0 : 0.6, 0] }), transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }} />
          ))}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 44, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="warning" size={44} fill color={c.ink} />
          </View>
        </View>
        <View style={{ gap: 12 }} accessibilityRole="alert">
          <T size={32} w={700} ls={-0.04} lh={1.05} color={c.invink}>{alertTitle(a)}</T>
          <T size={12.5} w={600} mono color={c.invink} style={{ opacity: 0.75 }}>{sourceLabel(a)}</T>
          {!!a.info.description && <T size={16} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>{a.info.description}</T>}
        </View>
        {!!a.info.instruction && (
          <View style={{ gap: 6 }}>
            <T size={11.5} w={600} mono ls={0.06} color={c.invink} style={{ opacity: 0.7 }}>O QUE FAZER</T>
            <T size={15} lh={1.45} color={c.invink}>{a.info.instruction}</T>
          </View>
        )}
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: 'rgba(127,127,127,0.45)', paddingVertical: 14, paddingHorizontal: 16, gap: 9 }}>
          {rows.map(([l, v]) => (
            <View key={l} style={{ flexDirection: 'row', gap: 14 }}>
              <T size={13} color={c.invink} style={{ opacity: 0.65, width: 96 }}>{l}</T>
              <T size={13} w={600} color={c.invink} style={{ flex: 1 }} selectable>{v}</T>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Icon name="info" size={17} color={c.invink} />
          <T size={12.5} lh={1.45} color={c.invink} style={{ flex: 1, opacity: 0.8 }}>
            {`Retransmitido pelo seu Piu Node a partir do feed público ${a.source.feed || a.source.url}. Não é assinado pelo órgão: na dúvida, confirme nos canais oficiais.`}
          </T>
        </View>
      </ScrollView>
      <View style={{ gap: 10 }}>
        {!!(a.info.web || a.source.url) && (
          <Button label="Abrir a fonte" variant="inverse" height={50} onPress={() => { void Linking.openURL(a.info.web || a.source.url).catch(() => {}); }} />
        )}
        <Button label="Entendi" variant="ghostInverse" height={50} style={{ borderWidth: 1, borderColor: 'rgba(127,127,127,0.5)' }} onPress={close} />
      </View>
    </View>
  );
}
