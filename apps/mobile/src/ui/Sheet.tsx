import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';

export interface SheetHandle { close: (after?: () => void) => void }

/**
 * Folha inferior do design: raio 30 no topo, sombra 0 -10 40 .18,
 * entra em 380 ms (translateY 100% → 0) com o fundo escurecendo em 220 ms.
 */
export const Sheet = forwardRef<SheetHandle, { onClose: () => void; label: string; children: ReactNode; padH?: number; gap?: number }>(
  function Sheet({ onClose, label, children, padH = 20, gap = 18 }, ref) {
    const { c, reduceMotion } = useTheme();
    const t = useT();
    const insets = useSafeAreaInsets();
    const scrim = useRef(new Animated.Value(0)).current;
    const y = useRef(new Animated.Value(Dimensions.get('window').height)).current;

    useEffect(() => {
      if (reduceMotion) { scrim.setValue(1); y.setValue(0); return; }
      Animated.parallel([
        Animated.timing(scrim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: true }),
      ]).start();
    }, [reduceMotion, scrim, y]);

    const close = (after?: () => void) => {
      const done = () => { onClose(); after?.(); };
      if (reduceMotion) return done();
      Animated.parallel([
        Animated.timing(scrim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(y, { toValue: Dimensions.get('window').height, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(done);
    };
    useImperativeHandle(ref, () => ({ close }));

    return (
      <Modal transparent visible animationType="none" onRequestClose={() => close()} statusBarTranslucent>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim, opacity: scrim }}>
          <Pressable style={{ flex: 1 }} onPress={() => close()} accessibilityRole="button" accessibilityLabel={t('sheet.close', { label: label.toLowerCase() })} />
        </Animated.View>
        <Animated.View accessibilityViewIsModal accessibilityLabel={label} style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: -10 }, elevation: 16, transform: [{ translateY: y }],
        }}>
          <ScrollView contentContainerStyle={{ paddingTop: 10, paddingHorizontal: padH, paddingBottom: Math.max(insets.bottom, 16) + 16, gap }}>
            <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
            {children}
          </ScrollView>
        </Animated.View>
      </Modal>
    );
  },
);
