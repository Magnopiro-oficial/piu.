import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Sheet, type SheetHandle } from './Sheet';
import { T } from './T';

const OPTS: ['image' | 'doc' | 'location', IconName, string, string][] = [
  ['image', 'image', 'Foto ou vídeo', 'Requer Wi-Fi Direct ou Mesh'],
  ['doc', 'description', 'Documento', 'Enviado em blocos, com retomada'],
  ['location', 'location_on', 'Localização', 'Texto curto · chega até por LoRa'],
];

/** Anexar (FUN-009): mídia nunca vai por LoRa; arquivos grandes esperam um transporte de maior capacidade. */
export function AttachSheet({ onPick, onClose }: { onPick: (k: 'image' | 'doc' | 'location') => void; onClose: () => void }) {
  const { c } = useTheme();
  const sheet = useRef<SheetHandle>(null);
  return (
    <Sheet ref={sheet} onClose={onClose} label="Anexar" padH={12} gap={6}>
      <T size={20} w={700} ls={-0.03} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 }} accessibilityRole="header">Anexar</T>
      {OPTS.map(([k, icon, title, desc]) => (
        <Pressable key={k} onPress={() => sheet.current?.close(() => onPick(k))} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 16, backgroundColor: pressed ? c.bg2 : 'transparent' })}>
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={23} w={300} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15.5} w={550}>{title}</T>
            <T size={12.5} color={c.ink2}>{desc}</T>
          </View>
        </Pressable>
      ))}
      <View style={{ marginTop: 8, marginHorizontal: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>Rotas por LoRa levam só texto curto. Arquivos grandes esperam um transporte de maior capacidade.</T>
      </View>
    </Sheet>
  );
}
