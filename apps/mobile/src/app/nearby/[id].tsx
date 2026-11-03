import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtLunes, MAINNET_PENDING, type NearProfile } from '../../data/wallet';
import { initialsOf } from '../../lib/text';
import { useMessaging } from '../../state/messaging';
import { BackHeader } from '../../ui/Controls';
import { useStore } from '../../state/store';
import { useWallet } from '../../state/wallet';
import { fontFamily } from '../../theme/fonts';
import { confirmDevice } from '../../lib/deviceAuth';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { Sheet, type SheetHandle } from '../../ui/Sheet';
import { Stripes } from '../../ui/Stripes';
import { T } from '../../ui/T';

const MAX = 140;

/** Perfil público de alguém por perto, com convite pago para conversar. */
export default function NearProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nearby } = useMessaging();
  const profiles = nearby?.profiles ?? [];
  const { c } = useTheme();
  const p = profiles.find(x => x.id === id);
  if (!p) {
    return (
      <Screen>
        <BackHeader />
        <View style={{ paddingVertical: 56, paddingHorizontal: 40, alignItems: 'center', gap: 10 }}>
          <Icon name="radar" size={40} w={300} color={c.ink2} />
          <T size={17} w={650} align="center">Esta pessoa não está mais por perto</T>
          <T size={13.5} lh={1.45} color={c.ink2} align="center">Perfis de Por perto só aparecem enquanto a pessoa está visível e ao alcance.</T>
        </View>
      </Screen>
    );
  }
  return <ProfileView p={p} />;
}

