import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { vaultIsSecure } from '../lib/vault';
import { fingerprintOf, useKeys } from '../state/keys';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/**
 * Passo 2 de 2 (FUN-004): geração local das chaves e impressão digital 8×4 hex.
 * As chaves são reais: uma frase de recuperação nova vai para o cofre do sistema e todas as chaves
 * derivam dela. Se já existem (ex.: "Ver boas-vindas"), mostra as atuais e nunca as substitui.
 */
export default function Keys() {
  const { c } = useTheme();
  const t = useT();
  const { finishOnboarding, profile } = useStore();
  const { identities, create } = useKeys();
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!identities) create().catch(() => setFailed(true));
    // A barra acompanha a geração (que é rápida) para a pessoa ver o passo acontecer.
    const timer = setInterval(() => setPct(p => { const n = Math.min(100, p + 6); if (n >= 100) clearInterval(timer); return n; }), 70);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const me = identities ? identities[profile.idType] : null;
  const fp = me ? fingerprintOf(me) : Array(8).fill('····');
  const done = pct >= 100 && !!me;

  return (
    <Screen style={{ paddingHorizontal: 24 }}>
      <View style={{ flex: 1, paddingTop: 56, gap: 28 }}>
        <View style={{ gap: 8 }}>
          <T size={12} w={500} mono ls={0.04} color={c.ink2}>{t('onboarding.step', { n: 2, total: 2 })}</T>
          <T size={32} w={650} ls={-0.035} lh={1.05} accessibilityRole="header" accessibilityLiveRegion="polite">{done ? t('keys.ready') : t('keys.generating')}</T>
          <T size={15} lh={1.4} color={c.ink2}>{done ? t('keys.ready.desc') : t('keys.generating.desc')}</T>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: c.ink }} />
        </View>
        <View style={{ padding: 20, borderRadius: 22, backgroundColor: c.bg2, gap: 14, opacity: done ? 1 : 0.25 }}>
          <T size={12.5} color={c.ink2}>{t('keys.fingerprint')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }} accessibilityLabel={t('profile.fingerprint.a11y', { fp: fp.join(' ') })}>
            {fp.map((g, i) => <T key={i} size={19} w={500} mono ls={0.02} style={{ width: '25%' }}>{g}</T>)}
          </View>
          <View style={{ height: 1, backgroundColor: c.line }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="smartphone" size={18} />
            <T size={13} color={c.ink2}>{vaultIsSecure ? t('keys.vault') : t('keys.vault.web')}</T>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        {failed
          ? <T size={13} align="center">{t('keys.failed')}</T>
          : <T size={13} align="center" color={c.ink2}>{t('keys.backupLater')}</T>}
        <Button label={t('keys.enter')} disabled={!done} style={{ marginBottom: 16 }}
          onPress={() => { finishOnboarding(); if (router.canDismiss()) router.dismissAll(); router.replace('/(tabs)'); }} />
      </View>
    </Screen>
  );
}
