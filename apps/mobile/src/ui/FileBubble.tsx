import { Image, Pressable, View } from 'react-native';
import type { FileXfer } from '../data/types';
import { fmtNumber, useT, type Key } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

const LABEL: Record<FileXfer['state'], [IconName, Key]> = {
  sending: ['upload', 'file.sending'],
  paused: ['pause_circle', 'file.paused'],
  userPaused: ['pause', 'file.userPaused'],
  resuming: ['play_circle', 'file.resuming'],
  verified: ['verified', 'file.verified'],
};
/** Textos do envio real (conversas pelo QR): sem afirmar o meio, que depende do vizinho. */
const REAL: Partial<Record<FileXfer['state'], [IconName, Key]>> = {
  sending: ['upload', 'file.sending.real'],
  resuming: ['play_circle', 'file.resuming.real'],
};
const mb = (n: number) => fmtNumber(n, { maximumFractionDigits: 1 });

/**
 * Conteúdo do balão de arquivo: progresso por bloco, estado e Pausar/Retomar.
 * `inverse`: balão enviado (fundo tinta). Recebido: fundo do balão, sem Pausar; com "Baixar" quando
 * o ajuste "Baixar mídia automaticamente" segurou o arquivo, e "Abrir" (`onOpen`) quando o conteúdo
 * ainda está neste aparelho.
 */
export function FileBubble({ file, onToggle, onOpen, inverse = true }: { file: FileXfer; onToggle: () => void; onOpen?: () => void; inverse?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const fg = inverse ? c.invink : c.ink, chip = inverse ? c.invink : c.ink, chipFg = inverse ? c.ink : c.invink;
  const [icon, labelKey] = file.incoming
    ? (file.state === 'verified' ? ['verified', 'file.received'] as [IconName, Key]
      : file.held ? ['download', 'file.tapDownload'] as [IconName, Key]
        : ['download', 'file.receiving'] as [IconName, Key])
    : file.lost && file.state !== 'verified'
      ? ['error', 'file.interrupted'] as [IconName, Key]
      : (file.real && REAL[file.state]) || LABEL[file.state];
  const label = t(labelKey);
  const pct = file.blocks ? (file.done / file.blocks) * 100 : 0;
  const meta = file.state === 'verified'
    ? t('file.meta.done', { mb: mb(file.mb), count: file.blocks })
    : t('file.meta.progress', { done: mb(Number((file.mb * file.done / Math.max(1, file.blocks)).toFixed(1))), mb: mb(file.mb), block: file.done, blocks: file.blocks });
  const canToggle = file.state !== 'verified' && !file.lost && (!file.incoming || !!file.held);
  const canOpen = !!onOpen && file.incoming && file.state === 'verified';
  // Recebido depois de reabrir o app (ou de limpar o cache): o conteúdo não está mais aqui.
  const gone = file.incoming && file.state === 'verified' && !onOpen;
  return (
    <View style={{ width: 236, gap: 9, paddingTop: 4, paddingBottom: 2 }}>
      {file.purged && !file.preview && (
        <View accessibilityLabel={t('file.purged.a11y', { name: file.name })} style={{ width: 236, height: 64, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(127,127,127,0.55)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          <Icon name="cleaning_services" size={17} color={fg} style={{ opacity: 0.8 }} />
          <T size={12.5} color={fg} style={{ opacity: 0.8 }}>{t('file.purged')}</T>
        </View>
      )}
      {file.preview && (
        <Image source={{ uri: file.preview }} accessibilityLabel={t('file.photo.a11y', { name: file.name })} resizeMode="cover"
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
        <T size={11.5} lh={1.3} color={fg} style={{ flex: 1, opacity: 0.85 }} accessibilityLiveRegion="polite">{gone ? t('file.gone') : label}</T>
        {canOpen && (
          <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('file.open.a11y', { name: file.name })} hitSlop={8}
            style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="ios_share" size={13} color={fg} />
            <T size={11.5} w={600} color={fg}>{t('file.open')}</T>
          </Pressable>
        )}
        {canToggle && (
          <Pressable onPress={onToggle} accessibilityRole="button" hitSlop={8}
            style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(127,127,127,0.55)', justifyContent: 'center' }}>
            <T size={11.5} w={600} color={fg}>{file.incoming ? t('file.download') : file.state === 'userPaused' ? t('provDev.resume') : t('provDev.pause')}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}
