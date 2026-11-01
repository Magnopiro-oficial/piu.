import { Pressable, View } from 'react-native';
import type { FileXfer } from '../data/types';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

const LABEL: Record<FileXfer['state'], [IconName, string]> = {
  sending: ['upload', 'Enviando em blocos · Wi-Fi Direct'],
  paused: ['pause_circle', 'A rota virou LoRa, que não leva arquivos. Esperando Wi-Fi.'],
  userPaused: ['pause', 'Pausado por você'],
  resuming: ['play_circle', 'Retomando de onde parou · Wi-Fi Mesh'],
  verified: ['verified', 'Entregue · integridade conferida (SHA-256)'],
};
const mb = (n: number) => String(n).replace('.', ',');

/** Conteúdo do balão de arquivo: progresso por bloco, estado do transporte e Pausar/Retomar. */
export function FileBubble({ file, onToggle }: { file: FileXfer; onToggle: () => void }) {
  const { c } = useTheme();
  const [icon, label] = LABEL[file.state];
  const pct = (file.done / file.blocks) * 100;
  const meta = file.state === 'verified'
    ? `${mb(file.mb)} MB · ${file.blocks} blocos`
    : `${mb(Number((file.mb * file.done / file.blocks).toFixed(1)))} de ${mb(file.mb)} MB · bloco ${file.done}/${file.blocks}`;
  return (
    <View style={{ width: 236, gap: 9, paddingTop: 4, paddingBottom: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={file.icon} size={21} color={c.ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={14.5} w={600} color={c.invink} numberOfLines={1}>{file.name}</T>
          <T size={11} mono color={c.invink} style={{ opacity: 0.75 }}>{meta}</T>
        </View>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: file.blocks, now: file.done }}
        style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: c.invink }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={15} color={c.invink} style={{ opacity: 0.85 }} />
        <T size={11.5} lh={1.3} color={c.invink} style={{ flex: 1, opacity: 0.85 }} accessibilityLiveRegion="polite">{label}</T>
        {file.state !== 'verified' && (
          <Pressable onPress={onToggle} accessibilityRole="button" hitSlop={8}
            style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center' }}>
            <T size={11.5} w={600} color={c.invink}>{file.state === 'userPaused' ? 'Retomar' : 'Pausar'}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}
