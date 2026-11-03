import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { lockItems, lockTime } from '../lib/lockFeed';
import { useMessaging } from '../state/messaging';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../ui/Icon';
import { T } from '../ui/T';

/**
 * Prévia da tela bloqueada: as notificações reais recentes (mensagens recebidas ainda não lidas e
 * alertas Graves da comunidade vigentes e não contestados), como aparecem com a pré-visualização
 * escolhida (lib/lockFeed.ts). Sem nada novo, vazio.
 */
export default function Lock() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { preview, notifs } = useSettings();
  const { chats } = useStore();
  const { alerts: ops, alertEpoch } = useMessaging();
  void alertEpoch;
  const alerts = ops?.list() ?? [];
  const hidden = preview !== 'always';
  const now = new Date();
  const items = lockItems({ chats, preview, notifs, alerts, now: now.getTime() });
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit' });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}>
      <Svg style={{ position: 'absolute', top: 0, left: 0 }} width="100%" height="100%" pointerEvents="none">
        <Defs><Pattern id="lockdots" width={18} height={18} patternUnits="userSpaceOnUse"><Circle cx={9} cy={9} r={1} fill={c.dot} /></Pattern></Defs>
        <Rect width="100%" height="100%" fill="url(#lockdots)" />
      </Svg>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Fechar prévia da tela bloqueada"
        style={{ position: 'absolute', top: insets.top + 8, right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
        <Icon name="close" size={20} />
      </Pressable>
      <View style={{ paddingTop: 56, alignItems: 'center', gap: 2 }}>
        <T size={17} w={550} color={c.ink2}>{date}</T>
        <T size={96} w={600} ls={-0.06} tabular style={{ lineHeight: 100 }}>{time}</T>
      </View>
      {hidden && (
        <View style={{ alignSelf: 'center', marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: c.bg2 }}>
          <Icon name="visibility_off" size={15} color={c.ink2} />
          <T size={12} w={550} color={c.ink2}>Conteúdo oculto na tela bloqueada</T>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 24, paddingHorizontal: 10, paddingBottom: 16, gap: 8 }}>
        {!items.length && (
          <View accessibilityLiveRegion="polite" style={{ alignSelf: 'center', marginTop: 24, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: c.bg2 }}>
            <T size={13.5} color={c.ink2} align="center">Nenhuma notificação nova.</T>
          </View>
        )}
        {items.map(n => {
          const bg = n.critical ? c.ink : c.bg2, fg = n.critical ? c.invink : c.ink;
          const time = lockTime(n, now.getTime());
          const stacked = n.more > 0;
          return (
            <Pressable key={n.id} onPress={() => router.push(n.href as Href)} accessibilityRole="button" accessibilityLabel={`${n.title}, ${time}. ${n.body}`}
              style={({ pressed }) => ({ marginBottom: stacked ? 12 : 0, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              {stacked && (
                <>
                  <View style={{ position: 'absolute', left: 22, right: 22, bottom: -12, height: 30, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, backgroundColor: c.bg3, opacity: 0.55 }} />
                  <View style={{ position: 'absolute', left: 11, right: 11, bottom: -6, height: 30, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, backgroundColor: c.bg3 }} />
                </>
              )}
              <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 22, backgroundColor: bg, borderWidth: 1, borderColor: c.line }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: n.critical ? c.invink : c.ink, alignItems: 'center', justifyContent: 'center' }}>
                  {n.critical ? <Icon name="warning" size={22} fill color={c.ink} /> : <T size={12.5} w={750} ls={-0.05} color={c.invink}>piu</T>}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <T size={14.5} w={650} color={fg} numberOfLines={1} style={{ flex: 1 }}>{n.title}</T>
                    <T size={12} color={fg} style={{ opacity: 0.6 }}>{time}</T>
                  </View>
                  <T size={14} lh={1.35} color={fg} numberOfLines={2} style={{ opacity: 0.85 }}>{n.body}</T>
                  {stacked && !hidden && <T size={12.5} color={fg} style={{ opacity: 0.6, marginTop: 2 }}>{n.more === 1 ? 'mais 1 mensagem' : `mais ${n.more} mensagens`}</T>}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 44, paddingTop: 8, paddingBottom: 12 }}>
        {(['flashlight_on', 'photo_camera'] as const).map(ic => (
          <View key={ic} style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={ic} size={22} /></View>
        ))}
      </View>
    </View>
  );
}
