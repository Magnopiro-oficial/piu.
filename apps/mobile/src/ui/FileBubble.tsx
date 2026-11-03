import { Image, Pressable, View } from 'react-native';
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
/** Textos do envio real (conversas pelo QR): sem afirmar o meio, que depende do vizinho. */
const REAL: Partial<Record<FileXfer['state'], [IconName, string]>> = {
  sending: ['upload', 'Enviando em blocos · cada bloco é confirmado'],
  resuming: ['play_circle', 'Retomando de onde parou'],
};
const mb = (n: number) => String(n).replace('.', ',');

/**
 * Conteúdo do balão de arquivo: progresso por bloco, estado e Pausar/Retomar.
 * `inverse`: balão enviado (fundo tinta). Recebido: fundo do balão, sem Pausar; com "Baixar" quando
 * o ajuste "Baixar mídia automaticamente" segurou o arquivo.
 */
export function FileBubble({ file, onToggle, inverse = true }: { file: FileXfer; onToggle: () => void; inverse?: boolean }) {
  const { c } = useTheme();
  const fg = inverse ? c.invink : c.ink, chip = inverse ? c.invink : c.ink, chipFg = inverse ? c.ink : c.invink;
  const [icon, label] = file.incoming
    ? (file.state === 'verified' ? ['verified', 'Recebido · integridade conferida (SHA-256)'] as [IconName, string]
      : file.held ? ['download', 'Toque em Baixar para receber'] as [IconName, string]
        : ['download', 'Recebendo em blocos'] as [IconName, string])
    : file.lost && file.state !== 'verified'
      ? ['error', 'Interrompido ao fechar o app. Envie o arquivo de novo.'] as [IconName, string]
      : (file.real && REAL[file.state]) || LABEL[file.state];
  const pct = file.blocks ? (file.done / file.blocks) * 100 : 0;
  const meta = file.state === 'verified'
    ? `${mb(file.mb)} MB · ${file.blocks} blocos`
    : `${mb(Number((file.mb * file.done / Math.max(1, file.blocks)).toFixed(1)))} de ${mb(file.mb)} MB · bloco ${file.done}/${file.blocks}`;
  const canToggle = file.state !== 'verified' && !file.lost && (!file.incoming || !!file.held);
  return (
    <View style={{ width: 236, gap: 9, paddingTop: 4, paddingBottom: 2 }}>
      {file.preview && (
        <Image source={{ uri: file.preview }} accessibilityLabel={`Foto ${file.name}`} resizeMode="cover"
          style={{ width: 236, height: 160, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.2)' }} />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: chip, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={file.icon} size={21} color={chipFg} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={14.5} w={600} color={fg} numberOfLines={1}>{file.name}</T>
          <T size={11} mono color={fg} style={{ opacity: 0.75 }}>{meta}</T>
        </View>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: file.blocks, now: file.done }}
        style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: fg }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={15} color={fg} style={{ opacity: 0.85 }} />
        <T size={11.5} lh={1.3} color={fg} style={{ flex: 1, opacity: 0.85 }} accessibilityLiveRegion="polite">{label}</T>
        {canToggle && (
          <Pressable onPress={onToggle} accessibilityRole="button" hitSlop={8}
            style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center' }}>
            <T size={11.5} w={600} color={fg}>{file.incoming ? 'Baixar' : file.state === 'userPaused' ? 'Retomar' : 'Pausar'}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}
