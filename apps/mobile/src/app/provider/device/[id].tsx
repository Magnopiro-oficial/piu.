import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { unpairProvNode, useProvNodes } from '../../../lib/approvalNodes';
import { confirmDevice } from '../../../lib/deviceAuth';
import { dayLabel } from '../../../lib/walletCore';
import { useStore } from '../../../state/store';
import { useTheme } from '../../../theme/ThemeProvider';
import { Button } from '../../../ui/Button';
import { BackHeader, SectionLabel } from '../../../ui/Controls';
import { Dialog } from '../../../ui/Dialog';
import { Icon } from '../../../ui/Icon';
import { Screen } from '../../../ui/Screen';
import { T } from '../../../ui/T';

/**
 * Equipamento pareado: o que este celular sabe dele (nome, operador, quando pareou) e desfazer o
 * pareamento. Pausar, atualizar, reiniciar e revogar a credencial ficam no painel do equipamento.
 */
export default function ProvDeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { nodes } = useProvNodes();
  const { showToast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const d = nodes?.find(x => x.phoneId === id);
  if (!nodes) return <Screen><BackHeader /></Screen>;
  if (!d) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Equipamento não encontrado.</T></Screen>;

  const rows: [string, string][] = [
    ['Nó', d.node],
    ['Operador', d.operator || '—'],
    ['Pareado', `${dayLabel(d.at, Date.now())} · ${new Date(d.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`],
    ['Este celular', `aprova transferências · id ${d.phoneId.slice(0, 8)}`],
  ];

  return (
    <Screen>
      <BackHeader title={d.node} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {rows.map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <T size={13} color={c.ink2} style={{ width: 96 }}>{l}</T>
              <T size={13} w={550} style={{ flex: 1 }} selectable>{v}</T>
            </View>
          ))}
        </View>

        <SectionLabel>INTERFACES, RECIBOS E GANHOS</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="dns" size={22} w={300} />
          <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Ficam no painel do equipamento (https://piu-node.local:8420), com a sessão do operador. Pausar, atualizar, reiniciar e revogar a credencial também são feitos lá.</T>
        </View>

        <SectionLabel>ESTE CELULAR</SectionLabel>
        <View style={{ marginHorizontal: 20, gap: 10 }}>
          <T size={13} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>Desfazer o pareamento apaga o segredo deste nó do cofre do aparelho. Depois, as transferências pedidas no painel não podem mais ser aprovadas aqui.</T>
          <Button label="Desfazer pareamento" variant="outline" height={46} left={<Icon name="link_off" size={19} />} onPress={() => setConfirm(true)} />
        </View>
      </ScrollView>

      {confirm && (
        <Dialog icon="link_off" title="Desfazer pareamento?" primaryIcon="link_off" primary="Desfazer"
          body={`Este celular deixa de aprovar transferências de ${d.node}. Para voltar, pareie de novo pelo painel.`}
          onClose={() => setConfirm(false)}
          onPrimary={async () => {
            setConfirm(false);
            const auth = await confirmDevice(`Desfazer pareamento com ${d.node}`);
            if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: 'Nada foi alterado', body: 'Não foi possível confirmar que é você.' }); return; }
            await unpairProvNode(d.phoneId).catch(() => {});
            router.back();
            showToast({ icon: 'link_off', title: 'Pareamento desfeito', body: `${d.node} não é mais aprovado por este celular.` });
          }} />
      )}
    </Screen>
  );
}
