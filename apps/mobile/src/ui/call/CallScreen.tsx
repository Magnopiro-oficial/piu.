import { useMemo, useRef, useState } from 'react';
import { Animated, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CallController } from '../../calls/callController';
import { controls, encChip, failNotice, routeChip, speakLine, statusLine, type CallScene, type Control } from '../../calls/callView';
import { PHONE_GEOMETRY, fitGeometry, voiceNow } from '../../calls/callVisual';
import { useT } from '../../i18n';
import { buildFrame, frameInputOf, gridOf } from '../../lib/callFrame';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';
import { CallCanvas, type CallCanvasHandle } from './CallCanvas';
import { EASE_CSS, EASE_ENTER, useFrameLoop, useShown, useTick } from './anim';
import { SwipeRail } from './SwipeRail';
import { useCallT } from './CallContext';

export const CALL_BG = '#0c0c0c';
const W = '#ffffff';

/** Medida de desempenho do laço (só a galeria de desenvolvimento usa). */
export type CallPerf = { ms: number; buckets: number; dots: number };

/**
 * Tela cheia da chamada (sempre escura): chamando, tocando (tela de toque), em chamada e fim.
 * Entra com opacidade (.45 s) e escala 1,06 → 1 (.6 s). O fundo de pontos (Skia) e o avatar andam
 * no mesmo laço por quadro; textos (cronômetro, quem fala) a cada 250 ms, como no protótipo.
 */
