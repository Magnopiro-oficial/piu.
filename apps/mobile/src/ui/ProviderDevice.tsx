/**
 * Partes da tela do equipamento (app/provider/device/[id].tsx) que falam com a API local do piu-node:
 * regras de cada equipamento da conta, revogação e vizinhos por endereço. Tudo vem do nó; os textos
 * vêm de lib/providerCore.ts (testado).
 */
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { confirmDevice } from '../lib/deviceAuth';
import { type DeviceLimits, type DeviceView, NodeApi, type PeersView, type RelayView } from '../lib/nodeApi';
import {
  addPeerMessage, LIMIT_BW, LIMIT_DEFAULT, LIMIT_HOURS, LIMIT_STO, limitsLabel, limitsNote, looksLikePeerAddress, peerConfirmCode, peerLine, revokeMessage,
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
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <SectionLabel>{`EQUIPAMENTOS DESTA CONTA · ${devices.length}`}</SectionLabel>
      <View style={{ marginHorizontal: 20, gap: 8 }}>
        {devices.map(d => (
          <View key={d.id} style={{ borderRadius: 20, borderWidth: 1, borderColor: open === d.id ? c.ink : c.line2, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Icon name={d.self ? 'router' : d.nodeId ? 'hub' : 'devices'} size={22} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={600} numberOfLines={1}>{d.name}{d.self ? ' · este nó' : ''}</T>
                <T size={11.5} mono color={c.ink2} numberOfLines={2}>{`${d.cls} · ${d.status === 'paused' ? 'pausado' : 'ativo'}${d.nodeId ? ` · nó ${d.nodeId}` : ''}${d.link ? (d.link.online ? ' · conectado' : ' · desconectado') : ''} · ${limitsLabel(d.limits)}`}</T>
              </View>
              <Button label={open === d.id ? 'Fechar' : 'Regras'} variant="outline" height={36} fontSize={13} style={{ paddingHorizontal: 14 }} onPress={() => setOpen(o => (o === d.id ? null : d.id))} />
            </View>
            {open === d.id && <DeviceRules api={api} d={d} onChanged={onChanged} />}
          </View>
        ))}
        {devices.length === 0 && <T size={13} color={c.ink2} style={{ paddingHorizontal: 4 }}>O nó não listou nenhum equipamento desta conta.</T>}
      </View>
    </>
  );
}

function DeviceRules({ api, d, onChanged }: { api: NodeApi; d: DeviceView; onChanged: () => void }) {
  const { c } = useTheme();
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
    const auth = await confirmDevice(`Revogar ${d.name}`);
    if (auth === 'denied') { showToast({ icon: 'gpp_bad', title: 'Nada foi alterado', body: 'Não foi possível confirmar que é você.' }); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.revoke(d.id);
      const m = revokeMessage(d.name, r);
      setResult(`${m.title}. ${m.body}`);
      showToast({ icon: r.revoked ? 'gpp_bad' : 'delete', title: m.title, body: m.body });
      onChanged();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <T size={13.5} w={600} style={{ flex: 1 }}>Regras próprias deste equipamento</T>
        <Toggle on={on} disabled={busy} label="Regras próprias deste equipamento" onChange={() => void save(on ? null : LIMIT_DEFAULT)} />
      </View>
      {on && (
        <>
          <T size={12} color={c.ink2}>Banda para a rede</T>
          <Segmented label="Banda" value={String(v.bw)} onChange={x => set({ bw: Number(x) as DeviceLimits['bw'] })} options={LIMIT_BW.map(o => [String(o.value), o.label])} />
          <T size={12} color={c.ink2}>Armazenamento para terceiros</T>
          <Segmented label="Armazenamento" value={String(v.sto)} onChange={x => set({ sto: Number(x) as DeviceLimits['sto'] })} options={LIMIT_STO.map(o => [String(o.value), o.label])} />
          <T size={12} color={c.ink2}>Horário</T>
          <Segmented<DeviceLimits['hours']> label="Horário" value={v.hours} onChange={hours => set({ hours })} options={LIMIT_HOURS.map(o => [o.value, o.label])} />
        </>
      )}
      <T size={12} lh={1.4} color={c.ink2}>{busy ? 'Salvando no equipamento…' : limitsNote(cur)}</T>
      {err && <T size={12.5} color={c.ink} accessibilityRole="alert">{err}</T>}
      {result && <T size={12.5} lh={1.4} accessibilityLiveRegion="polite">{result}</T>}
      {!d.self && !result && (
        <Button label={d.nodeId ? 'Revogar e remover' : 'Remover da lista'} variant="outline" height={42} fontSize={13.5} disabled={busy} left={<Icon name="gpp_bad" size={18} />} onPress={() => setConfirm(true)} />
      )}
      {d.self && <T size={11.5} lh={1.4} color={c.ink2}>Este é o nó que responde ao celular: não dá para revogá-lo daqui. Para tirá-lo da malha, pause a retransmissão ou desinstale o Piu Node nele.</T>}
      {confirm && (
        <Dialog icon="gpp_bad" title={d.nodeId ? `Revogar ${d.name}?` : `Remover ${d.name}?`} primary={d.nodeId ? 'Revogar' : 'Remover'} primaryIcon="gpp_bad" hold
          body={d.nodeId
            ? 'A chave técnica dele entra na lista de revogação assinada pela sua chave de operador: os seus nós recusam o enlace com ele. Para voltar, é preciso reinstalar o Piu Node nele. Segure para confirmar; depois o celular pede a biometria.'
            : 'Ele não tem identidade técnica vinculada: só sai da lista deste nó. Segure para confirmar; depois o celular pede a biometria.'}
          onClose={() => setConfirm(false)} onPrimary={() => void revoke()} />
      )}
    </View>
  );
}

/** Vizinhos por endereço (`host:porta`): estado real, código de confirmação do enlace, adicionar e remover. */
export function PeersSection({ api, relay }: { api: NodeApi; relay: RelayView | null }) {
  const { c } = useTheme();
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
    try { const r = await api.addPeer(a); setMsg(addPeerMessage(r.peer)); if (r.peer?.state === 'connected') setAddress(''); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const remove = async (a: string) => {
    if (busy) return;
    setBusy(a);
    try { await api.removePeer(a); showToast({ icon: 'link_off', title: 'Vizinho removido', body: `${a} · o nó parou de conectar a ele.` }); await load(); }
    catch (e) { showToast({ icon: 'error', title: 'Não foi possível remover', body: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const peers = view?.peers ?? [];
  return (
    <>
      <SectionLabel>{`VIZINHOS POR ENDEREÇO${view?.enabled ? ` · ${peers.length}${view.max ? ` de ${view.max}` : ''}` : ''}`}</SectionLabel>
      <View style={{ marginHorizontal: 20, gap: 10 }}>
        {!view && <T size={13} color={c.ink2} style={{ paddingHorizontal: 4 }}>{err ?? 'Lendo os vizinhos do equipamento…'}</T>}
        {view && !view.enabled && <T size={13} lh={1.45} color={c.ink2} style={{ paddingHorizontal: 4 }}>A retransmissão LNNP está desligada neste nó: não há enlace para vizinhos por endereço.</T>}
        {view?.enabled && (
          <>
            <View style={{ borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' }}>
              {peers.length === 0 && <T size={13} color={c.ink2} style={{ padding: 14 }}>Nenhum vizinho por endereço. Os que o nó encontra sozinho na rede local não aparecem aqui.</T>}
              {peers.map((p, i) => {
                const code = peerConfirmCode(p, nb);
                return (
                  <View key={p.address} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <Icon name={p.state === 'connected' ? 'lan' : p.state === 'failed' ? 'link_off' : 'pending'} size={20} w={300} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={13} w={600} mono numberOfLines={1}>{p.address}</T>
                      <T size={11.5} mono color={c.ink2}>{peerLine(p)}</T>
                      {code && <T size={12} w={600} mono accessibilityLabel={`Código de confirmação ${code.split('').join(' ')}`}>{`código ${code.slice(0, 3)} ${code.slice(3)}`}</T>}
                    </View>
                    {p.source === 'panel' && <Button label={busy === p.address ? '…' : 'Remover'} variant="outline" height={34} fontSize={12.5} style={{ paddingHorizontal: 12 }} disabled={!!busy} onPress={() => void remove(p.address)} />}
                  </View>
                );
              })}
            </View>
            <T size={11.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>O código de cada enlace sai do handshake e é o mesmo no painel do outro nó (Malha → Vizinhos): confira nos dois, ao mesmo tempo, que o enlace é com o equipamento certo. Ele muda a cada conexão nova.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={address} onChangeText={t => { setAddress(t.replace(/\s/g, '')); setMsg(null); }} placeholder="192.168.0.12:8422" placeholderTextColor={c.ink3}
                autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Endereço do vizinho (host:porta)"
                style={{ flex: 1, minWidth: 0, height: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2, color: c.ink, fontSize: 14, fontFamily: fontFamily(500) }} />
              <Button label={busy === 'add' ? 'Conectando…' : 'Conectar'} height={46} fontSize={14} style={{ paddingHorizontal: 16 }} disabled={!looksLikePeerAddress(address) || !!busy} onPress={() => void add()} />
            </View>
            <T size={12} lh={1.4} color={msg?.ok ? c.ink : c.ink2} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 4 }}>
              {msg?.text ?? (address && !looksLikePeerAddress(address) ? 'Use só host:porta (ex.: 192.168.0.12:8422), sem http:// nem caminho.' : 'Só host:porta do enlace LNNP do outro nó (8422 por padrão). Fica salvo no equipamento e reconecta sozinho. Só o dono do equipamento muda os vizinhos.')}
            </T>
          </>
        )}
        {view && err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
        <Button label="Atualizar vizinhos" variant="soft" height={40} fontSize={13} disabled={!!busy} onPress={() => void load()} />
      </View>
    </>
  );
}
