import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Folha Enviar/Receber da Carteira (design: scrim `piuFade .22s`, folha `piuSheet .38s cubic-bezier(.2,.9,.3,1)`
 * subindo de translateY(100 %), raio 30 no topo, alça 38×5, padding 10/20/34, gap 18). Área rolável e
 * limitada, acima do teclado, sem alterar as outras folhas do app.
 * `covered`: a cena de pagamento cobre a tela e a folha some por baixo dela (design: `walletSheet: null` em 760 ms),
 * para a íris de Concluir revelar a carteira, não a folha. Se a cena terminar em erro, a folha volta subindo.
 */
export function TransferSheet({ onClose, label, children, covered = false }: { onClose: () => void; label: string; children: ReactNode; covered?: boolean }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const scrim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const y = useRef(new Animated.Value(reduceMotion ? 0 : Dimensions.get('window').height)).current;
  useEffect(() => {
    if (reduceMotion) { scrim.setValue(1); y.setValue(0); return; }
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, scrim, y]);
  const wasCovered = useRef(false);
  useEffect(() => {
    if (covered) { wasCovered.current = true; scrim.setValue(0); y.setValue(Dimensions.get('window').height); return; }
    if (!wasCovered.current) return;
    wasCovered.current = false;
    if (reduceMotion) { scrim.setValue(1); y.setValue(0); return; }
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: true }),
    ]).start();
  }, [covered, reduceMotion, scrim, y]);
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: c.scrim, opacity: scrim }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('sheet.close', { label: label.toLowerCase() })} style={{ flex: 1 }} />
        </Animated.View>
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View accessibilityViewIsModal accessibilityLabel={label} style={{
            maxHeight: '92%', backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden',
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: -10 }, elevation: 16, transform: [{ translateY: y }],
          }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 18, gap: 18 }}>
              <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
