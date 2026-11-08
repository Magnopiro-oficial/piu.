import { Animated, Pressable, View } from 'react-native';
import type { CallRecord } from '../../calls/callMachine';
import { recordCard, requestCard, type Contact, type RequestStep } from '../../calls/callView';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../Icon';
import { alpha } from '../motion';
import { T } from '../T';
import { EASE_CSS, useShown } from './anim';
import { useCallT } from './CallContext';

/** Botão ligar do cabeçalho da conversa: 44 px, fundo bg2, `call` cheio. */
export function CallButton({ onPress }: { onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('call.action')}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Icon name="call" size={22} fill />
    </Pressable>
  );
}

/**
 * Cartão de chamada na conversa (§4.7/§4.11), alinhado ao lado de quem iniciou: registro
 * ("Chamada de voz · 02:14 · direto pelo Wi-Fi", "Recusada"…) ou chamada perdida com "Ligar de volta".
 */
export function CallRecordCard({ record, contact, time, onCallBack }: { record: CallRecord; contact: Contact; time: string; onCallBack?: () => void }) {
  const t = useT();
  const tr = useCallT();
  const r = recordCard(tr, record, contact);
  return (
    <Card mine={r.mine} icon={r.icon as IconName} title={r.title} sub={r.sub} time={time}
      button={r.callBack && onCallBack ? { label: t('call.rec.callBack'), onPress: onCallBack } : undefined} />
  );
}

/** Cartão "Pedido de chamada" (§4.5) com os 3 traços de progresso (cada um acende em .4 s). */
export function CallRequestCard({ step, contact, hops, time }: { step: RequestStep; contact: Contact; hops?: number; time: string }) {
  const tr = useCallT();
  const r = requestCard(tr, step, contact, hops);
  return <Card mine icon={r.icon as IconName} title={r.title} sub={r.sub} time={time} dots={r.dots} />;
}

function Card({ mine, icon, title, sub, time, dots, button }: {
  mine: boolean; icon: IconName; title: string; sub: string; time: string; dots?: boolean[]; button?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  const bg = mine ? c.ink : c.bg2, fg = mine ? c.invink : c.ink;
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: '80%', padding: 14, borderRadius: 22, backgroundColor: bg, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessible accessibilityLabel={`${title}. ${sub}. ${time}`}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: mine ? alpha(c.invink, 0.14) : c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={14.5} w={650} color={fg}>{title}</T>
          <T size={12} lh={1.35} color={fg} style={{ opacity: 0.7 }}>{sub}</T>
        </View>
        <T size={10.5} w={500} mono tabular color={fg} style={{ opacity: 0.55, alignSelf: 'flex-start' }}>{time}</T>
      </View>
      {dots && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {dots.map((lit, i) => <Dot key={i} lit={lit} color={fg} />)}
        </View>
      )}
      {button && (
        <Pressable onPress={button.onPress} accessibilityRole="button"
          style={({ pressed }) => ({ height: 40, borderRadius: 20, backgroundColor: mine ? c.invink : c.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: pressed ? 0.8 : 1 })}>
          <Icon name="call" size={18} fill color={mine ? c.ink : c.invink} />
          <T size={13.5} w={650} color={mine ? c.ink : c.invink}>{button.label}</T>
        </Pressable>
      )}
    </View>
  );
}

/** Traço de progresso: apagado a 20 %, aceso cheio, transição de .4 s. */
function Dot({ lit, color }: { lit: boolean; color: string }) {
  const v = useShown(lit, 400, EASE_CSS, true, lit ? 1 : 0);
  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: alpha(color, 0.2), overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, backgroundColor: color, opacity: v }} />
    </View>
  );
}
