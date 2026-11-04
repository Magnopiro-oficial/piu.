import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { type ProvNode, unpairProvNode, useProvNodes } from '../../../lib/approvalNodes';
import { type DeviceView, NodeApiError, type ReceiptsView, type RelayView } from '../../../lib/nodeApi';
import { linkBlocker, nodeApiFor, saveNodeSession } from '../../../lib/nodeLink';
import { fontFamily } from '../../../theme/fonts';
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
import { DevicesSection, PeersSection } from '../../../ui/ProviderDevice';

/**
 * Equipamento pareado: o que este celular sabe dele (nome, operador, quando pareou), o estado real
 * lido da API local do piu-node (HTTPS com o certificado fixado, lib/nodeLink.ts), pausar a
 * retransmissão, regras e revogação dos equipamentos da conta, vizinhos por endereço e desfazer o
 * pareamento. Atualizar e reiniciar ficam no painel.
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

        <SectionLabel>AGORA NO EQUIPAMENTO</SectionLabel>
        <NodeLive d={d} />

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

/**
 * Estado real do equipamento pela API local: retransmissão, vizinhos, envelopes guardados e
 * repassados, recibos deste nó, e pausar/retomar. Sem a impressão digital no QR (ou sem o módulo
 * nativo), diz por que não conecta, sem números inventados.
 */
function NodeLive({ d }: { d: ProvNode }) {
  const { c } = useTheme();
  const { showToast } = useStore();
  const blocker = linkBlocker(d);
  const api = useMemo(() => nodeApiFor(d), [d]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<{ relay: RelayView; receipts: ReceiptsView; self: DeviceView | null; devices: DeviceView[] } | null>(null);
  const [connected, setConnected] = useState(!!api?.session);

  const load = useCallback(async () => {
    if (!api?.session) return;
    setBusy(true); setErr(null);
    try {
      const [relay, receipts, devices] = await Promise.all([api.relay(), api.receipts(), api.devices()]);
      setLive({ relay, receipts, self: devices.find(x => x.self) ?? null, devices });
    } catch (e) {
      if (e instanceof NodeApiError && e.status === 401) { await saveNodeSession(d.phoneId, null); setConnected(false); }
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }, [api, d.phoneId]);
  useEffect(() => { if (connected) void load(); }, [connected, load]);

  if (blocker || !api) {
    return (
      <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
        <Icon name="dns" size={22} w={300} />
        <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{`${blocker ?? 'Não foi possível preparar a conexão.'} Enquanto isso, estado, recibos e pausa ficam no painel do equipamento.`}</T>
      </View>
    );
  }

  if (!connected) {
    return (
      <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, gap: 12 }}>
        <T size={15} w={600}>Conectar pela rede local</T>
        <T size={12.5} lh={1.4} color={c.ink2}>{`Digite o código de 8 dígitos que o equipamento mostra no console (o mesmo do painel). A conexão só aceita o certificado ${d.pin!.slice(0, 11)}…`}</T>
        <TextInput value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" maxLength={8} placeholder="00000000" placeholderTextColor={c.ink3}
          accessibilityLabel="Código de 8 dígitos do equipamento"
          style={{ height: 50, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, color: c.ink, fontSize: 20, letterSpacing: 4, fontFamily: fontFamily(500) }} />
        {err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
        <Button label={busy ? 'Conectando…' : 'Conectar'} height={46} disabled={code.length !== 8 || busy} left={<Icon name="hub" size={18} color={c.invink} />}
          onPress={async () => {
            setBusy(true); setErr(null);
            try { await saveNodeSession(d.phoneId, await api.pair(code)); setCode(''); setConnected(true); }
            catch (e) { setErr((e as Error).message); }
            finally { setBusy(false); }
          }} />
      </View>
    );
  }

  const r = live?.relay, k = r?.counters, paused = live?.self?.status === 'paused' || !!r?.paused;
  const rows: [string, string][] = live ? [
    ['Retransmissão', !r?.enabled ? 'motor desligado' : paused ? 'pausada' : r.relaying ? 'ligada' : 'parada pelos limites'],
    ['Vizinhos', String(r?.neighbors?.length ?? 0)],
    ['Guardados', `${r?.store?.envelopes ?? 0} envelopes · ${Math.round((r?.store?.bytes ?? 0) / 1024)} KB`],
    ['Repassados', `${k?.forwarded ?? 0} · entregues ${k?.delivered ?? 0}`],
    ['Recusados', `${k?.rejected ?? 0} · repetidos ${k?.duplicates ?? 0}`],
    ['Recibos', live.receipts.enabled ? `${live.receipts.keptOwn ?? 0} deste nó · ${live.receipts.kept ?? 0} guardados para o validador` : 'motor desligado'],
  ] : [];
  return (
    <>
    <View style={{ marginHorizontal: 20, gap: 10 }}>
      <View accessibilityLiveRegion="polite" style={{ borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
        {!live && <T size={13} color={c.ink2} style={{ padding: 16 }}>{busy ? 'Lendo o equipamento…' : err ?? '—'}</T>}
        {rows.map(([l, v], i) => (
          <View key={l} style={{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
            <T size={13} color={c.ink2} style={{ width: 96 }}>{l}</T>
            <T size={13} w={550} style={{ flex: 1 }}>{v}</T>
          </View>
        ))}
      </View>
      {live && err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
      <T size={12} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>Ganhos em LUNES dependem do validador e da liquidação na Mainnet, ainda não conectados: aqui aparecem só os recibos.</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Atualizar" variant="outline" height={44} fontSize={14} style={{ flex: 1 }} disabled={busy} onPress={() => void load()} />
        {live?.self && (
          <Button label={paused ? 'Retomar' : 'Pausar'} height={44} fontSize={14} style={{ flex: 1 }} disabled={busy}
            left={<Icon name={paused ? 'play_circle' : 'pause'} size={18} color={c.invink} />}
            onPress={async () => {
              setBusy(true);
              try {
                const res = await api.togglePause(live.self!.id);
                showToast({ icon: res.status === 'paused' ? 'pause' : 'play_circle', title: res.status === 'paused' ? 'Retransmissão pausada' : 'Retransmissão retomada', body: `${d.node} ${res.status === 'paused' ? 'não guarda nem repassa mensagens de terceiros agora' : 'voltou a repassar mensagens'}.` });
              } catch (e) { setErr((e as Error).message); }
              finally { setBusy(false); }
              void load();
            }} />
        )}
      </View>
    </View>
    {live && <DevicesSection api={api} devices={live.devices} onChanged={() => void load()} />}
    {live && <PeersSection api={api} relay={live.relay} />}
    </>
  );
}
