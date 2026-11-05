/**
 * Partes da tela do equipamento (app/provider/device/[id].tsx) que falam com a API local do piu-node:
 * regras de cada equipamento da conta, revogação e vizinhos por endereço. Tudo vem do nó; os textos
 * vêm de lib/providerCore.ts (testado).
 */
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useT } from '../i18n';
import { confirmDevice } from '../lib/deviceAuth';
import { type DeviceLimits, type DeviceView, NodeApi, type PeersView, type RelayView } from '../lib/nodeApi';
import {
  addPeerMessage, hoursLabel, LIMIT_BW, LIMIT_DEFAULT, LIMIT_HOURS, LIMIT_STO, limitsLabel, limitsNote, looksLikePeerAddress, peerConfirmCode, peerLine, revokeMessage,
} from '../lib/providerCore';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { fontFamily } from '../theme/fonts';
import { Button } from './Button';
import { SectionLabel, Segmented, Toggle } from './Controls';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { T } from './T';

/** Equipamentos da conta neste nó: regras (banda, armazenamento, horário) e revogar os outros. */
export function DevicesSection({ api, devices, onChanged }: { api: NodeApi; devices: DeviceView[]; onChanged: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <SectionLabel>{t('provDevs.label', { count: devices.length })}</SectionLabel>
      <View style={{ marginHorizontal: 20, gap: 8 }}>
        {devices.map(d => (
          <View key={d.id} style={{ borderRadius: 20, borderWidth: 1, borderColor: open === d.id ? c.ink : c.line2, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Icon name={d.self ? 'router' : d.nodeId ? 'hub' : 'devices'} size={22} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={600} numberOfLines={1}>{d.name}{d.self ? ` · ${t('provDevs.thisNode')}` : ''}</T>
                <T size={11.5} mono color={c.ink2} numberOfLines={2}>{`${d.cls} · ${d.status === 'paused' ? t('provDevs.paused') : t('devices.tag.active')}${d.nodeId ? ` · ${t('scan.transfer.node', { node: d.nodeId })}` : ''}${d.link ? ` · ${d.link.online ? t('network.peer.connected') : t('devices.tag.disconnected')}` : ''} · ${limitsLabel(d.limits, t)}`}</T>
              </View>
              <Button label={open === d.id ? t('common.close') : t('provDevs.rules')} variant="outline" height={36} fontSize={13} style={{ paddingHorizontal: 14 }} onPress={() => setOpen(o => (o === d.id ? null : d.id))} />
            </View>
            {open === d.id && <DeviceRules api={api} d={d} onChanged={onChanged} />}
          </View>
        ))}
        {devices.length === 0 && <T size={13} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provDevs.none')}</T>}
      </View>
    </>
  );
}

function DeviceRules({ api, d, onChanged }: { api: NodeApi; d: DeviceView; onChanged: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const [cur, setCur] = useState<DeviceView>(d);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => setCur(d), [d]);
  const on = !!cur.limits;
  const v = cur.limits ?? LIMIT_DEFAULT;

  const save = async (l: DeviceLimits | null) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { setCur(await api.setLimits(d.id, l)); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const set = (p: Partial<DeviceLimits>) => void save({ ...v, ...p });

  const revoke = async () => {
    setConfirm(false);
    const auth = await confirmDevice(t('devices.revokeName', { name: d.name }));
    if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: t('devices.nothingChanged'), body: t('devices.notYou') }); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.revoke(d.id);
      const m = revokeMessage(d.name, r, t);
      setResult(`${m.title}. ${m.body}`);
      showToast({ icon: r.revoked ? 'gpp_bad' : 'delete', title: m.title, body: m.body });
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <T size={13.5} w={600} style={{ flex: 1 }}>{t('provDevs.ownRules')}</T>
        <Toggle on={on} disabled={busy} label={t('provDevs.ownRules')} onChange={() => void save(on ? null : LIMIT_DEFAULT)} />
      </View>
      {on && (
        <>
          <T size={12} color={c.ink2}>{t('provDevs.bw')}</T>
          <Segmented label={t('provDevs.bw')} value={String(v.bw)} onChange={x => set({ bw: Number(x) as DeviceLimits['bw'] })} options={LIMIT_BW.map(o => [String(o.value), o.label])} />
          <T size={12} color={c.ink2}>{t('provDevs.sto')}</T>
          <Segmented label={t('provDevs.sto')} value={String(v.sto)} onChange={x => set({ sto: Number(x) as DeviceLimits['sto'] })} options={LIMIT_STO.map(o => [String(o.value), o.label])} />
          <T size={12} color={c.ink2}>{t('battery.hours')}</T>
          <Segmented<DeviceLimits['hours']> label={t('battery.hours')} value={v.hours} onChange={hours => set({ hours })} options={LIMIT_HOURS.map(o => [o.value, hoursLabel(o.value, t)])} />
        </>
      )}
      <T size={12} lh={1.4} color={c.ink2}>{busy ? t('provDevs.saving') : limitsNote(cur, t)}</T>
      {err && <T size={12.5} color={c.ink} accessibilityRole="alert">{err}</T>}
      {result && <T size={12.5} lh={1.4} accessibilityLiveRegion="polite">{result}</T>}
      {!d.self && !result && (
        <Button label={d.nodeId ? t('provDevs.revokeRemove') : t('provDevs.removeFromList')} variant="outline" height={42} fontSize={13.5} disabled={busy} left={<Icon name="gpp_bad" size={18} />} onPress={() => setConfirm(true)} />
      )}
      {d.self && <T size={11.5} lh={1.4} color={c.ink2}>{t('provDevs.selfNote')}</T>}
      {confirm && (
        <Dialog icon="gpp_bad" title={d.nodeId ? t('devices.revokeTitle', { name: d.name }) : t('groupInfo.removeTitle', { name: d.name })} primary={d.nodeId ? t('provDevs.revoke') : t('common.remove')} primaryIcon="gpp_bad" hold
          body={d.nodeId ? t('provDevs.revokeBody') : t('provDevs.removeBody')}
          onClose={() => setConfirm(false)} onPrimary={() => void revoke()} />
      )}
    </View>
  );
}

/** Vizinhos por endereço (`host:porta`): estado real, código de confirmação do enlace, adicionar e remover. */
export function PeersSection({ api, relay }: { api: NodeApi; relay: RelayView | null }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const [view, setView] = useState<PeersView | null>(null);
  const [nb, setNb] = useState<RelayView['neighbors']>(relay?.neighbors ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([api.peers(), api.relay()]);
      setView(p); setNb(r.neighbors ?? []); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const a = address.trim();
    if (!looksLikePeerAddress(a) || busy) return;
    setBusy('add'); setMsg(null);
    try { const r = await api.addPeer(a); setMsg(addPeerMessage(r.peer, t)); if (r.peer?.state === 'connected') setAddress(''); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const remove = async (a: string) => {
    if (busy) return;
    setBusy(a);
    try { await api.removePeer(a); showToast({ icon: 'link_off', title: t('provPeers.removed'), body: t('provPeers.removed.body', { address: a }) }); await load(); }
    catch (e) { showToast({ icon: 'error', title: t('provPeers.removeFail'), body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const peers = view?.peers ?? [];
  return (
    <>
      <SectionLabel>{`${t('provPeers.label')}${view?.enabled ? ` · ${peers.length}${view.max ? ` ${t('provPeers.of', { max: view.max })}` : ''}` : ''}`}</SectionLabel>
      <View style={{ marginHorizontal: 20, gap: 10 }}>
        {!view && <T size={13} color={c.ink2} style={{ paddingHorizontal: 4 }}>{err ?? t('provPeers.reading')}</T>}
        {view && !view.enabled && <T size={13} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provPeers.disabled')}</T>}
        {view?.enabled && (
          <>
            <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
              {peers.length === 0 && <T size={13} color={c.ink2} style={{ padding: 14 }}>{t('provPeers.none')}</T>}
              {peers.map((p, i) => {
                const code = peerConfirmCode(p, nb);
                return (
                  <View key={p.address} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <Icon name={p.state === 'connected' ? 'lan' : p.state === 'failed' ? 'link_off' : 'pending'} size={20} w={300} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={13} w={600} mono numberOfLines={1}>{p.address}</T>
                      <T size={11.5} mono color={c.ink2}>{peerLine(p, t)}</T>
                      {code && <T size={12} w={600} mono accessibilityLabel={t('provPeers.code.a11y', { code: code.split('').join(' ') })}>{t('provPeers.code', { code: `${code.slice(0, 3)} ${code.slice(3)}` })}</T>}
                    </View>
                    {p.source === 'panel' && <Button label={busy === p.address ? '…' : t('common.remove')} variant="outline" height={34} fontSize={12.5} style={{ paddingHorizontal: 12 }} disabled={!!busy} onPress={() => void remove(p.address)} />}
                  </View>
                );
              })}
            </View>
            <T size={11.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('provPeers.codeNote')}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={address} onChangeText={v => { setAddress(v.replace(/\s/g, '')); setMsg(null); }} placeholder="192.168.0.12:8422" placeholderTextColor={c.ink3}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t('provPeers.address.a11y')}
                style={{ flex: 1, minWidth: 0, height: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, color: c.ink, fontSize: 14, fontFamily: fontFamily(500) }} />
              <Button label={busy === 'add' ? t('provDev.connecting') : t('provDev.connect')} height={46} fontSize={14} style={{ paddingHorizontal: 16 }} disabled={!looksLikePeerAddress(address) || !!busy} onPress={() => void add()} />
            </View>
            <T size={12} lh={1.4} color={msg?.ok ? c.ink : c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 4 }}>
              {msg?.text ?? (address && !looksLikePeerAddress(address) ? t('provPeers.badAddress') : t('provPeers.addressHint'))}
            </T>
          </>
        )}
        {view && err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
        <Button label={t('provPeers.refresh')} variant="soft" height={40} fontSize={13} disabled={!!busy} onPress={() => void load()} />
      </View>
    </>
  );
}
