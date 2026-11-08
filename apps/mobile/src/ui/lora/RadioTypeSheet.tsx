import { useRef } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../Icon';
import { Sheet, type SheetHandle } from '../Sheet';
import { T } from '../T';

/** Instalação do firmware RNode (rnodeconf, pelo computador). */
export const RNODE_INSTALL_URL = 'https://github.com/markqvist/RNode_Firmware';
/** Lista de placas que servem (docs/hardware/placas-lora.md, no repositório do Piu). */
export const BOARDS_URL = 'https://github.com/Magnopiro-oficial/piu./blob/main/docs/hardware/placas-lora.md';

/**
 * Folha "Conectar rádio" · tipo de rádio (desenho Piu 17, 2): o rádio do Piu primeiro, com o ícone
 * cheio; o Meshtastic abre a folha que já existe (Piu 16).
 */
export function RadioTypeSheet({ onClose, onPick }: { onClose: () => void; onPick: (k: 'piu' | 'mesh') => void }) {
  const { c } = useTheme();
  const t = useT();
  const ref = useRef<SheetHandle>(null);
  const card = (k: 'piu' | 'mesh', title: string, desc: string) => (
    <Pressable key={k} onPress={() => ref.current?.close(() => onPick(k))} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}
      style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: k === 'piu' ? c.ink : c.bg3, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="settings_input_antenna" size={21} w={k === 'piu' ? 400 : 300} color={k === 'piu' ? c.invink : c.ink} />
        </View>
        <T size={16} w={680} ls={-0.02} style={{ flex: 1 }}>{title}</T>
        <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
      </View>
      <T size={12.5} lh={1.5} color={c.ink2}>{desc}</T>
    </Pressable>
  );
  return (
    <Sheet ref={ref} label={t('piu.row.connect')} onClose={onClose} gap={14}>
      <View style={{ gap: 6, marginTop: 6, paddingHorizontal: 2 }}>
        <T size={22} w={700} ls={-0.035} accessibilityRole="header">{t('piu.row.connect')}</T>
        <T size={13} lh={1.45} color={c.ink2}>{t('piu.type.ask')}</T>
      </View>
      {card('piu', t('piu.type.piu'), t('piu.type.piu.d'))}
      {card('mesh', t('piu.type.mesh'), t('piu.type.mesh.d'))}
      <Pressable onPress={() => { void Linking.openURL(BOARDS_URL).catch(() => {}); }} accessibilityRole="link" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 4 }}>
        <Icon name="help" size={16} w={400} /><T size={12.5} w={600} style={{ textDecorationLine: 'underline' }}>{t('piu.type.buy')}</T>
      </Pressable>
    </Sheet>
  );
}
