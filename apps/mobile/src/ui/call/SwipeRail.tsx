import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { clampSwipe, phoneWobble, swipeResult } from '../../calls/callVisual';
import { useT } from '../../i18n';
import { swipeLabelRange } from '../../lib/callFrame';
import { Icon } from '../Icon';
import { T } from '../T';
import { EASE_SPRING, useFrameLoop } from './anim';

const DECLINE = swipeLabelRange('decline');
const ANSWER = swipeLabelRange('answer');

/**
 * Trilho de deslizar da tela de toque (§4.4): 320 × 84, puxador de 64 px. Direita atende, esquerda
 * recusa (limiar 92 px, curso ±120). Soltar antes do limiar volta com mola (.45 s). O ícone balança a
 * cada 1,5 s e para enquanto o dedo está no trilho. Leitor de tela: ações "Atender" e "Recusar".
 */
export function SwipeRail({ onAnswer, onDecline }: { onAnswer: () => void; onDecline: () => void }) {
  const t = useT();
  const x = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(0)).current;
  const start = useRef(0);
  const cur = useRef(0);
  const dragging = useRef(false);
  const done = useRef(false);
  const [declining, setDeclining] = useState(false);
  const cb = useRef({ onAnswer, onDecline });
  cb.current = { onAnswer, onDecline };

  useFrameLoop(true, s => rot.setValue(phoneWobble(s, dragging.current)));

  const pan = useMemo(() => {
    const release = () => {
      dragging.current = false;
      const r = done.current ? null : swipeResult(cur.current);
      if (r) { done.current = true; (r === 'answer' ? cb.current.onAnswer : cb.current.onDecline)(); return; }
      cur.current = 0;
      setDeclining(false);
      Animated.timing(x, { toValue: 0, duration: 450, easing: EASE_SPRING, useNativeDriver: true }).start();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !done.current,
      onMoveShouldSetPanResponder: () => !done.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = true;
        x.stopAnimation(v => { start.current = v; cur.current = v; });
      },
      onPanResponderMove: (_, g) => {
        const dx = clampSwipe(start.current + g.dx);
        cur.current = dx;
        x.setValue(dx);
        setDeclining(dx < -30);
      },
      onPanResponderRelease: release,
      onPanResponderTerminate: release,
    });
  }, [x]);

  const decline = x.interpolate({ ...DECLINE, extrapolate: 'clamp' });
  const answer = x.interpolate({ ...ANSWER, extrapolate: 'clamp' });
  return (
    <View
      accessible accessibilityRole="adjustable" accessibilityLabel={`${t('call.answer')} · ${t('call.decline')}`} accessibilityHint={t('call.swipeHint')}
      accessibilityActions={[{ name: 'activate', label: t('call.answer') }, { name: 'answer', label: t('call.answer') }, { name: 'decline', label: t('call.decline') }]}
      onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'decline') onDecline(); else onAnswer(); }}
      style={{ width: 320, height: 84, borderRadius: 42, backgroundColor: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}>
      <Animated.View style={{ position: 'absolute', left: 22, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: decline }}>
        <Icon name="call_end" size={20} color="#fff" />
        <T size={14} w={600} color="#fff">{t('call.decline')}</T>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', right: 22, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: answer }}>
        <T size={14} w={600} color="#fff">{t('call.answer')}</T>
        <Icon name="chevron_right" size={20} color="#fff" />
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{
        position: 'absolute', left: 128, top: 10, width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px -6px rgba(255,255,255,0.35)', transform: [{ translateX: x }],
      }}>
        <Animated.View style={{ transform: [{ rotate: rot.interpolate({ inputRange: [-16, 16], outputRange: ['-16deg', '16deg'] }) }] }}>
          <Icon name={declining ? 'call_end' : 'call'} size={30} fill color="#0c0c0c" />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
