import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/** Banner in-app: entra em 500 ms, fica 4,5 s com barra de tempo, toque fecha (ou abre o destino). */
export function Toast() {
  const { toast, dismissToast } = useStore();
  if (!toast) return null;
  return <ToastCard key={toast.seq} {...toast} onPress={() => { toast.go?.(); dismissToast(); }} />;
}

function ToastCard({ icon, av, title, body, onPress }: { icon?: string; av?: string; title: string; body: string; onPress: () => void }) {
  const { c, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const bar = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!reduceMotion) Animated.timing(enter, { toValue: 1, duration: 500, easing: Easing.bezier(0.2, 0.9, 0.3, 1.15), useNativeDriver: true }).start();
    Animated.timing(bar, { toValue: 0, duration: 4500, easing: Easing.linear, useNativeDriver: true }).start();
  }, [reduceMotion, enter, bar]);
  return (
    <Animated.View accessibilityLiveRegion="polite" style={{
      position: 'absolute', top: insets.top + 6, left: 10, right: 10, zIndex: 50,
      opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
    }}>
      <Pressable onPress={onPress} accessibilityRole="alert" accessibilityLabel={`${title}. ${body}`}
        style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 16 }, elevation: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 12 }}>
          {av ? (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}><T size={14} w={600}>{av}</T></View>
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name={(icon ?? 'check') as IconName} size={22} color={c.invink} /></View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={14.5} w={650} numberOfLines={1} style={{ flex: 1 }}>{title}</T>
              <T size={12} color={c.ink2}>agora</T>
            </View>
            <T size={13.5} lh={1.35} color={c.ink2} numberOfLines={2}>{body}</T>
          </View>
        </View>
        <Animated.View style={{ height: 2, backgroundColor: c.ink, opacity: 0.35, transform: [{ scaleX: bar }], transformOrigin: 'left' }} />
      </Pressable>
    </Animated.View>
  );
}
