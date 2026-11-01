import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Chat, Msg } from '../data/types';
import { buildRoute } from '../lib/route';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { T } from './T';

/**
 * Folha “Rota da mensagem”: barra de 4 etapas, saltos com o transporte de cada um,
 * envelope, fragmentos, validade, prioridade e a nota de que os nós no caminho não leem nada.
 */
export function RouteSheet({ chat, msg, onClose }: { chat: Chat; msg: Msg; onClose: () => void }) {
  const { c, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const r = buildRoute(chat, msg);
  const scrim = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  useEffect(() => {
    if (reduceMotion) { scrim.setValue(1); y.setValue(0); return; }
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 380, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, scrim, y]);

  const close = () => {
    if (reduceMotion) return onClose();
    Animated.parallel([
      Animated.timing(scrim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(y, { toValue: Dimensions.get('window').height, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => onClose());
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim, opacity: scrim }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="Fechar rota" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: -10 }, elevation: 16, transform: [{ translateY: y }],
      }}>
        <ScrollView contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 16, gap: 18 }}>
          <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
          <View style={{ gap: 6 }}>
            <T size={22} w={700} ls={-0.03} accessibilityRole="header">Rota da mensagem</T>
            <T size={14} color={c.ink2} numberOfLines={1}>“{r.text}”</T>
          </View>

          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={'Etapa: ' + (r.steps.find(s => s.current)?.label ?? '')}>
            {r.steps.map(s => (
              <View key={s.label} style={{ flex: 1, gap: 7 }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: s.done ? c.ink : c.bg3 }} />
                <T size={11.5} w={s.current ? 650 : 450} lh={1.2} color={s.done ? c.ink : c.ink2}>{s.label}</T>
              </View>
            ))}
          </View>

          <View style={{ paddingVertical: 4 }}>
            {r.hops.map((h, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 14 }}>
                <View style={{ width: 18, alignItems: 'center' }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 1.5, borderColor: c.ink, backgroundColor: h.reached ? c.ink : 'transparent' }} />
                  {!h.last && <View style={{ flex: 1, width: 0, borderLeftWidth: 1.5, borderStyle: h.solid ? 'solid' : 'dashed', borderColor: c.ink, opacity: 0.5, marginVertical: 3 }} />}
                </View>
                <View style={{ flex: 1, gap: 2, paddingBottom: h.last ? 0 : 14 }}>
                  <T size={15} w={600} color={h.reached ? c.ink : c.ink2}>{h.n}</T>
                  <T size={12} mono color={c.ink2}>{h.k}</T>
                  {!h.last && (
                    <View style={{ alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8, backgroundColor: c.bg2 }}>
                      <Icon name={h.viaIcon} size={14} />
                      <T size={11.5} w={500} mono>{h.via}</T>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {r.meta.map(x => (
              <View key={x.l} style={{ width: '48.5%', flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg2, gap: 3 }}>
                <T size={11.5} color={c.ink2}>{x.l}</T>
                <T size={14} w={500} mono>{x.v}</T>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="lock" size={18} />
            <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}>Os nós intermediários transportam apenas o envelope cifrado. Nenhum deles consegue ler esta mensagem.</T>
          </View>
          <Button label="Fechar" variant="soft" height={50} onPress={close} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}
