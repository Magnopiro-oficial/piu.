import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT, type Key } from '../../i18n';
import { useStore } from '../../state/store';
import { useMessaging } from '../../state/messaging';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../../ui/Icon';
import { T } from '../../ui/T';

const TABS: Record<string, [Key, IconName]> = {
  index: ['tabs.chats', 'chat_bubble'], nearby: ['tabs.nearby', 'radar'], network: ['tabs.network', 'hub'],
  wallet: ['tabs.wallet', 'account_balance_wallet'], profile: ['tabs.profile', 'person'],
};

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={p => <TabBar {...p} />}>
      {Object.keys(TABS).map(name => <Tabs.Screen key={name} name={name} />)}
    </Tabs>
  );
}

/** Barra inferior de 84 px (+ área segura): ícone preenchido e “bump” na aba ativa, badge de não lidas. */
function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { chats, identity } = useStore();
  const { nearby } = useMessaging();
  const pending = (nearby?.requests ?? []).filter(r => r.status === 'pending').length;
  const unread = chats.filter(x => x.ident === identity).reduce((n, x) => n + x.unread, 0);
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingTop: 8, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 10), minHeight: 84, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line }}>
      {state.routes.map((r, i) => {
        const [key, icon] = TABS[r.name] ?? [null, 'chat_bubble'];
        return (
          <Tab key={r.key} label={key ? t(key) : r.name} icon={icon} active={state.index === i} badge={r.name === 'index' ? unread : r.name === 'nearby' ? pending : 0}
            badgeLabel={r.name === 'nearby' ? t('nearby.requests.a11y', { count: pending }) : undefined}
            onPress={() => { if (state.index !== i) navigateToTab(r.key); }} />
        );
      })}
    </View>
  );
}

function Tab({ label, icon, active, badge, badgeLabel, onPress }: { label: string; icon: IconName; active: boolean; badge: number; badgeLabel?: string; onPress: () => void }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const bump = useRef(new Animated.Value(1)).current; // progresso 0 → 1
  useEffect(() => {
    if (!active || reduceMotion) return;
    // Bump de 400 ms (design: 1 → .8 aos 35% → 1,14 aos 70% → 1).
    bump.setValue(0);
    Animated.timing(bump, { toValue: 1, duration: 400, easing: Easing.linear, useNativeDriver: true }).start();
  }, [active, reduceMotion, bump]);
  const color = active ? c.ink : c.ink2;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={badge ? `${label}, ${badgeLabel ?? t('common.unread', { count: badge })}` : label}
      onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Animated.View style={{ transform: [{ scale: bump.interpolate({ inputRange: [0, 0.35, 0.7, 1], outputRange: [1, 0.8, 1.14, 1] }) }] }}><Icon name={icon} size={26} fill={active} color={color} /></Animated.View>
      <T size={11} w={active ? 650 : 500} color={color}>{label}</T>
      {badge > 0 && (
        <View style={{ position: 'absolute', top: -3, left: '50%', marginLeft: 6, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: c.ink, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <T size={10.5} w={600} color={c.invink}>{badge}</T>
        </View>
      )}
    </Pressable>
  );
}
