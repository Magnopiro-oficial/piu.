import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CallController } from '../../calls/callController';
import { CALL_TIMING, fmtDuration } from '../../calls/callMachine';
import { routeVia, type CallScene } from '../../calls/callView';
import { barHeight, voiceNow } from '../../calls/callVisual';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../Icon';
import { T } from '../T';
import { EASE_BOUNCE, EASE_ENTER, EASE_LINEAR, useFrameLoop, useShown, useTick } from './anim';
import { useCallT } from './CallContext';

const INK = '#0c0c0c';

/**
 * Aviso de chamada com o app aberto (§4.3): preto, raio 32, desce do topo (−160 → 0, .55 s, quique).
 * Recusar e atender num toque; tocar no corpo abre a tela de toque em tela cheia.
 */
export function CallBanner({ scene, on, controller, onExpand }: { scene: CallScene; on: boolean; controller: CallController; onExpand: () => void }) {
  const t = useT();
  const tr = useCallT();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const v = useShown(on, 550, EASE_BOUNCE);
  const ct = scene.contact;
  const hidden = -Math.max(160, insets.top + 130);
  return (
    <Animated.View pointerEvents={on ? 'auto' : 'none'} accessibilityLiveRegion="assertive" importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      style={{
        position: 'absolute', top: insets.top + 4, left: 10, right: 10, padding: 12, borderRadius: 32, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', gap: 12,
        boxShadow: scheme === 'dark' ? '0 0 0 1px rgba(255,255,255,0.12), 0 20px 40px -14px rgba(0,0,0,0.5)' : '0 20px 40px -14px rgba(0,0,0,0.5)',
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [hidden, 0] }) }],
      }}>
      <Pressable onPress={onExpand} accessibilityRole="button" accessibilityLabel={`${ct.name}. ${t('call.incoming.banner', { via: routeVia(tr, scene.state.route) })}`}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 27, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' }} />
          <T size={15} w={700} color={INK}>{ct.initials}</T>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={15} w={650} color="#fff" numberOfLines={1}>{ct.name}</T>
          <T size={12.5} color="rgba(255,255,255,0.65)" numberOfLines={1}>{t('call.incoming.banner', { via: routeVia(tr, scene.state.route) })}</T>
        </View>
      </Pressable>
      <Pressable onPress={() => controller.decline()} accessibilityRole="button" accessibilityLabel={t('call.decline')}
        style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="call_end" size={22} fill color="#fff" />
      </Pressable>
      <Pressable onPress={() => controller.answer()} accessibilityRole="button" accessibilityLabel={t('call.answer')}
        style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="call" size={22} fill color={INK} />
      </Pressable>
    </Animated.View>
  );
}

/** Notificação de pedido de chamada (§4.6): branca, desce do topo (−280 → 0, .55 s, quique). */
export function RequestNotice({ scene, on, controller }: { scene: CallScene; on: boolean; controller: CallController }) {
  const t = useT();
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const v = useShown(on, 550, EASE_BOUNCE);
  const ct = scene.contact;
  const hidden = -Math.max(280, insets.top + 250);
  return (
    <Animated.View pointerEvents={on ? 'auto' : 'none'} accessibilityLiveRegion="assertive" importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      style={{
        position: 'absolute', top: insets.top + 4, left: 10, right: 10, padding: 16, borderRadius: 30, backgroundColor: scheme === 'dark' ? c.bg2 : c.bg, gap: 10,
        boxShadow: `0 0 0 1px ${scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}, 0 24px 48px -16px rgba(0,0,0,0.35)`,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [hidden, 0] }) }],
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T size={9} w={750} ls={-0.06} color={c.invink}>piu</T>
        </View>
        <T size={12} color={c.ink2}>{t('call.req.app')}</T>
      </View>
      <T size={16} w={650} ls={-0.01}>{t('call.req.title', { name: ct.name })}</T>
      <T size={13.5} lh={1.45} color={c.ink2}>{t('call.req.body')}</T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Pressable onPress={() => controller.requestNow()} accessibilityRole="button"
          style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <T size={14} w={650} color={c.invink}>{t('call.req.now')}</T>
        </Pressable>
        <Pressable onPress={() => controller.dispatch({ type: 'requestLater' })} accessibilityRole="button"
          style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: scheme === 'dark' ? c.bg3 : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <T size={14} w={600}>{t('call.req.later')}</T>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * Pílula da chamada minimizada (§4.10): preta, 42 px, centrada no topo; 5 barras seguem a voz.
 * Entra com escala .4 → 1 (.45 s, quique) e opacidade (.3 s). Tocar volta para a tela cheia.
 */
export function MiniPill({ scene, on, controller, now }: { scene: CallScene; on: boolean; controller: CallController; now: () => number }) {
  const t = useT();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const scale = useShown(on, 450, EASE_BOUNCE);
  const opacity = useShown(on, 300, EASE_LINEAR);
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(6 / 20))).current;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useFrameLoop(on, sec => {
    const sc = sceneRef.current, st = sc.state;
    const amp = st.phase === 'active' ? voiceNow({ ...sc.levels(), muted: st.muted, switching: !!st.switching, soft: sc.soft }).amp : 0;
    bars.forEach((b, i) => b.setValue(barHeight(i, sec, amp) / 20));
  });
  useTick(on);
  const s = scene.state;
  const timer = s.phase === 'active' ? fmtDuration(now() - (s.connectedAt ?? now())) : '';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 2, left: 0, right: 0, alignItems: 'center' }}>
      <Animated.View pointerEvents={on ? 'auto' : 'none'} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'} style={{ opacity, transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>
        <Pressable onPress={() => controller.dispatch({ type: 'restore' })} accessibilityRole="button" accessibilityLabel={`${t('call.voice')} · ${scene.contact.name} · ${timer}`}
          style={{ height: 42, paddingLeft: 14, paddingRight: 16, borderRadius: 21, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', gap: 10, boxShadow: scheme === 'dark' ? '0 0 0 1px rgba(255,255,255,0.12)' : undefined }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 }}>
            {bars.map((b, i) => <Animated.View key={i} style={{ width: 3, height: 20, borderRadius: 2, backgroundColor: '#fff', transform: [{ scaleY: b }] }} />)}
          </View>
          <T size={13.5} w={600} color="#fff" numberOfLines={1}>{scene.contact.first}</T>
          <T size={13} w={500} mono tabular color="rgba(255,255,255,0.7)">{timer}</T>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Aviso escuro da chamada (§5.6): sobe 16 px com opacidade (.4 s), some em 2,4 s. */
export function CallToast({ toast, onDark }: { toast?: { text: string; seq: number } | null; onDark?: boolean }) {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const [shown, setShown] = useState<{ text: string; seq: number } | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setOn(true);
    const h = setTimeout(() => setOn(false), CALL_TIMING.toastMs);
    return () => clearTimeout(h);
  }, [toast?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useShown(on, 400, EASE_ENTER);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(108, insets.bottom + 74), alignItems: 'center' }}>
      <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{
        height: 42, paddingHorizontal: 18, borderRadius: 21, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', gap: 8,
        boxShadow: scheme === 'dark' || onDark ? '0 0 0 1px rgba(255,255,255,0.12)' : undefined,
        opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}>
        <Icon name="check" size={18} color="#fff" />
        <T size={13.5} w={550} color="#fff" numberOfLines={1}>{shown.text}</T>
      </Animated.View>
    </View>
  );
}
