import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { fmtDate, useT } from '../../../i18n';
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
  const t = useT();
  const { nodes } = useProvNodes();
  const { showToast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const d = nodes?.find(x => x.phoneId === id);
  if (!nodes) return <Screen><BackHeader /></Screen>;
  if (!d) return <Screen><BackHeader /><T size={15} color={c.ink2} align="center">{t('provDev.notFound')}</T></Screen>;

  const rows: [string, string][] = [
    [t('provDev.node'), d.node],
    [t('provDev.operator'), d.operator || '—'],
    [t('provDev.pairedAt'), `${dayLabel(d.at, Date.now(), t)} · ${fmtDate(d.at, { hour: '2-digit', minute: '2-digit' })}`],
    [t('provDev.thisPhone'), t('provDev.thisPhone.value', { id: d.phoneId.slice(0, 8) })],
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

        <SectionLabel>{t('provDev.now')}</SectionLabel>
        <NodeLive d={d} />

        <SectionLabel>{t('provDev.thisPhoneLabel')}</SectionLabel>
        <View style={{ marginHorizontal: 20, gap: 10 }}>
          <T size={13} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provDev.unpair.body')}</T>
          <Button label={t('provDev.unpair')} variant="outline" height={46} left={<Icon name="link_off" size={19} />} onPress={() => setConfirm(true)} />
        </View>
      </ScrollView>

      {confirm && (
        <Dialog icon="link_off" title={t('provDev.unpair.title')} primaryIcon="link_off" primary={t('provDev.unpair.action')}
          body={t('provDev.unpair.dialog', { node: d.node })}
          onClose={() => setConfirm(false)}
          onPrimary={async () => {
            setConfirm(false);
            const auth = await confirmDevice(t('provDev.unpair.prompt', { node: d.node }));
            if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: t('devices.nothingChanged'), body: t('devices.notYou') }); return; }
            await unpairProvNode(d.phoneId).catch(() => {});
            router.back();
            showToast({ icon: 'link_off', title: t('provDev.unpaired'), body: t('provDev.unpaired.body', { node: d.node }) });
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
  const t = useT();
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
        <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{`${blocker ?? t('provDev.noLink')} ${t('provDev.noLink.meanwhile')}`}</T>
      </View>
    );
  }

  if (!connected) {
    return (
      <View style={{ marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, gap: 12 }}>
        <T size={15} w={600}>{t('provDev.connectLocal')}</T>
        <T size={12.5} lh={1.4} color={c.ink2}>{t('provDev.connectLocal.body', { cert: d.pin!.slice(0, 11) })}</T>
        <TextInput value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" maxLength={8} placeholder="00000000" placeholderTextColor={c.ink3}
          accessibilityLabel={t('provDev.code.a11y')}
          style={{ height: 50, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, color: c.ink, fontSize: 20, letterSpacing: 4, fontFamily: fontFamily(500) }} />
        {err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
        <Button label={busy ? t('provDev.connecting') : t('provDev.connect')} height={46} disabled={code.length !== 8 || busy} left={<Icon name="hub" size={18} color={c.invink} />}
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
    [t('provDev.relay'), !r?.enabled ? t('provDev.engineOff') : paused ? t('provDev.relay.paused') : r.relaying ? t('provDev.relay.on') : t('provDev.relay.limited')],
    [t('provDev.neighbors'), String(r?.neighbors?.length ?? 0)],
    [t('provDev.stored'), t('provDev.stored.value', { n: r?.store?.envelopes ?? 0, kb: Math.round((r?.store?.bytes ?? 0) / 1024) })],
    [t('provDev.forwarded'), t('provDev.forwarded.value', { n: k?.forwarded ?? 0, delivered: k?.delivered ?? 0 })],
    [t('provDev.rejected'), t('provDev.rejected.value', { n: k?.rejected ?? 0, dup: k?.duplicates ?? 0 })],
    [t('provDev.receipts'), live.receipts.enabled ? t('prov.receipts.value', { own: live.receipts.keptOwn ?? 0, kept: live.receipts.kept ?? 0 }) : t('provDev.engineOff')],
  ] : [];
  return (
    <>
    <View style={{ marginHorizontal: 20, gap: 10 }}>
      <View accessibilityLiveRegion="polite" style={{ borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
        {!live && <T size={13} color={c.ink2} style={{ padding: 16 }}>{busy ? t('provDev.reading') : err ?? '—'}</T>}
        {rows.map(([l, v], i) => (
          <View key={l} style={{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
            <T size={13} color={c.ink2} style={{ width: 96 }}>{l}</T>
            <T size={13} w={550} style={{ flex: 1 }}>{v}</T>
          </View>
        ))}
      </View>
      {live && err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
      <T size={12} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provDev.earningsNote')}</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={t('prov.refresh')} variant="outline" height={44} fontSize={14} style={{ flex: 1 }} disabled={busy} onPress={() => void load()} />
        {live?.self && (
          <Button label={paused ? t('provDev.resume') : t('provDev.pause')} height={44} fontSize={14} style={{ flex: 1 }} disabled={busy}
            left={<Icon name={paused ? 'play_circle' : 'pause'} size={18} color={c.invink} />}
            onPress={async () => {
              setBusy(true);
              try {
                const res = await api.togglePause(live.self!.id);
                showToast({ icon: res.status === 'paused' ? 'pause' : 'play_circle', title: res.status === 'paused' ? t('provDev.paused') : t('provDev.resumed'), body: res.status === 'paused' ? t('provDev.paused.body', { node: d.node }) : t('provDev.resumed.body', { node: d.node }) });
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
