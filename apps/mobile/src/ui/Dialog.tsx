import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/**
 * Diálogo de confirmação: entra em 320 ms (scale .9 → 1), ícone com “pop”.
 * Com `hold`, a ação principal só acontece segurando o botão (~1 s), para ações irreversíveis.
 */
export function Dialog({ icon, title, body, primary, primaryIcon, onPrimary, secondary = 'Cancelar', onClose, hold }: {
  icon: IconName; title: string; body: string; primary: string; primaryIcon?: IconName; onPrimary: () => void; secondary?: string; onClose: () => void; hold?: boolean;
}) {
  const { c, reduceMotion } = useTheme();
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (!reduceMotion) Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.bezier(0.2, 0.9, 0.3, 1.25), useNativeDriver: true }).start();
  }, [reduceMotion, v]);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} onPress={onClose} accessibilityRole="button" accessibilityLabel={secondary} />
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26 }}>
        <Animated.View accessibilityViewIsModal accessibilityRole="alert" style={{
          backgroundColor: c.bg, borderRadius: 30, paddingTop: 26, paddingHorizontal: 18, paddingBottom: 18, alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: c.line2, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 30, shadowOffset: { width: 0, height: 24 }, elevation: 20,
          opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
        }}>
          <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={28} w={300} /></View>
          <T size={20} w={700} ls={-0.025} lh={1.15} align="center">{title}</T>
          <T size={14} lh={1.45} color={c.ink2} align="center" style={{ paddingHorizontal: 4 }}>{body}</T>
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 8 }}>
            {hold
              ? <HoldButton label={primary} icon={primaryIcon} onDone={onPrimary} />
              : <Button label={primary} height={52} onPress={onPrimary} left={primaryIcon ? <Icon name={primaryIcon} size={19} color={c.invink} /> : undefined} />}
            <Button label={secondary} variant="soft" height={48} onPress={onClose} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Botão "segure para confirmar": enche da esquerda para a direita; soltar antes cancela. */
function HoldButton({ label, icon, onDone }: { label: string; icon?: IconName; onDone: () => void }) {
  const { c } = useTheme();
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stop = () => { clearInterval(timer.current); setPct(0); };
  const start = () => {
    clearInterval(timer.current);
    timer.current = setInterval(() => setPct(p => {
      const n = Math.min(100, p + 2.5); // 2,5% a cada 30 ms = 1,2 s, como no design
      if (n >= 100) { clearInterval(timer.current); setTimeout(onDone, 0); }
      return n;
    }), 30);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <Pressable onPressIn={start} onPressOut={() => { if (pct < 100) stop(); }} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint="Segure por um segundo para confirmar" accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={onDone}
      style={{ height: 52, borderRadius: 26, backgroundColor: c.ink, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: c.invink, opacity: 0.25 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon && <Icon name={icon} size={19} color={c.invink} />}
        <T size={15.5} w={600} color={c.invink}>{pct > 0 ? 'Continue segurando…' : label}</T>
      </View>
    </Pressable>
  );
}
