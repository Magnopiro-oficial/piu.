import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { useLayout } from '../lib/responsive';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { T } from './T';

/** Controle segmentado (raio 12, botões de 32 px). */
export function Segmented<V extends string>({ options, value, onChange, label }: { options: [V, string][]; value: V; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  const { compact } = useLayout();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 12, backgroundColor: c.bg3 }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on}
            style={{ flex: 1, minHeight: 32, paddingVertical: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: on ? c.bg : 'transparent',
              shadowColor: '#000', shadowOpacity: on ? 0.12 : 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: on ? 1 : 0 }}>
            <T size={compact ? 12 : 13} w={on ? 600 : 450} numberOfLines={2} align="center">{l}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Toggle 46×28: knob em 250 ms com leve overshoot. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  const { c, reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { x.setValue(on ? 1 : 0); return; }
    Animated.timing(x, { toValue: on ? 1 : 0, duration: 250, easing: Easing.bezier(0.2, 0.9, 0.3, 1.3), useNativeDriver: true }).start();
  }, [on, reduceMotion, x]);
  return (
    <Pressable onPress={onChange} disabled={disabled} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} aria-checked={on}
      style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: on ? c.ink : c.bg3, opacity: disabled ? 0.45 : 1 }}>
      <Animated.View style={{ position: 'absolute', top: 3, left: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: on ? c.bg : c.knob,
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }} />
    </Pressable>
  );
}

/** Rótulo de seção: mono 11,5/500/+0,05em em caixa alta. */
export function SectionLabel({ children }: { children: string }) {
  const { c } = useTheme();
  return <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8 }}>{children}</T>;
}

/** Cabeçalho de 52 px com voltar e título opcional. */
export function BackHeader({ title, right }: { title?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, height: 52 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrow_back_ios_new" size={22} />
      </Pressable>
      {title ? <T size={18} w={650} ls={-0.02} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">{title}</T> : <View style={{ flex: 1 }} />}
      {right}
    </View>
  );
}

/** Lugar do QR code: listras a 45° (placeholder do design). */
export function QrPlaceholder({ size, radius }: { size: number; radius: number }) {
  const { c } = useTheme();
  const id = 'qr' + size;
  const period = size > 80 ? 12 : 10; // listras de period/2 px, como no design
  return (
    <View accessibilityLabel="QR code (placeholder)" style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <Pattern id={id} width={period} height={period} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect width={period} height={period} fill={c.bg} />
            <Line x1={period / 4} y1={0} x2={period / 4} y2={period} stroke={c.bg3} strokeWidth={period / 2} />
          </Pattern>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
      <T size={size > 80 ? 10 : 9} w={500} mono color={c.ink2}>QR</T>
    </View>
  );
}
