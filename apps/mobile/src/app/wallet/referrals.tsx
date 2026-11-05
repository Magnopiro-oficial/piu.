import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { REFERRAL_MONTHLY_CAP, REFERRAL_REWARD } from '../../data/wallet';
import { useT } from '../../i18n';
import type { IconName } from '../../ui/Icon';
import { dayLabel, lunes2, referralStats } from '../../lib/walletCore';
import { useStats } from '../../state/messaging';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Seus convidados: quem entrou em contato comigo pelo meu convite (QR ou link de uso único), como o
 * mensageiro registrou neste aparelho (data e contato). A recompensa de 25 LUNES por pessoa ativa
 * depende da verificação da instalação e do pagamento pela Lunes, que ainda não existem: nada foi pago.
 */
export default function Referrals() {
  const { c } = useTheme();
  const t = useT();
  const st = useStats(5000);
  const { chats } = useStore();
  const now = Date.now();
  const list = st?.usage.accepted ?? [];
  const refs = referralStats(list, now);
  const nameOf = (id: string, saved: string, via: 'public' | 'anon') =>
    chats.find(ch => ch.peer === id)?.name || saved || (via === 'anon' ? t('profile.anonName', { code: id.slice(4, 8).toUpperCase() }) : t('referrals.contactCode', { code: id.slice(4, 8).toUpperCase() }));
  /** Regras da distribuição (seção 14): quando a recompensa por convidado é paga. */
  const rules: [IconName, string, string][] = [
    ['verified', t('referrals.rule1.title'), t('referrals.rule1.desc')],
    ['calendar_month', t('referrals.rule2.title'), t('referrals.rule2.desc')],
    ['devices', t('referrals.rule3.title'), t('referrals.rule3.desc', { cap: REFERRAL_MONTHLY_CAP })],
    ['person', t('referrals.rule4.title'), t('referrals.rule4.desc')],
  ];

  return (
    <Screen>
      <BackHeader title={t('referrals.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>{lunes2(refs.earned)}</T>
              <T size={14} w={600} color={c.ink2}>{t('referrals.received')}</T>
            </View>
            <T size={13.5} color={c.ink2}>{t('referrals.thisMonth', { count: refs.thisMonth, cap: REFERRAL_MONTHLY_CAP })}</T>
          </View>
          <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
            <T size={14} w={600}>{t('referrals.whenPaid')}</T>
            {rules.map(([icon, title, d]) => (
              <View key={title} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name={icon} size={18} />
                <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}><T size={13} w={600}>{title}</T> {d}</T>
              </View>
            ))}
            <T size={12.5} lh={1.4} color={c.ink2}>{t('referrals.note', { reward: REFERRAL_REWARD })}</T>
          </View>
        </View>
        <SectionLabel>{t('referrals.acceptedLabel', { count: refs.accepted })}</SectionLabel>
        {list.length === 0 ? (
          <View style={{ marginHorizontal: 20, padding: 18, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 12 }}>
            <T size={15} w={600}>{t('referrals.empty.title')}</T>
            <T size={13} lh={1.45} color={c.ink2}>{t('referrals.empty.body')}</T>
            <Button label={t('wallet.ref.inviteNow')} height={44} fontSize={14} onPress={() => router.push('/invite')} />
          </View>
        ) : (
          <View style={{ marginHorizontal: 20 }}>
            {list.map(a => (
              <View key={a.contactId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="person_check" size={20} w={300} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={14.5} w={550} numberOfLines={1}>{nameOf(a.contactId, a.name, a.via)}</T>
                  <T size={12.5} color={c.ink2}>{`${dayLabel(a.at, now)} · ${t('referrals.acceptedYour')} · ${a.via === 'anon' ? t('referrals.anonIdentity') : t('referrals.publicIdentity')}`}</T>
                </View>
                <T size={12} color={c.ink2}>{t('referrals.noPayment')}</T>
              </View>
            ))}
            <View style={{ paddingTop: 16 }}>
              <Button label={t('referrals.inviteMore')} variant="outline" height={44} fontSize={14} onPress={() => router.push('/invite')} />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
