import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { CLASS_CHIPS, PROV_FAMILIES, PROV_WALLETS } from '../../data/network';
import { checkPub, sanitizePub } from '../../lib/pubName';
import { useNetwork } from '../../state/network';
import { useStore } from '../../state/store';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel, Segmented, Toggle } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { StepHeader } from '../../ui/StepHeader';
import { T } from '../../ui/T';

/** Passo 4 de 4: nome, nome público `piu.*` (checagem), classes, interfaces, limites e carteira de recebimento. */
export default function ProvConfig() {
  const { c } = useTheme();
  const { draft, setDraft, devices, activate } = useNetwork();
  const { showToast } = useStore();
  const fam = PROV_FAMILIES.find(f => f.id === draft.fam) ?? PROV_FAMILIES[0];
  const pub = checkPub(draft.pub, devices.map(d => d.pub.replace(/^piu\./, '')));
  const parent = devices.find(d => d.id === draft.parent)?.name ?? 'nó pai';
  const ring = pub.ring === 'strong' ? c.ink : pub.ring === 'soft' ? c.line2 : 'transparent';
  const wallet = PROV_WALLETS[draft.wallet];

  const go = () => {
    if (!pub.ok) return;
    const dev = activate();
    router.dismissTo('/(tabs)');
    router.push('/provider');
    showToast({ icon: dev.icon, title: `${dev.name} está ativo`, body: 'Os primeiros recibos devem aparecer em alguns minutos.',
      go: () => router.push({ pathname: '/provider/device/[id]', params: { id: dev.id } }) });
  };

  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <StepHeader step="PASSO 4 DE 4 · REGRAS" title="Você decide quanto compartilhar." />
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <T size={13} w={500} color={c.ink2} style={{ paddingHorizontal: 4 }}>Nome do equipamento</T>
          <TextInput value={draft.name} onChangeText={name => setDraft({ name })} accessibilityLabel="Nome do equipamento" maxLength={40}
            style={{ height: 52, borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, fontSize: 16, color: c.ink, fontFamily: fontFamily(400) }} />
        </View>
        <View style={{ paddingTop: 14, paddingHorizontal: 20, gap: 8 }}>
          <T size={13} w={500} color={c.ink2} style={{ paddingHorizontal: 4 }}>Nome público da rede</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, height: 52, borderRadius: 16, backgroundColor: c.bg2, paddingHorizontal: 16, borderWidth: 1.5, borderColor: ring }}>
            <T size={15} w={500} mono color={c.ink2}>piu.</T>
            <TextInput value={draft.pub} onChangeText={v => setDraft({ pub: sanitizePub(v) })} placeholder="nome-do-ponto" placeholderTextColor={c.ink3}
              accessibilityLabel="Nome público da rede, depois de piu." autoCapitalize="none" autoCorrect={false}
              style={{ flex: 1, minWidth: 0, fontSize: 15, color: c.ink, fontFamily: fontFamily(500, true), paddingVertical: 0 }} />
            <Icon name={pub.icon} size={19} fill />
          </View>
          <T size={12} lh={1.4} color={pub.strong ? c.ink : c.ink2} style={{ paddingHorizontal: 4 }} accessibilityLiveRegion="polite">{pub.msg}</T>
        </View>

        {!fam.isAp ? (
          <>
            <SectionLabel>CLASSES DETECTADAS</SectionLabel>
            <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {CLASS_CHIPS.map(([k, icon, l]) => {
                const on = (fam.classes ?? []).includes(k);
                return (
                  <View key={k} style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderStyle: on ? 'solid' : 'dashed', borderColor: on ? c.ink : c.line2, backgroundColor: on ? c.ink : 'transparent', opacity: on ? 1 : 0.55, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={icon} size={16} color={on ? c.invink : c.ink} />
                    <T size={13.5} w={550} color={on ? c.invink : c.ink}>{on ? l : `${l} · requer ${k === 'super' ? 'rádio' : 'outro equipamento'}`}</T>
                  </View>
                );
              })}
            </View>

            <SectionLabel>INTERFACES</SectionLabel>
            <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
              {(fam.ifaces ?? []).map(([n, d, def, locked], i) => {
                const on = draft.ifaces[i] ?? def;
                return (
                  <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={15} w={550}>{n}</T>
                      <T size={12.5} color={c.ink2}>{d}</T>
                    </View>
                    <Toggle on={on} label={n} disabled={locked} onChange={() => setDraft({ ifaces: { ...draft.ifaces, [i]: !on } })} />
                  </View>
                );
              })}
            </View>

            <SectionLabel>LIMITES</SectionLabel>
            <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 16 }}>
              <Limit title="Banda para a rede" hint="do seu link local">
                <Segmented label="Banda para a rede" value={String(draft.bw)} onChange={v => setDraft({ bw: Number(v) as 5 | 20 | 50 })} options={[['5', '5 Mbps'], ['20', '20 Mbps'], ['50', '50 Mbps']]} />
              </Limit>
              <Limit title="Armazenamento" hint="para mensagens de terceiros">
                <Segmented label="Armazenamento" value={String(draft.sto)} onChange={v => setDraft({ sto: Number(v) as 1 | 4 | 8 })} options={[['1', '1 GB'], ['4', '4 GB'], ['8', '8 GB']]} />
              </Limit>
              <Limit title="Horário" hint="quando retransmitir">
                <Segmented label="Horário" value={draft.hours} onChange={hours => setDraft({ hours })} options={[['always', 'Sempre'], ['night', '22h–7h'], ['day', '8h–18h']]} />
              </Limit>
            </View>

            <SectionLabel>CARTEIRA DE RECEBIMENTO</SectionLabel>
            <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
              <Segmented label="Carteira de recebimento" value={draft.wallet} onChange={w => setDraft({ wallet: w })} options={[['new', 'Carteira de provider'], ['personal', 'Carteira pessoal']]} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
                <Icon name="account_balance_wallet" size={20} w={300} />
                <T size={13} w={500} mono style={{ flex: 1 }}>{wallet.addr}</T>
              </View>
              <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>{wallet.note}</T>
            </View>
          </>
        ) : (
          <View style={{ marginTop: 16, marginHorizontal: 20, padding: 16, borderRadius: 20, backgroundColor: c.bg2, flexDirection: 'row', gap: 12 }}>
            <Icon name="toll" size={21} w={300} />
            <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Pontos de acesso não geram créditos próprios. As entregas que passam por ele contam para o {parent}, que assina os recibos.</T>
          </View>
        )}

        <View style={{ paddingTop: 22, paddingHorizontal: 20 }}>
          <Button label="Ativar como provider" disabled={!pub.ok} onPress={go} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Limit({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={14} w={550}>{title}</T><T size={14} color={c.ink2}>{hint}</T></View>
      {children}
    </View>
  );
}

