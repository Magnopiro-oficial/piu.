import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { confirmLink, linkAvailable, resetLink, startLink, stopLink, useDesktopLink } from '../lib/desktopLinkSession';
import { fmtDate, tParts, useT } from '../i18n';
import { CodeReader, CodeWords } from '../lib/migrationUi';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

const hm = (ms: number) => fmtDate(ms, { hour: '2-digit', minute: '2-digit' });

/**
 * Conectar ao computador (Piu Desktop), modelo WhatsApp Web clássico: o celular lê o QR do computador,
 * os dois mostram as mesmas 3 palavras, a pessoa confirma e o computador passa a ser uma tela remota
 * cifrada pela rede local. O celular continua dono da identidade e das chaves; a sessão vive em
 * lib/desktopLinkSession.ts e continua quando a pessoa sai desta tela.
 */
export default function LinkDesktop() {
  const { c } = useTheme();
  const t = useT();
  const st = useDesktopLink();
  const { showToast } = useStore();
  const [scanning, setScanning] = useState(false);
  useEffect(() => { if (st.phase !== 'idle') setScanning(false); }, [st.phase]);

  const disconnect = () => {
    stopLink();
    showToast({ icon: 'link_off', title: t('linkDesktop.disconnected'), body: t('linkDesktop.disconnected.body') });
  };

  return (
    <Screen>
      <BackHeader title={t('linkDesktop.title')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }} keyboardShouldPersistTaps="handled">
        {st.phase === 'idle' && (
          <>
            <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.bg2, gap: 12 }}>
              <Icon name="computer" size={30} w={300} />
              <T size={17} w={650}>{t('linkDesktop.idle.title')}</T>
              <T size={14} lh={1.45} color={c.ink2}>
                {tParts('linkDesktop.idle.body', { app: 'Piu Desktop', action: t('linkDesktop.idle.action') }).map((p, i) => (p.var ? <T key={i} size={14} w={600}>{p.text}</T> : p.text))}
              </T>
              <T size={13} lh={1.45} color={c.ink2}>{t('linkDesktop.idle.keys')}</T>
              {!linkAvailable() && <T size={13} lh={1.45} w={550}>{t('linkDesktop.unavailable')}</T>}
              {!scanning && <Button label={t('linkDesktop.scan')} height={48} disabled={!linkAvailable()} onPress={() => setScanning(true)} />}
            </View>
            {scanning && (
              <>
                <CodeReader hint={t('linkDesktop.scan.hint')} placeholder="piu-link:1?…" onRead={startLink} />
                <Button label={t('common.cancel')} variant="soft" height={44} onPress={() => setScanning(false)} />
              </>
            )}
          </>
        )}

        {st.phase === 'connecting' && (
          <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.bg2, gap: 12 }}>
            <Icon name="lan" size={28} w={300} />
            <T size={16} w={600}>{t('linkDesktop.connecting')}</T>
            <T size={13} mono lh={1.5} color={c.ink2}>{st.host}</T>
            <T size={13} lh={1.45} color={c.ink2}>{t('linkDesktop.connecting.body')}</T>
            <Button label={t('common.cancel')} variant="soft" height={44} onPress={() => stopLink()} />
          </View>
        )}

        {st.phase === 'confirm' && st.words && (
          <View style={{ gap: 12 }}>
            <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.bg2, gap: 10 }}>
              <T size={16} w={650}>{t('linkDesktop.confirm.title')}</T>
              <T size={13.5} lh={1.45} color={c.ink2}>{st.name ? t('linkDesktop.confirm.bodyNamed', { name: st.name }) : t('linkDesktop.confirm.body')}</T>
              <CodeWords words={st.words} prompt={t('linkDesktop.confirm.prompt')} />
              <T size={12.5} lh={1.45} color={c.ink2}>{t('linkDesktop.confirm.warn')}</T>
            </View>
            <Button label={t('linkDesktop.confirm.same')} height={50} onPress={confirmLink} />
            <Button label={t('linkDesktop.confirm.different')} variant="ghost" height={44} fontSize={14} onPress={() => stopLink('Palavras diferentes no celular.')} />
          </View>
        )}

        {st.phase === 'connected' && (
          <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.ink, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="computer" size={22} color={c.invink} />
              <T size={17} w={650} color={c.invink} numberOfLines={1} style={{ flex: 1 }}>{st.name || t('linkDesktop.connected.name')}</T>
              <Icon name="check_circle" size={20} color={c.invink} />
            </View>
            <T size={12.5} mono lh={1.6} color={c.invink} style={{ opacity: 0.8 }}>
              {`${st.host}\n${t('linkDesktop.connected.since', { time: st.since ? hm(st.since) : '—' })}\n${t('linkDesktop.connected.frames', { sent: st.sent, received: st.received })}`}
            </T>
            <T size={13} lh={1.45} color={c.invink} style={{ opacity: 0.85 }}>{t('linkDesktop.connected.body')}</T>
            <Button label={t('linkDesktop.disconnect')} variant="inverse" height={46} onPress={disconnect} />
          </View>
        )}

        {st.phase === 'error' && (
          <View style={{ gap: 12 }}>
            <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.ink }}>
              <Icon name="gpp_bad" size={20} />
              <T size={13.5} lh={1.4} style={{ flex: 1 }}>{st.error ?? t('linkDesktop.error')}</T>
            </View>
            <Button label={t('linkDesktop.retry')} height={48} onPress={() => { resetLink(); setScanning(true); }} />
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, marginHorizontal: 4 }}>
          <Icon name="shield_lock" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('linkDesktop.footer')}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
