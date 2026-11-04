import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { REF_RULES, REFERRAL_MONTHLY_CAP, REFERRAL_REWARD } from '../../data/wallet';
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
  const st = useStats(5000);
  const { chats } = useStore();
  const now = Date.now();
  const list = st?.usage.accepted ?? [];
  const refs = referralStats(list, now);
  const nameOf = (id: string, saved: string, via: 'public' | 'anon') =>
    chats.find(ch => ch.peer === id)?.name || saved || (via === 'anon' ? `Anônimo · ${id.slice(4, 8).toUpperCase()}` : `Contato · ${id.slice(4, 8).toUpperCase()}`);

  return (
    <Screen>
      <BackHeader title="Seus convidados" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>{lunes2(refs.earned)}</T>
              <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
            </View>
            <T size={13.5} color={c.ink2}>{`${refs.thisMonth} ${refs.thisMonth === 1 ? 'convite aceito' : 'convites aceitos'} este mês · limite de ${REFERRAL_MONTHLY_CAP} recompensas por mês`}</T>
          </View>
          <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
            <T size={14} w={600}>Quando a recompensa é paga</T>
            {REF_RULES.map(([icon, t, d]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name={icon} size={18} />
                <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}><T size={13} w={600}>{t}</T> {d}</T>
              </View>
            ))}
            <T size={12.5} lh={1.4} color={c.ink2}>{`Os ${REFERRAL_REWARD} LUNES por pessoa dependem da verificação da instalação e do pagamento pela Lunes, ainda não ligados. Aqui fica só o registro de quem aceitou o seu convite.`}</T>
          </View>
        </View>
        <SectionLabel>{`${refs.accepted} ${refs.accepted === 1 ? 'CONVITE ACEITO' : 'CONVITES ACEITOS'}`}</SectionLabel>
        {list.length === 0 ? (
          <View style={{ marginHorizontal: 20, padding: 18, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 12 }}>
            <T size={15} w={600}>Ninguém aceitou ainda</T>
            <T size={13} lh={1.45} color={c.ink2}>Quem entrar em contato com você pelo seu código ou link de convite aparece aqui, com a data. O pagamento depende da Lunes, ainda não conectada.</T>
            <Button label="Convidar agora" height={44} fontSize={14} onPress={() => router.push('/invite')} />
          </View>
        ) : (
          <View style={{ marginHorizontal: 20 }}>
            {list.map(a => (
              <View key={a.contactId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="person_check" size={20} w={300} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={14.5} w={550} numberOfLines={1}>{nameOf(a.contactId, a.name, a.via)}</T>
                  <T size={12.5} color={c.ink2}>{`${dayLabel(a.at, now)} · aceitou seu convite · ${a.via === 'anon' ? 'identidade anônima' : 'identidade pública'}`}</T>
                </View>
                <T size={12} color={c.ink2}>sem pagamento</T>
              </View>
            ))}
            <View style={{ paddingTop: 16 }}>
              <Button label="Convidar mais" variant="outline" height={44} fontSize={14} onPress={() => router.push('/invite')} />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