export function CallScreen({ scene, controller, on, locked, now, onPerf }: {
  scene: CallScene; controller: CallController; on: boolean; locked?: boolean; now: () => number; onPerf?: (p: CallPerf) => void;
}) {
  const t = useT();
  const tr = useCallT();
  const insets = useSafeAreaInsets();
  const s = scene.state;
  const c = scene.contact;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5) setSize({ w, h });
  };
  // Centro do efeito no avatar: 310 px abaixo do topo seguro (360 no protótipo, barra de 50). Em telas
  // baixas sobe até deixar o "quem fala" acima dos controles, sem passar por baixo dos selos do topo.
  const cy = size ? Math.max(insets.top + 298, Math.min(insets.top + 310, size.h - 414)) : 0;
  const namesTop = Math.max(insets.top + 88, cy - 210);
  const geo = useMemo(() => (size ? fitGeometry(PHONE_GEOMETRY, size.w, size.h, cy) : null), [size, cy]);
  const grid = useMemo(() => (geo ? gridOf(geo) : null), [geo]);

  const shown = useShown(on, 600, EASE_ENTER);
  const opacity = useShown(on, 450, EASE_ENTER);
  const canvas = useRef<CallCanvasHandle>(null);
  const avScale = useRef(new Animated.Value(1)).current;
  const avOpacity = useRef(new Animated.Value(1)).current;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const scratch = useRef<number[][]>([]);
  const lastAv = useRef({ scale: 1, opacity: 1 });
  const perf = useRef({ ms: 0, n: 0, buckets: 0 });

  useFrameLoop(on && !!geo, sec => {
    if (!geo || !grid) return;
    const t0 = onPerf ? performance.now() : 0;
    const sc = sceneRef.current, st = sc.state;
    const lv = st.phase === 'active' ? sc.levels() : { mine: 0, theirs: 0 };
    const v = voiceNow({ ...lv, muted: st.muted, switching: !!st.switching, soft: sc.soft });
    const fi = frameInputOf(st, { nowMs: now(), amp: v.amp, soft: sc.soft });
    const f = fi ? buildFrame(geo, grid, fi, sec, scratch.current) : null;
    canvas.current?.draw(f);
    const av = f?.avatar ?? { scale: 1, opacity: 1 };
    if (Math.abs(av.scale - lastAv.current.scale) > 1e-4) avScale.setValue(av.scale);
    if (Math.abs(av.opacity - lastAv.current.opacity) > 1e-4) avOpacity.setValue(av.opacity);
    lastAv.current = av;
    if (onPerf) {
      const p = perf.current;
      p.ms += performance.now() - t0; p.n++; p.buckets = Math.max(p.buckets, f?.buckets.length ?? 0);
      if (p.n >= 60) { onPerf({ ms: p.ms / p.n, buckets: p.buckets, dots: grid.n }); perf.current = { ms: 0, n: 0, buckets: 0 }; }
    }
  });

  useTick(on && (s.phase === 'active' || s.phase === 'calling' || s.phase === 'ending'));
  const nowMs = now();
  const who = s.phase === 'active' ? voiceNow({ ...scene.levels(), muted: s.muted, switching: !!s.switching, soft: scene.soft }).who : null;
  const enc = encChip(tr, s);
  const route = routeChip(tr, s, scene.latencyMs);
  const incoming = s.phase === 'ringing';
  // Tentativa que falhou: título claro embaixo do avatar e o porquê no lugar do status.
  const fail = failNotice(tr, s, c);
  const ctl = s.phase === 'calling' || s.phase === 'active' ? controls(tr, s) : [];
  const press = (k: Control) => {
    if (k.id === 'mute') controller.dispatch({ type: 'mute' });
    else if (k.id === 'speaker') controller.dispatch({ type: 'speaker' });
    else if (k.id === 'words') controller.dispatch({ type: 'openWords' });
    else if (k.id === 'chat') controller.dispatch({ type: 'minimize' });
  };

  return (
    <Animated.View onLayout={onLayout} pointerEvents={on ? 'auto' : 'none'} accessibilityViewIsModal={on} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: CALL_BG, opacity, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }] }}>
      {geo && grid && <CallCanvas ref={canvas} geometry={geo} grid={grid} />}
      {geo && (
        <>
          {/* selos: cifra/conferidas; caminho e latência só em chamada */}
          <View style={{ position: 'absolute', top: insets.top + 12, left: 0, right: 0, alignItems: 'center', gap: 8 }}>
            <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={enc.icon as IconName} size={15} color={W} />
              <T size={12.5} w={550} color={W}>{enc.text}</T>
            </View>
            {s.phase === 'active' && (
              <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name={route.icon as IconName} size={15} color={W} />
                <T size={12.5} w={550} color={W}>{route.text}</T>
                {!!route.q && <T size={12.5} w={550} mono color="rgba(255,255,255,0.6)">{route.q}</T>}
              </View>
            )}
          </View>

          <View style={{ position: 'absolute', top: namesTop, left: 24, right: 24, alignItems: 'center', gap: 8 }}>
            {incoming && <T size={11.5} w={500} mono ls={0.08} color="rgba(255,255,255,0.6)">{t('call.incoming.label')}</T>}
            <T size={38} w={700} ls={-0.05} lh={1.1} color={W} align="center" numberOfLines={2} accessibilityRole="header">{c.name}</T>
            <T size={14} w={500} mono color="rgba(255,255,255,0.7)" align="center" style={{ minHeight: 20 }} accessibilityLiveRegion={fail ? 'none' : 'polite'} importantForAccessibility={fail ? 'no' : 'auto'} accessibilityElementsHidden={!!fail}>{fail ? fail.sub : statusLine(tr, s, c, nowMs)}</T>
          </View>

          <Animated.View accessible={false} style={{
            position: 'absolute', left: geo.cx - 60, top: geo.cy - 60, width: 120, height: 120, borderRadius: 60, backgroundColor: W,
            alignItems: 'center', justifyContent: 'center', opacity: avOpacity, transform: [{ scale: avScale }],
          }}>
            <T size={40} w={700} ls={-0.04} color={CALL_BG}>{c.initials}</T>
          </Animated.View>

          {fail ? (
            // Título e porquê num anúncio só (a linha de status, com o porquê, sai do anúncio).
            <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={`${fail.title}. ${fail.sub}`} style={{ position: 'absolute', top: geo.cy + 108, left: 24, right: 24, alignItems: 'center' }}>
              <View style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={fail.icon as IconName} size={20} color={W} />
                <T size={16} w={650} color={W} numberOfLines={2}>{fail.title}</T>
              </View>
            </View>
          ) : (
            <T size={14} color="rgba(255,255,255,0.75)" align="center" style={{ position: 'absolute', top: geo.cy + 118, left: 24, right: 24, minHeight: 20 }}>
              {speakLine(tr, s, c, who, { locked })}
            </T>
          )}

          {incoming && (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(40, insets.bottom + 16), alignItems: 'center', gap: 26 }}>
              <View style={{ flexDirection: 'row', gap: 56 }}>
                <RoundAction icon="sms" label={t('call.message')} onPress={() => controller.decline('message')} />
                <RoundAction icon="alarm" label={t('call.later')} onPress={() => controller.decline('later')} />
              </View>
              <SwipeRail key={s.callId} onAnswer={() => controller.answer()} onDecline={() => controller.decline()} />
              <T size={12.5} color="rgba(255,255,255,0.55)" style={{ marginTop: -14 }}>{t('call.swipeHint')}</T>
            </View>
          )}

          {ctl.length > 0 && (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(48, insets.bottom + 24), alignItems: 'center', gap: 30 }}>
              <View style={{ flexDirection: 'row', gap: 22, justifyContent: 'center' }}>
                {ctl.map(k => <Toggle key={k.id} k={k} onPress={() => press(k)} />)}
              </View>
              <Pressable onPress={() => controller.hangup()} accessibilityRole="button" accessibilityLabel={t('call.ctl.hangup')}
                style={({ pressed }) => ({
                  width: 78, height: 78, borderRadius: 39, backgroundColor: W, alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 10px 30px -8px rgba(255,255,255,0.3)', transform: [{ scale: pressed ? 0.92 : 1 }],
                })}>
                <Icon name="call_end" size={34} fill color={CALL_BG} />
              </Pressable>
            </View>
          )}

          <WordsSheet scene={scene} on={on && s.phase === 'active' && s.wordsOpen} controller={controller} />
        </>
      )}
    </Animated.View>
  );
}

