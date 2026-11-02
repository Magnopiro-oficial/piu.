import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { fmtL, useNetwork } from '../../../state/network';
import { useStore } from '../../../state/store';
import { useTheme } from '../../../theme/ThemeProvider';
import { GrowBar } from '../../../ui/Bars';
import { BackHeader, SectionLabel, Toggle } from '../../../ui/Controls';
import { Dialog } from '../../../ui/Dialog';
import { Icon, type IconName } from '../../../ui/Icon';
import { statusOf } from '../../../ui/ProvBits';
import { Screen } from '../../../ui/Screen';
import { T } from '../../../ui/T';

/** Equipamento: interfaces, armazenamento para terceiros, recibos e controles (pausar, atualizar, reiniciar, revogar). */
export default function ProvDeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { devices, togglePause, revoke } = useNetwork();
  const { showToast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const d = devices.find(x => x.id === id);
  if (!d) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">Equipamento não encontrado.</T></Screen>;

  const paused = d.status === 'paused';
  const metrics = [['+' + fmtL(d.today), 'LUNES hoje'], [paused ? '0' : d.pph, 'pacotes/h'], [String(d.nb), 'vizinhos']];
  const row = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: c.line } as const;

  return (
    <Screen>
      <BackHeader title={d.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 99, backgroundColor: d.status === 'active' ? c.ink : c.bg2 }}>
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: d.status === 'active' ? c.invink : c.ink }} />
              <T size={12.5} w={600} color={d.status === 'active' ? c.invink : c.ink}>{statusOf(d.status)}</T>
            </View>
            <T size={11.5} mono color={c.ink2}>{d.cls}</T>
          </View>
          <T size={12} mono color={c.ink2}>{d.model}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg2 }}>
            <Icon name="wifi" size={17} w={300} />
            <T size={13} w={500} mono numberOfLines={1} style={{ flex: 1 }}>{d.pub}</T>
            <Icon name="verified" size={15} fill />
            <T size={12} w={600}>verificado</T>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {metrics.map(([v, l]) => (
              <View key={l} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.bg2, gap: 4 }}>
                <T size={19} w={650} ls={-0.03} tabular>{v}</T>
                <T size={11.5} color={c.ink2}>{l}</T>
              </View>
            ))}
          </View>
        </View>

        <SectionLabel>INTERFACES</SectionLabel>
        <View style={{ marginHorizontal: 20, paddingVertical: 4, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.bg2 }}>
          {d.ifaces.map(([n, v, w], i) => (
            <View key={n} style={{ gap: 8, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <T size={14} w={550}>{n}</T>
                <T size={12.5} color={c.ink2}>{v}</T>
              </View>
              <GrowBar key={paused ? 'p' : 'a'} pct={paused ? 0 : w} />
            </View>
          ))}
        </View>

        {d.sto && (
          <>
            <SectionLabel>ARMAZENAMENTO PARA TERCEIROS</SectionLabel>
            <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <T size={24} w={650} ls={-0.03}>{String(d.sto[0]).replace('.', ',')} GB</T>
                <T size={13.5} color={c.ink2}>de {d.sto[1]} GB</T>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.bg3, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${(d.sto[0] / d.sto[1]) * 100}%`, backgroundColor: c.ink }} />
              </View>
              <T size={12.5} color={c.ink2}>{d.queue} mensagens cifradas aguardando rota · retenção máx. 48 h</T>
            </View>
          </>
        )}

        <SectionLabel>RECIBOS RECENTES</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {d.receipts.map(([t, k, h, s], i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line, opacity: s === 'confirmado' ? 1 : 0.5 }}>
              <T size={12} mono color={c.ink2}>{t}</T>
              <T size={12} mono numberOfLines={1} style={{ flex: 1 }}>{k} · {h}</T>
              <T size={12} w={500} mono>{s}</T>
            </View>
          ))}
          {!d.receipts.length && (
            <View style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
              <T size={13} color={c.ink2} align="center">{d.passive ? 'Pontos de acesso não assinam recibos. As entregas por ele contam para o nó pai.' : 'Nenhum recibo ainda. Os primeiros chegam em alguns minutos.'}</T>
            </View>
          )}
        </View>

        <SectionLabel>CONTROLE</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          <View style={{ ...row, borderTopWidth: 0 }}>
            <Icon name="pause_circle" size={21} w={300} />
            <View style={{ flex: 1, gap: 2 }}>
              <T size={15} w={550}>{d.passive ? 'Desvincular da malha' : 'Pausar retransmissão'}</T>
              <T size={12.5} color={c.ink2}>Mensagens guardadas seguem até expirar</T>
            </View>
            <Toggle on={paused} onChange={() => togglePause(d.id)} label={d.passive ? 'Desvincular da malha' : 'Pausar retransmissão'} />
          </View>
          {!d.passive && (
            <Action icon="system_update_alt" title="Atualizar Piu Node" sub="v0.4.3 assinada disponível" badge="Atualizar"
              onPress={() => showToast({ icon: 'system_update_alt', title: 'Atualização assinada aplicada', body: `${d.name} · Piu Node 0.4.3 · assinatura conferida` })} />
          )}
          <Action icon="restart_alt" title="Reiniciar equipamento"
            onPress={() => showToast({ icon: 'restart_alt', title: `Reiniciando ${d.name}`, body: 'Mensagens guardadas não se perdem: ficam no armazenamento local.' })} />
          <Action icon="key_off" title={d.passive ? 'Revogar nome público e remover' : 'Revogar credencial e remover'} strong onPress={() => setConfirm(true)} />
        </View>
      </ScrollView>

      {confirm && (
        <Dialog icon="key_off" title="Revogar e remover?" primaryIcon="key_off" primary="Revogar e remover"
          body={d.passive ? `O nome ${d.pub} deixa de ser reconhecido como seu. O roteador continua funcionando como Wi-Fi comum.` : 'A credencial deste equipamento é revogada em toda a malha. Créditos pendentes dele continuam sendo validados e pagos.'}
          onClose={() => setConfirm(false)}
          onPrimary={() => {
            setConfirm(false);
            router.back();
            revoke(d.id);
            showToast({ icon: 'key_off', title: 'Credencial revogada', body: 'O equipamento não participa mais da malha como seu.' });
          }} />
      )}
    </Screen>
  );
}

/** Linha de ação do cartão Controle. */
function Action({ icon, title, sub, badge, strong, onPress }: { icon: IconName; title: string; sub?: string; badge?: string; strong?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const row = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: c.line } as const;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ ...row, backgroundColor: pressed ? c.bg3 : 'transparent' })}>
      <Icon name={icon} size={21} w={300} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={15} w={strong ? 650 : 550}>{title}</T>
        {sub ? <T size={12.5} color={c.ink2}>{sub}</T> : null}
      </View>
      {badge ? <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: c.ink, justifyContent: 'center' }}><T size={12.5} w={600} color={c.invink}>{badge}</T></View> : null}
    </Pressable>
  );
}