function ProfileView({ p }: { p: NearProfile }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { inviteState } = useWallet();
  const { showToast } = useStore();
  const hide = useMessaging().nearby?.hide ?? (() => {});
  const [sheet, setSheet] = useState(false);
  const st = inviteState(p.id);
  const sent = st.kind !== 'none';

  const round = { width: 42, height: 42, borderRadius: 21, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <Stripes period={20} style={{ height: 430, overflow: 'hidden' }}>
          {p.photo
            ? <Image source={{ uri: `data:image/jpeg;base64,${p.photo}` }} accessibilityLabel={`Foto de ${p.name}`} resizeMode="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            : <T size={64} w={650} ls={-0.04} color={c.ink2}>{initialsOf(p.name)}</T>}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar" style={round}><Icon name="arrow_back_ios_new" size={20} /></Pressable>
            <Pressable onPress={() => { hide(p.id); showToast({ icon: 'flag', title: 'Denúncia registrada', body: `${p.name || 'Este perfil'} não aparece mais para você em Por perto.` }); router.back(); }} accessibilityRole="button" accessibilityLabel={`Denunciar perfil de ${p.name}`} style={round}><Icon name="flag" size={20} /></Pressable>
          </View>
        </Stripes>

        <View style={{ paddingTop: 20, paddingHorizontal: 22, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <T size={32} w={700} ls={-0.04} accessibilityRole="header">{p.name || 'Perfil público'}</T>
            <T size={13} mono color={c.ink2}>{p.prox} · {p.via}</T>
          </View>
          <View style={{ marginTop: 4, borderRadius: 20, backgroundColor: c.bg2 }}>
            {([['Em comum', p.common], ['Taxa do convite', `${fmtLunes(p.fee)} LUNES · definida por ${p.name}`], ['Identidade', 'pública · chave verificada']] as const).map(([l, v], i) => (
              <View key={l} style={{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <T size={13} color={c.ink2} style={{ width: 112 }}>{l}</T>
                <T size={13} w={550} style={{ flex: 1 }}>{v}</T>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 12) + 4, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line, flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Fechar perfil"
          style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: c.line2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={22} />
        </Pressable>
        {sent ? (
          <View accessibilityLiveRegion="polite" style={{ flex: 1, height: 54, borderRadius: 27, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name={st.kind === 'pending' ? 'schedule_send' : 'block'} size={19} />
            <T size={14.5} w={600}>{st.kind === 'pending' ? `Convite enviado · expira em ${st.hoursLeft} h` : st.kind === 'cooldown' ? `Novo convite em ${st.daysLeft} ${st.daysLeft === 1 ? 'dia' : 'dias'}` : ''}</T>
          </View>
        ) : (
          <Button label={`Convidar · ${fmtLunes(p.fee)} LUNES`} accessibilityLabel={`Convidar ${p.name} para conversar · ${fmtLunes(p.fee)} LUNES`} fontSize={15} onPress={() => setSheet(true)} style={{ flex: 1, paddingHorizontal: 12, gap: 6 }}
            left={<Icon name="waving_hand" size={18} color={c.invink} />} />
        )}
      </View>

      {sheet && <InviteSheet p={p} onClose={() => setSheet(false)} />}
    </Screen>
  );
}

function InviteSheet({ p, onClose }: { p: NearProfile; onClose: () => void }) {
  const { c } = useTheme();
  const { invite } = useWallet();
  const { nearby } = useMessaging();
  const ref = useRef<SheetHandle>(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [signing, setSigning] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const fee = fmtLunes(p.fee);

  if (done) {
    return (
      <Sheet ref={ref} onClose={onClose} label="Convite enviado">
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 10, paddingTop: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="waving_hand" size={30} color={c.invink} /></View>
          <T size={22} w={700} ls={-0.03}>Convite enviado</T>
          <T size={14} lh={1.45} color={c.ink2} align="center">{`${fee} reservados. Se ${p.name} aceitar, a conversa abre. Se não, o valor volta em até 24 h.`}</T>
          <T size={12} lh={1.4} color={c.ink2} align="center">{`Reserva registrada só neste aparelho · ${MAINNET_PENDING}.`}</T>
        </View>
        <Button label="Concluir" onPress={() => ref.current?.close()} />
      </Sheet>
    );
  }

  const rules: [IconName, string, string][] = [
    ['lock_clock', `${fee} LUNES ficam reservados.`, `Saem da sua carteira só se ${p.name} aceitar.`],
    ['undo', 'Recusou ou não respondeu?', 'O valor volta para você em até 24 h.'],
    ['block', 'Sem insistência.', 'Depois de um convite, só é possível tentar de novo em 30 dias.'],
  ];

  return (
    <Sheet ref={ref} onClose={onClose} label={`Convite para ${p.name}`}>
      <T size={22} w={700} ls={-0.03}>Convite para {p.name}</T>
      <View style={{ gap: 6 }}>
        <TextInput value={msg} onChangeText={t => setMsg(t.slice(0, MAX))} maxLength={MAX} multiline placeholder={`Escreva algo para ${p.name}…`} placeholderTextColor={c.ink3}
          accessibilityLabel={`Mensagem do convite, até ${MAX} caracteres`}
          style={{ minHeight: 96, padding: 14, borderRadius: 16, backgroundColor: c.bg2, color: c.ink, fontSize: 15.5, fontFamily: fontFamily(400), textAlignVertical: 'top' }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T size={12} color={c.ink2}>Só uma mensagem até a pessoa aceitar</T>
          <T size={12} mono color={c.ink2}>{msg.length}/{MAX}</T>
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {rules.map(([icon, a, b]) => (
          <View key={a} style={{ flexDirection: 'row', gap: 12 }}>
            <Icon name={icon} size={20} w={300} />
            <T size={13.5} lh={1.4} style={{ flex: 1 }}><T size={13.5} w={600}>{a}</T> <T size={13.5} color={c.ink2}>{b}</T></T>
          </View>
        ))}
      </View>
      {/* Sem a liquidação ligada ao app não há reserva assinada em LUNES: só o registro local. */}
      <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
        <Icon name="cloud_off" size={18} w={300} />
        <T size={12.5} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{'O convite e o texto vão pela malha agora. A reserva fica registrada só neste aparelho: a reserva assinada em LUNES depende da liquidação, ainda não ligada ao app.'}</T>
      </View>
      {authErr && <T size={12.5} color={c.ink2} align="center" accessibilityRole="alert">{authErr}</T>}
      <Button label={signing ? 'Confirmando…' : `Assinar e enviar · ${fee} LUNES`} disabled={!msg.trim() || signing}
        left={<Icon name="fingerprint" size={20} color={c.invink} />}
        onPress={async () => {
          // A reserva é uma assinatura de LUNES: pede a biometria (ou o bloqueio do aparelho), como no envio.
          setSigning(true); setAuthErr(null);
          const r = await confirmDevice(`Reservar ${fee} LUNES para convidar ${p.name}`);
          setSigning(false);
          if (r === 'denied') { setAuthErr('Assinatura cancelada. Nada foi reservado.'); return; }
          try {
            const sent = nearby!.invite(p.id, msg);
            invite(p.id, p.name, sent.fee); setDone(true);
          } catch (e) { setAuthErr(String((e as Error).message)); }
        }} />
    </Sheet>
  );
}
