import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useT, type Key } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

export type AttachKind = 'image' | 'doc' | 'location' | 'payment';
const OPTS: [AttachKind, IconName, Key, Key][] = [
  ['image', 'image', 'attach.image', 'attach.image.desc'],
  ['doc', 'description', 'attach.doc', 'attach.doc.desc'],
  ['location', 'location_on', 'attach.location', 'attach.location.desc'],
  // Regra 7.3: o pedido leva o endereço Lunes de quem pede; pagar é pela carteira Lunes da pessoa.
  ['payment', 'account_balance_wallet', 'chat.pay.request', 'attach.payment.desc'],
];

/** Anexar (FUN-009): mídia nunca vai por LoRa; arquivos grandes esperam um transporte de maior capacidade. */
export function AttachSheet({ onPick, onClose }: { onPick: (k: AttachKind) => void; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const sheet = useRef<SheetHandle>(null);
  return (
    <Sheet ref={sheet} onClose={onClose} label={t('chat.attach')} padH={12} gap={6}>
      <T size={20} w={700} ls={-0.03} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 }} accessibilityRole="header">{t('chat.attach')}</T>
      {OPTS.map(([k, icon, titleKey, descKey]) => {
        const title = t(titleKey), desc = t(descKey);
        return (
        <Pressable key={k} onPress={() => sheet.current?.close(() => onPick(k))} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 16, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={23} w={300} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15.5} w={550}>{title}</T>
            <T size={12.5} color={c.ink2}>{desc}</T>
          </View>
        </Pressable>
        );
      })}
      <View style={{ marginTop: 8, marginHorizontal: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>{t('attach.loraNote')}</T>
      </View>
    </Sheet>
  );
}
