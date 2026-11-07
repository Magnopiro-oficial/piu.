import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '../i18n';
import { type ApkIntegrity, certStatus, groupHex, shortHex } from '../lib/apkIntegrity';
import { loadApkIntegrity } from '../lib/sendApp';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { T } from './T';

/** Um valor: curto na tela; toque mostra inteiro, segurar copia. */
function HashRow({ label, hex }: { label: string; hex: string }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const [full, setFull] = useState(false);
  const copy = () => { void Clipboard.setStringAsync(hex).then(() => showToast({ icon: 'content_copy', title: t('apkCheck.copied'), body: groupHex(hex) })).catch(() => {}); };
  return (
    <Pressable onPress={() => setFull(f => !f)} onLongPress={copy} accessibilityRole="button" accessibilityHint={t('apkCheck.hint')}
      accessibilityLabel={`${label}: ${groupHex(hex)}`} style={{ gap: 2 }}>
      <T size={11.5} color={c.ink2}>{label}</T>
      <T size={13} w={600} mono lh={1.4}>{full ? groupHex(hex) : shortHex(hex)}</T>
    </Pressable>
  );
}

/**
 * "Conferir o instalador" (auditoria B-03): SHA-256 do APK que vai para o outro celular e do certificado
 * de assinatura, para quem recebe comparar com o site oficial. Some se o módulo não souber calcular.
 */
export function ApkIntegrityCard() {
  const { c } = useTheme();
  const t = useT();
  const [state, setState] = useState<ApkIntegrity | null | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    void loadApkIntegrity().then(v => { if (alive) setState(v); });
    return () => { alive = false; };
  }, []);
  if (state === null) return <T size={12} color={c.ink2}>{t('apkCheck.fail')}</T>;
  const official = state !== 'loading' && certStatus(state.certSha256) === 'official';
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <T size={13.5} w={600}>{t('apkCheck.title')}</T>
      <T size={12} lh={1.4} color={c.ink2}>{t('apkCheck.sub')}</T>
      {state === 'loading' ? <T size={12} color={c.ink2}>{t('apkCheck.loading')}</T> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={official ? 'verified_user' : 'gpp_bad'} size={18} />
            <T size={12.5} w={600} lh={1.4} style={{ flex: 1 }}>{official ? t('apkCheck.official') : t('apkCheck.notOfficial')}</T>
          </View>
          {state.certSha256.map(h => <HashRow key={h} label={t('apkCheck.cert')} hex={h} />)}
          <HashRow label={t('apkCheck.apk')} hex={state.apkSha256} />
          <T size={11.5} color={c.ink3}>{t('apkCheck.hint')}</T>
        </>
      )}
    </View>
  );
}
