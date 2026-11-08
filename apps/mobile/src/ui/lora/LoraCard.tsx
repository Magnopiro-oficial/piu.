import { useRef } from 'react';
import { View } from 'react-native';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../Icon';
import { T } from '../T';

/**
 * Cartão fixo no topo da conversa enquanto o LoRa é o único caminho (desenho Piu 16, 4a). A linha
 * "LoRa ocupado" só aparece quando há mensagem minha esperando a vez do rádio.
 */
export function LoraCard({ name, busySec }: { name: string; busySec?: number }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={{ marginTop: 10, marginHorizontal: 12, padding: 14, borderRadius: 18, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="settings_input_antenna" size={20} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 3 }}>
          <T size={13.5} w={650}>{t('lora.chat.title', { name })}</T>
          <T size={12} lh={1.4} color={c.ink2}>{t('lora.chat.body')}</T>
        </View>
      </View>
      {busySec ? <BusyBar sec={busySec} inset={0} /> : null}
    </View>
  );
}

/** Tempo de rádio (03): "LoRa ocupado · sua mensagem sai em ~40 s" e uma barra que esvazia até a próxima janela. */
export function BusyBar({ sec, inset = 48 }: { sec: number; inset?: number }) {
  const { c } = useTheme();
  const t = useT();
  const max = useRef(sec);
  if (sec > max.current) max.current = sec;
  return (
    <View style={{ marginLeft: inset, gap: 6 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="hourglass_top" size={14} w={400} color={c.ink2} />
        <T size={12} w={500} color={c.ink2}>{t('lora.busy', { sec })}</T>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((sec / max.current) * 100)}%`, height: 4, backgroundColor: c.ink }} />
      </View>
    </View>
  );
}
