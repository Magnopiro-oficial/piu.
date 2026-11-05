import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { PROV_FAMILIES } from '../../data/network';
import { useT, type Key } from '../../i18n';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { StepHeader } from '../../ui/StepHeader';
import { T } from '../../ui/T';

/**
 * Passo 2: instalar o piu-node no equipamento e parear este celular pelo QR do painel.
 * O pareamento é real (lib/approvals.ts): o QR `piup:` traz um segredo que vai para o cofre do
 * aparelho, e o equipamento passa a aparecer no painel do provider daqui.
 */
export default function ProvConnect() {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const { fam: famId } = useLocalSearchParams<{ fam?: string }>();
  const fam = PROV_FAMILIES.find(f => f.id === famId) ?? PROV_FAMILIES[0];
  const title = fam.isAp ? t('provConnect.title.ap') : fam.isRadio ? t('provConnect.title.radio') : t('provConnect.title.install', { what: fam.short ? t(fam.short) : '' });
  const copy = (cmd: string) => { void Clipboard.setStringAsync(cmd).then(() => showToast({ icon: 'content_copy', title: t('provConnect.copied'), body: cmd })).catch(() => {}); };
  // Detalhe do passo: comando/URL fixo, ou chave do dicionário (prefixo `k:`).
  const detail = (d: string) => (d.startsWith('k:') ? t(d.slice(2) as Key) : d);

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <StepHeader step={t('provConnect.step')} title={title} />
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <View style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
            {(fam.steps ?? []).map(([titleKey, raw], i) => {
              const label = t(titleKey), d = detail(raw);
              const cmd = /^(opkg|cd |npm|\/etc|PIU_)/.test(d);
              return (
                <Pressable key={titleKey} disabled={!cmd} onPress={() => copy(d)} accessibilityRole={cmd ? 'button' : undefined} accessibilityLabel={cmd ? t('provConnect.copyCmd.a11y', { step: label, cmd: d }) : undefined}
                  style={{ flexDirection: 'row', gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={11} w={600} color={c.invink}>{i + 1}</T></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <T size={14} w={600}>{label}</T>
                    <T size={11.5} mono lh={1.45} color={c.ink2} selectable>{d}</T>
                  </View>
                  {cmd && <Icon name="content_copy" size={16} w={300} color={c.ink2} />}
                </Pressable>
              );
            })}
          </View>
          {fam.isAp ? (
            <T size={12.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provConnect.apNote')}</T>
          ) : (
            <T size={12.5} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provConnect.pkgNote')}</T>
          )}
        </View>

        {!fam.isAp && (
          <View style={{ marginTop: 18, marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="qr_code_scanner" size={23} color={c.invink} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15.5} w={600}>{t('provConnect.pair')}</T>
                <T size={12.5} lh={1.4} color={c.ink2}>{t('provConnect.pair.desc')}</T>
              </View>
            </View>
            <Button label={t('provConnect.scanPanel')} height={46} onPress={() => router.push('/scan')} left={<Icon name="qr_code_scanner" size={18} color={c.invink} />} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 10, paddingTop: 14, paddingHorizontal: 24 }}>
          <Icon name="key" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('provConnect.note')}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
