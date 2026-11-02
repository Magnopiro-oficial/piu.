import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/** Título de etapa: rótulo mono (PASSO N DE 4 · …) + H1 28/650. */
export function StepHeader({ step, title, sub }: { step: string; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 24, paddingBottom: 14, gap: 8 }}>
      <T size={12} w={500} mono ls={0.04} color={c.ink2}>{step}</T>
      <T size={28} w={650} ls={-0.035} lh={1.05} accessibilityRole="header">{title}</T>
      {sub ? <T size={14} lh={1.4} color={c.ink2}>{sub}</T> : null}
    </View>
  );
}

/** Radio circular 22 px do design. */
export function RadioDot({ on }: { on: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink, opacity: on ? 1 : 0 }} />
    </View>
  );
}
