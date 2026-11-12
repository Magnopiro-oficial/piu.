import { Modal, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { qrZoomSize, QR_ZOOM_QUIET, type QrLevel } from '../lib/qrGrid';
import { useLayout } from '../lib/responsive';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import { T } from './T';

/**
 * QR em tela cheia para o Escanear código do Piu em outro celular: fundo branco em toda a tela (máximo contraste
 * em qualquer tema), QR na largura toda, margem de 4 módulos da norma e sem cantos arredondados
 * que cortem os quadrados de posição. Toque em qualquer lugar, no botão de fechar ou "voltar" fecha.
 * O fundo não é acessível (senão agruparia o QR e o aviso sob "Fechar"); o leitor de tela foca o botão próprio.
 */
export function QrZoom({ value, label, hint, level, onClose }: { value: string; label: string; hint: string; level?: QrLevel; onClose: () => void }) {
  const t = useT();
  const { width, height } = useLayout();
  const insets = useSafeAreaInsets();
  const side = qrZoomSize(width, height);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar style="dark" />
      <Pressable onPress={onClose} accessible={false} importantForAccessibility="no"
        style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', gap: 20, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8}
          style={{ position: 'absolute', top: insets.top + 12, right: 16, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eeeeee' }}>
          <Icon name="close" size={22} color="#000000" />
        </Pressable>
        <QrCode value={value} size={side} radius={0} label={label} level={level} quiet={QR_ZOOM_QUIET} />
        <T size={14} lh={1.4} color="#333333" align="center" style={{ maxWidth: side, paddingHorizontal: 8 }}>{hint}</T>
      </Pressable>
    </Modal>
  );
}
