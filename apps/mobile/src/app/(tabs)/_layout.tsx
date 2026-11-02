import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../../ui/Icon';
import { T } from '../../ui/T';

const TABS: Record<string, [string, IconName]> = {
  index: ['Conversas', 'chat_bubble'], nearby: ['Por perto', 'radar'], network: ['Rede', 'hub'],
  wallet: ['Carteira', 'account_balance_wallet'], profile: ['Perfil', 'person'],
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
  const { chats, identity } = useStore();
  const unread = chats.filter(x => x.ident === identity).reduce((n, x) => n + x.unread, 0);
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingTop: 8, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 10), minHeight: 84, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line }}>
      {state.routes.map((r, i) => {
        const [label, icon] = TABS[r.name] ?? [r.name, 'chat_bubble'];
        return (
          <Tab key={r.key} label={label} icon={icon} active={state.index === i} badge={r.name === 'index' ? unread : 0}
            onPress={() => { if (state.index !== i) navigateToTab(r.key); }} />
        );
      })}
    </View>
  );
}

function Tab({ label, icon, active, badge, onPress }: { label: string; icon: IconName; active: boolean; badge: number; onPress: () => void }) {
  const { c, reduceMotion } = useTheme();
  const bump = useRef(new Animated.Value(1)).current; // progresso 0 → 1
  useEffect(() => {
    if (!active || reduceMotion) return;
    // Bump de 400 ms (design: 1 → .8 aos 35% → 1,14 aos 70% → 1).
    bump.setValue(0);
    Animated.timing(bump, { toValue: 1, duration: 400, easing: Easing.linear, useNativeDriver: true }).start();
  }, [active, reduceMotion, bump]);
  const color = active ? c.ink : c.ink2;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={badge ? `${label}, ${badge} não lidas` : label}
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