/** Mensagem / Em 10 min (56 px) na tela de toque. */
function RoundAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={W} />
      </View>
      <T size={12.5} color={W}>{label}</T>
    </Pressable>
  );
}

/** Botão redondo de 62 px; ligado = branco com ícone escuro (fundo e cor em .25 s). */
function Toggle({ k, onPress }: { k: Control; onPress: () => void }) {
  const v = useShown(k.on, 250, EASE_CSS, true, k.on ? 1 : 0);
  const icon = k.icon as IconName;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={k.label} accessibilityState={k.id === 'mute' || k.id === 'speaker' ? { selected: k.on } : undefined}
      style={{ width: 64, alignItems: 'center', gap: 8 }}>
      <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 31, backgroundColor: W, opacity: v }} />
        <Animated.View style={{ position: 'absolute', opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Icon name={icon} size={26} color={W} /></Animated.View>
        <Animated.View style={{ position: 'absolute', opacity: v }}><Icon name={icon} size={26} color={CALL_BG} /></Animated.View>
      </View>
      <View style={{ width: 88, marginHorizontal: -12, alignItems: 'center' }}><T size={12} color={W} align="center" numberOfLines={1}>{k.label}</T></View>
    </Pressable>
  );
}

/** Folha das 4 palavras (§4.9): escura, raio 40, sobe 115 % → 0 em .5 s. */
function WordsSheet({ scene, on, controller }: { scene: CallScene; on: boolean; controller: CallController }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const v = useShown(on, 500, EASE_ENTER);
  const [h, setH] = useState(420);
  const words = scene.words ?? ['…', '…', '…', '…'];
  return (
    <Animated.View onLayout={e => setH(e.nativeEvent.layout.height)} pointerEvents={on ? 'auto' : 'none'} accessibilityViewIsModal={on} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      style={{
        position: 'absolute', left: 10, right: 10, bottom: Math.max(10, insets.bottom), paddingTop: 26, paddingHorizontal: 24, paddingBottom: 28, borderRadius: 40,
        backgroundColor: '#1c1c1c', boxShadow: '0 0 0 1px rgba(255,255,255,0.08)', gap: 16,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [h * 1.15 + Math.max(10, insets.bottom), 0] }) }],
      }}>
      <T size={11.5} w={500} mono ls={0.08} color="rgba(255,255,255,0.6)">{t('call.words.label')}</T>
      <T size={22} w={700} ls={-0.03} lh={1.15} color={W} accessibilityRole="header">{t('call.words.title', { first: scene.contact.first })}</T>
      <View style={{ gap: 8 }} accessible accessibilityLabel={words.join(', ')}>
        {[0, 2].map(row => (
          <View key={row} style={{ flexDirection: 'row', gap: 8 }}>
            {words.slice(row, row + 2).map((w, i) => (
              <View key={i} style={{ flex: 1, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
                <T size={11} mono w={600} color="rgba(255,255,255,0.45)">{row + i + 1}</T>
                <T size={20} mono w={600} color={W} numberOfLines={1} style={{ flexShrink: 1 }}>{w}</T>
              </View>
            ))}
          </View>
        ))}
      </View>
      <T size={13.5} lh={1.45} color="rgba(255,255,255,0.65)">{t('call.words.body')}</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => controller.dispatch({ type: 'wordsMatch' })} accessibilityRole="button"
          style={{ flex: 1, height: 50, borderRadius: 25, backgroundColor: W, alignItems: 'center', justifyContent: 'center' }}>
          <T size={14.5} w={650} color={CALL_BG}>{t('call.words.same')}</T>
        </Pressable>
        <Pressable onPress={() => controller.wordsDiffer()} accessibilityRole="button"
          style={{ flex: 1, height: 50, borderRadius: 25, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
          <T size={14.5} w={600} color={W}>{t('call.words.different')}</T>
        </Pressable>
      </View>
    </Animated.View>
  );
}
