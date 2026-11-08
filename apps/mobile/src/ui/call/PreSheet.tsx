import { useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import type { CallController } from '../../calls/callController';
import { ROUTE_ICON, type CallScene } from '../../calls/callView';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../Icon';
import { T } from '../T';
import { EASE_ENTER, EASE_LINEAR, useShown } from './anim';

/**
 * Folha "pre" (§4.1/§4.5): sobe 105 % → 0 em .5 s, fundo preto 32 % em .35 s. Com caminho ao vivo
 * mostra o caminho e "Chamar {first}"; só pela malha, o diagrama e "Enviar pedido de chamada"; só pelo
 * LoRa (5a), o rádio no diagrama e sem "Gravar um áudio".
 */
export function PreSheet({ scene, on, controller, onRecordAudio }: { scene: CallScene; on: boolean; controller: CallController; onRecordAudio?: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const scrim = useShown(on, 350, EASE_LINEAR);
  const y = useShown(on, 500, EASE_ENTER);
  const [h, setH] = useState(520);
  const s = scene.state;
  const ct = scene.contact;
  const route = s.preRoute;
  const close = () => controller.dispatch({ type: 'closePre' });
  const ms = scene.latencyMs !== undefined ? t('call.ms', { ms: Math.round(scene.latencyMs) }) : '';
  const sub = route === 'direct' ? (ms ? t('call.pre.direct.sub', { ms }) : t('call.pre.direct.subNoQ'))
    : route === 'bt' ? t('call.pre.bt.sub') + (ms ? ` · ${ms}` : '')
      : route === 'point' ? t('call.pre.point.sub') + (ms ? ` · ${ms}` : '') : '';
  return (
    <>
      <Animated.View pointerEvents={on ? 'auto' : 'none'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.32)', opacity: scrim }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel={t('sheet.close', { label: t('call.voice').toLowerCase() })} />
      </Animated.View>
      <Animated.View onLayout={e => setH(e.nativeEvent.layout.height)} pointerEvents={on ? 'auto' : 'none'} accessibilityViewIsModal={on} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopLeftRadius: 36, borderTopRightRadius: 36,
          paddingTop: 12, paddingHorizontal: 22, paddingBottom: Math.max(38, insets.bottom + 20), gap: 18,
          transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [h * 1.05, 0] }) }],
        }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <T size={17} w={650} color={c.invink}>{ct.initials}</T>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T size={20} w={700} ls={-0.03} numberOfLines={1} accessibilityRole="header">{ct.name}</T>
            <T size={13} color={c.ink2}>{t('call.voice')}</T>
          </View>
        </View>
        {route ? (
          <View style={{ gap: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: c.bg2 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ROUTE_ICON[route] as IconName} size={22} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={650}>{t(`call.route.${route}`)}</T>
                <T size={12.5} color={c.ink2}>{sub}</T>
              </View>
              <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 18 }} accessible={false}>
                {[6, 10, 14, 18].map(bh => <View key={bh} style={{ width: 4, height: bh, borderRadius: 2, backgroundColor: c.ink }} />)}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Icon name="lock" size={18} style={{ marginTop: 1 }} />
              <T size={13.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('call.e2e.long')}</T>
            </View>
            <Big icon="call" fill label={t('call.callName', { first: ct.first })} onPress={() => controller.dial()} />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={{ gap: 12, padding: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
              <MeshPath first={ct.first} hops={scene.hops} lora={scene.lora} />
              {scene.lora ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="settings_input_antenna" size={17} />
                  <T size={14.5} w={650}>{t('lora.call.title')}</T>
                </View>
              ) : <T size={14.5} w={650}>{scene.hops ? t('call.pre.mesh.title', { hops: scene.hops }) : t('call.pre.mesh.titleNoHops')}</T>}
              <T size={13} lh={1.45} color={c.ink2}>{scene.lora ? t('lora.call.body') : t('call.pre.mesh.body')}</T>
            </View>
            <Big icon="schedule_send" label={t('call.pre.sendRequest')} onPress={() => controller.sendRequest()} />
            {/* Pelo LoRa nem o áudio gravado passa (desenho 5a): sai o "Gravar um áudio". */}
            {!scene.lora && <Pressable onPress={() => { close(); onRecordAudio?.(); }} accessibilityRole="button"
              style={({ pressed }) => ({ height: 50, borderRadius: 25, backgroundColor: c.bg2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.75 : 1 })}>
              <Icon name="mic" size={20} />
              <T size={15} w={600}>{t('call.pre.recordAudio')}</T>
            </Pressable>}
          </View>
        )}
      </Animated.View>
    </>
  );
}

/** Botão principal de 56 px (ink). */
function Big({ icon, fill, label, onPress }: { icon: IconName; fill?: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
      <Icon name={icon} size={22} fill={fill} color={c.invink} />
      <T size={16} w={650} color={c.invink}>{label}</T>
    </Pressable>
  );
}

/**
 * Você → ○ → ○ → ○ → {first}, com linhas tracejadas (um nó por salto intermediário, 3 no protótipo).
 * `lora`: o rádio no lugar do primeiro nó, e um nó só depois dele (os saltos entre rádios não são conhecidos).
 */
function MeshPath({ first, hops, lora }: { first: string; hops?: number; lora?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const nodes = lora ? 2 : Math.min(5, Math.max(1, hops ?? 3));
  const dash = (k: number) => (
    <Svg key={`l${k}`} height={2} style={{ flex: 1 }}>
      <Line x1={0} y1={1} x2="100%" y2={1} stroke={c.ink} strokeWidth={2} strokeDasharray="4 4" />
    </Svg>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`${t('call.pre.you')} → ${first}`}>
      <T size={11.5} w={650}>{t('call.pre.you')}</T>
      {Array.from({ length: nodes }, (_, k) => [dash(k), lora && k === 0
        ? <Icon key={`n${k}`} name="settings_input_antenna" size={16} />
        : <View key={`n${k}`} style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: c.ink }} />])}
      {dash(nodes)}
      <T size={11.5} w={650}>{first}</T>
    </View>
  );
}
