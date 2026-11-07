/**
 * Peças das telas do ponto Piu (design "Piu 13 Pontos Piu", P1–P9): valores copiados do protótipo
 * (raios, tamanhos, pesos, cores de estado). Só apresentação; o estado vem de state/point.tsx.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';

/** Cores de estado do teste (P4a–c): verde, amarelo, vermelho. */
export const OK = '#1f9d55';
export const WARN = '#e0a100';
export const BAD = '#d23c2a';

/** Corpo das telas: padding 6 20 32, gap 16; o espaço que sobra empurra os botões para baixo. */
export function Body({ children, gap = 16, footer }: { children: ReactNode; gap?: number; footer?: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 6, paddingHorizontal: 20, paddingBottom: 32, gap }} keyboardShouldPersistTaps="handled">
      {children}
      <View style={{ flex: 1 }} />
      {footer}
    </ScrollView>
  );
}

/** Rótulo mono 12/500 +0,04em (PASSO 1 DE 4, POR PERTO, ALTERNATIVAS…). */
export function Mono({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={style}><T size={12} w={500} mono ls={0.04} color={c.ink2}>{children.toUpperCase()}</T></View>;
}

/** Passo + título 28/700 + texto 15 (gap 9). */
export function StepTitle({ step, title, sub }: { step?: string; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 9 }}>
      {step ? <Mono>{step}</Mono> : null}
      <T size={28} w={700} ls={-0.045} lh={1.05} accessibilityRole="header">{title}</T>
      {sub ? <T size={15} lh={1.45} color={c.ink2}>{sub}</T> : null}
    </View>
  );
}

/** Caixa cinza (raio 20) com linhas separadas por fio. */
export function ListBox({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>{children}</View>;
}

/** Linha de lista: ícone 21 (traço 300), título 15/550, detalhe 12,5 e um elemento à direita (padrão: chevron). */
export function NavRow({ icon, title, sub, right, onPress, first, label }: {
  icon: IconName; title: string; sub?: string; right?: ReactNode | null; onPress?: () => void; first?: boolean; label?: string;
}) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: c.line }}>
      <Icon name={icon} size={21} w={300} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} w={550}>{title}</T>
        {sub ? <T size={12.5} lh={1.35} color={c.ink2}>{sub}</T> : null}
      </View>
      {right === undefined ? <Icon name="chevron_right" size={20} color={c.ink3} /> : right}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable>;
}

/** Tabela chave → valor (raio 20, `bg2`, padding 2 16; linhas 12 px, 14). */
export function KV({ rows }: { rows: [string, string][] }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: 20, backgroundColor: c.bg2, paddingVertical: 2, paddingHorizontal: 16 }}>
      {rows.map(([k, v], i) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
          <T size={14} color={c.ink2}>{k}</T>
          <T size={14} w={550} tabular align="right" style={{ flexShrink: 1 }}>{v}</T>
        </View>
      ))}
    </View>
  );
}

/** Ponto 8 px com anel pulsando (2 s) — "ligado". Para com "reduzir movimento". */
export function PulseDot({ color }: { color?: string }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [reduceMotion, v]);
  const ink = color ?? c.ink;
  return (
    <View style={{ width: 8, height: 8 }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 4, backgroundColor: ink }} />
      {!reduceMotion && <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 4, borderWidth: 1, borderColor: ink,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }} />}
    </View>
  );
}

/** Spinner 18 px (borda 2 `bg3`, topo `ink`), 0,9 s por volta. */
export function Spinner({ size = 18 }: { size?: number }) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [reduceMotion, v]);
  return <Animated.View accessibilityLabel="…" style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: c.bg3, borderTopColor: c.ink,
    transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />;
}

/** Chacoalha uma vez (0,45 s) quando `trigger` muda (erros). */
export function Shake({ trigger, children }: { trigger: unknown; children: ReactNode }) {
  const { reduceMotion } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduceMotion || !trigger) return;
    const step = (to: number) => Animated.timing(x, { toValue: to, duration: 90, easing: Easing.linear, useNativeDriver: true });
    Animated.sequence([step(-6), step(6), step(-6), step(6), step(0)]).start();
  }, [trigger, reduceMotion, x]);
  return <Animated.View style={{ transform: [{ translateX: x }] }}>{children}</Animated.View>;
}

