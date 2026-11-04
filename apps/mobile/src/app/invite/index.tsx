import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { fingerprintOf, useKeys } from '../../state/keys';
import { useMyCard } from '../../state/messaging';
import { inviteLink } from '../../lib/inviteLink';
import { APP_SCHEME } from '../../lib/inviter';
import { useSendApp } from '../../lib/sendApp';
import { QrCode } from '../../ui/QrCode';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Convidar: o QR leva o link `piu://invite/accept?c=…` com o seu cartão de contato assinado (o mesmo
 * de "Meu código": uso único, 24 h). Quem já tem o Piu escaneia aqui ou pela câmera do celular;
 * quem está longe recebe o mesmo link pelo compartilhamento.
 */
export default function Invite() {
  const { c } = useTheme();
  const { profile, identity, showToast } = useStore();
  const [card, bump] = useMyCard(identity);
  const me = useKeys().identities?.[identity];
  const fp = me ? fingerprintOf(me) : null;
  const inviter = identity === 'public' && profile.name.trim() ? profile.name.trim() : '';
  const { canSend, sending, send } = useSendApp();
  return (
    <Screen>
      <BackHeader title="Convidar" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View style={{ paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, borderRadius: 28, backgroundColor: c.ink, gap: 18 }}>
          <T size={28} w={650} ls={-0.035} lh={1.05} color={c.invink} accessibilityRole="header">Traga alguém para a rede.</T>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            {card ? <QrCode value={inviteLink(card, APP_SCHEME)} size={128} radius={18} label="QR do convite" /> : <View style={{ width: 128, height: 128, borderRadius: 18, backgroundColor: c.invink, opacity: 0.2 }} />}
            <View style={{ gap: 6, minWidth: 0, flex: 1 }}>
              <T size={15} w={600} color={c.invink}>{inviter ? `Convite de ${inviter}` : 'Convite anônimo'}</T>
              <T size={11.5} mono lh={1.5} color={c.invink} style={{ opacity: 0.72 }}>{`uso único\nexpira em 24 h\nassinado ${fp ? fp[0] + '…' + fp[7] : '…'}`}</T>
            </View>
          </View>
          <Pressable onPress={() => { bump(); showToast({ icon: 'qr_code_scanner', title: 'Novo código gerado', body: 'O anterior foi revogado. Este vale por 24 h, para uma pessoa.' }); }} accessibilityRole="button"
            style={{ height: 42, borderRadius: 21, borderWidth: 1, borderColor: c.invink, alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}>
            <T size={14} w={550} color={c.invink}>Gerar novo código</T>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/wallet/referrals')} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
          <Icon name="toll" size={22} w={300} />
          <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}><T size={13} w={600}>+25 LUNES</T> para você quando a pessoa ficar ativa por 7 dias. Ela ganha 10 de boas-vindas.</T>
          <Icon name="chevron_right" size={20} color={c.ink2} />
        </Pressable>
        {canSend && (
          <>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 10, paddingHorizontal: 4 }}>ESTÁ PERTO E AINDA NÃO TEM O PIU?</T>
            <Pressable onPress={() => void send()} disabled={sending} accessibilityRole="button" accessibilityLabel="Enviar o Piu por Bluetooth"
              style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, backgroundColor: c.ink, opacity: sending ? 0.6 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
              <Icon name="bluetooth" size={24} w={300} color={c.invink} />
              <View style={{ flex: 1, gap: 3 }}>
                <T size={15.5} w={600} color={c.invink}>{sending ? 'Preparando o instalador…' : 'Enviar o Piu por Bluetooth'}</T>
                <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.8 }}>Sem internet: o app vai do seu celular para o dela por Bluetooth ou Quick Share. Ela abre o arquivo recebido, permite instalar e depois escaneia o código acima.</T>
              </View>
              <Icon name="chevron_right" size={20} color={c.invink} style={{ marginTop: 2 }} />
            </Pressable>
          </>
        )}
        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 10, paddingHorizontal: 4 }}>A PESSOA JÁ TEM O PIU?</T>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
          <Icon name="qr_code_scanner" size={24} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={15.5} w={600}>Sim, já tem</T>
            <T size={13} lh={1.4} color={c.ink2}>Ela escaneia o código acima no Piu (Adicionar contato) ou com a câmera do celular. A conversa já começa cifrada.</T>
          </View>
        </View>
        <Pressable onPress={() => router.push('/invite/share')} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
          <Icon name="upload" size={24} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={15.5} w={600}>Está longe ou ainda não tem</T>
            <T size={13} lh={1.4} color={c.ink2}>Envie o link do convite por qualquer aplicativo. Ela abre no celular com o Piu instalado.</T>
          </View>
          <Icon name="chevron_right" size={20} color={c.ink2} style={{ marginTop: 2 }} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 6, paddingHorizontal: 4 }}>
          <Icon name="verified_user" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>O convite é assinado pela sua chave: se algo for alterado no caminho, o Piu da outra pessoa recusa. Depois, confiram o código de segurança pessoalmente.</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