/** Círculo 22 px de estado (verde ✓, amarelo !, vermelho ✕). */
export function StateDot({ state }: { state: 'ok' | 'warn' | 'bad' }) {
  const bg = state === 'ok' ? OK : state === 'warn' ? WARN : BAD;
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={state === 'ok' ? 'check' : state === 'warn' ? 'priority_high' : 'close'} size={15} color="#ffffff" />
    </View>
  );
}

/** Linha de resultado (P4a–c): círculo + título 14,5/600 + detalhe 12,5. */
export function ResultRow({ state, title, sub }: { state: 'ok' | 'warn' | 'bad'; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.line }}>
      <StateDot state={state} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={14.5} w={600}>{title}</T>
        {sub ? <T size={12.5} lh={1.35} color={c.ink2}>{sub}</T> : null}
      </View>
    </View>
  );
}

/** Botão pequeno das cartas (40 px, raio 20): `primary` tinta, senão transparente. */
export function SmallBtn({ label, onPress, primary, disabled }: { label: string; onPress?: () => void; primary?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: primary ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : pressed ? 0.8 : 1 })}>
      <T size={14} w={primary ? 600 : 550} color={primary ? c.invink : c.ink}>{label}</T>
    </Pressable>
  );
}

/**
 * Carta de estado (P4a–c, P7a–d): raio 24, fio `line2`, padding 20, gap 14; ícone 44 (raio 13) invertido
 * (`inv`) ou cinza; título 17/700; texto 13,5; ações à direita.
 */
export function StateCard({ icon, inv, title, body, children, actions }: {
  icon: IconName; inv?: boolean; title: string; body?: string; children?: ReactNode; actions?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="summary" style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line2, padding: 20, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: inv ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={23} w={inv ? 400 : 300} color={inv ? c.invink : c.ink} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T size={17} w={700} ls={-0.02}>{title}</T>
          {body ? <T size={13.5} lh={1.45} color={c.ink2}>{body}</T> : null}
        </View>
      </View>
      {children}
      {actions ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{actions}</View> : null}
    </View>
  );
}

/** Botão de 54 px com contorno de 1,5 px tinta (Compartilhar, Cartaz, Pausar). */
export function OutlineBtn({ label, icon, onPress, disabled }: { label: string; icon?: IconName; onPress?: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: c.ink, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <T size={16} w={600}>{label}</T>
    </Pressable>
  );
}

/** Barra de 6 px (`bg3`, preenchimento `ink`). */
export function Bar({ pct }: { pct: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.bg3, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 3, backgroundColor: c.ink }} />
    </View>
  );
}

/** Rádio 22 px (borda 2): ligado com miolo de 10 px. */
export function Radio({ on }: { on: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? c.ink : c.line2, alignItems: 'center', justifyContent: 'center' }}>
      {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} /> : null}
    </View>
  );
}

/** Controle − valor + do P5 (botões 28 px raio 8, valor 650 com 50 px). */
export function Stepper({ label, value, onMinus, onPlus, a11y }: { label: string; value: string; onMinus: () => void; onPlus: () => void; a11y: { minus: string; plus: string } }) {
  const { c } = useTheme();
  const btn = (icon: IconName, on: () => void, l: string) => (
    <Pressable onPress={on} accessibilityRole="button" accessibilityLabel={`${l}: ${label}`} hitSlop={6}
      style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 8, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={15} w={300} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 34 }}>
      <T size={13.5} color={c.ink2}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {btn('remove', onMinus, a11y.minus)}
        <T size={13.5} w={650} align="center" style={{ minWidth: 50 }} accessibilityLiveRegion="polite">{value}</T>
        {btn('add', onPlus, a11y.plus)}
      </View>
    </View>
  );
}

/** Quadradinho 20 px de selo (DESLIGADAS). */
export function Badge({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 20, paddingHorizontal: 7, borderRadius: 10, borderWidth: 1, borderColor: c.line2, alignItems: 'center', justifyContent: 'center' }}>
      <T size={10.5} w={500} mono color={c.ink2}>{children.toUpperCase()}</T>
    </View>
  );
}
