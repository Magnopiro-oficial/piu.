/**
 * Ganhos e carteira de provider de um equipamento pareado, lidos da API local do piu-node:
 * recibos (`/api/relay/receipts`), saldo e lotes liquidados do nó (`/api/wallet`), carteira de provider
 * na Lunes Mainnet (`/api/wallet/lunes`) e a declaração da carteira do lote (`/api/payout-claims`).
 * Mudanças de carteira exigem step-up: um código novo do equipamento (`POST /api/reauth`).
 */
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useT } from '../i18n';
import { t as tGlobal } from '../i18n/core';
import type { ProvNode } from '../lib/approvalNodes';
import { type ClaimsView, type LunesWalletView, type NodeApi, NodeApiError, type NodeWalletView, type ReceiptsView } from '../lib/nodeApi';
import { saveNodeSession } from '../lib/nodeLink';
import { claimNote, epochLabel, lunesWalletLine, needsReauth, type NodeEarnings, nodeEarnings, shortAddress } from '../lib/providerCore';
import { isLunesAddress } from '../lib/ss58';
import { dayLabel, lunes2 } from '../lib/walletCore';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { fontFamily } from '../theme/fonts';
import { Button } from './Button';
import { Segmented } from './Controls';
import { Icon } from './Icon';
import { T } from './T';

export interface NodeLoad { wallet: NodeWalletView | null; receipts: ReceiptsView | null; claims: ClaimsView | null; lunes: LunesWalletView | null; errors: string[] }

/** Lê tudo do nó; o que falhar fica `null` com o motivo em `errors` (sem número inventado). */
export async function loadNode(api: NodeApi): Promise<NodeLoad> {
  const [w, r, c, l] = await Promise.allSettled([api.wallet(), api.receipts(), api.claims(), api.lunesWallet()]);
  const val = <X,>(p: PromiseSettledResult<X>) => (p.status === 'fulfilled' ? p.value : null);
  const errors = [w, r, c, l].filter(p => p.status === 'rejected').map(p => ((p as PromiseRejectedResult).reason as Error)?.message ?? tGlobal('provWallet.failed'));
  const lost = [w, r, c, l].some(p => p.status === 'rejected' && (p as PromiseRejectedResult).reason instanceof NodeApiError && ((p as PromiseRejectedResult).reason as NodeApiError).status === 401);
  if (lost) throw new NodeApiError(401, tGlobal('provWallet.sessionLost'));
  return { wallet: val(w), receipts: val(r), claims: val(c), lunes: val(l), errors: [...new Set(errors)] };
}

/** Cartão de um equipamento conectado: recibos, saldo do nó, lotes liquidados e carteiras. */
export function NodeEarningsCard({ d, api, data, onReload, onLost }: { d: ProvNode; api: NodeApi; data: NodeLoad; onReload: () => void; onLost: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const e: NodeEarnings = nodeEarnings(data.wallet, data.receipts, t);
  const rows: [string, string][] = [
    [t('provDev.receipts'), e.receipts ? t('prov.receipts.value', { own: e.receipts.keptOwn, kept: e.receipts.kept }) : t('provWallet.relayOff')],
    [t('provWallet.nodeBalance'), data.wallet ? t('provWallet.nodeBalance.value', { amount: lunes2(e.balance) }) : t('provWallet.notRead')],
    [t('provWallet.received'), data.wallet ? `${lunes2(e.received)} LUNES ${t('provWallet.inLots', { count: e.lots.length })}` : t('provWallet.notRead')],
  ];
  return (
    <View style={{ marginHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: c.line2, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <Icon name="router" size={22} w={300} />
        <T size={15} w={600} style={{ flex: 1 }} numberOfLines={1}>{d.node}</T>
        <Button label={t('prov.refresh')} variant="soft" height={34} fontSize={12.5} style={{ paddingHorizontal: 12 }} onPress={onReload} />
      </View>
      {rows.map(([l, v]) => (
        <View key={l} style={{ flexDirection: 'row', gap: 12, paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
          <T size={13} color={c.ink2} style={{ width: 92 }}>{l}</T>
          <T size={13} w={550} style={{ flex: 1 }}>{v}</T>
        </View>
      ))}
      {e.lots.map(l => (
        <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: c.line }}>
          <Icon name="toll" size={18} w={300} />
          <T size={12.5} style={{ flex: 1 }}>{`${dayLabel(l.at, Date.now(), t)} · ${l.from}`}</T>
          <T size={13} w={600} tabular>{`+${lunes2(l.amount)}`}</T>
        </View>
      ))}
      {data.errors.length > 0 && <T size={12} color={c.ink2} style={{ paddingHorizontal: 16, paddingBottom: 10 }} accessibilityRole="alert">{t('provWallet.notReadList', { errors: data.errors.join(' · ') })}</T>}
      <ProviderLunes api={api} lw={data.lunes} onSaved={onReload} onLost={onLost} />
      {data.claims && <LotClaim api={api} claims={data.claims} suggestion={data.lunes?.address ?? ''} onLost={onLost} />}
    </View>
  );
}

/** Código novo do equipamento para operações sensíveis (step-up). */
function StepUp({ api, reason, onDone, onCancel }: { api: NodeApi; reason: string; onDone: () => void; onCancel: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: c.ink }}>
      <T size={13} lh={1.4}>{`${reason} ${t('provWallet.stepUp.hint')}`}</T>
      <TextInput value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" maxLength={8} placeholder="00000000" placeholderTextColor={c.ink3}
        accessibilityLabel={t('provWallet.stepUp.a11y')}
        style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 18, letterSpacing: 4, fontFamily: fontFamily(500) }} />
      {err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={t('common.cancel')} variant="soft" height={40} fontSize={13} style={{ flex: 1 }} onPress={onCancel} />
        <Button label={busy ? t('scan.transfer.confirming') : t('backup.confirmBtn')} height={40} fontSize={13} style={{ flex: 1 }} disabled={code.length !== 8 || busy}
          onPress={async () => {
            setBusy(true); setErr(null);
            try { await api.reauth(code); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }} />
      </View>
    </View>
  );
}

/** Roda `fn`; se o nó pedir step-up, guarda a ação para depois do código. */
function useGuarded(onLost: () => void) {
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); setPending(null); }
    catch (e) {
      if (needsReauth(e)) setPending(() => fn);
      else if (e instanceof NodeApiError && e.status === 401) onLost();
      else setErr((e as Error).message);
    } finally { setBusy(false); }
  }, [onLost]);
  return { pending, setPending, err, busy, run };
}

/** Carteira de provider na Lunes Mainnet: o endereço que o nó lê (não tem a chave) e o saldo on-chain. */
function ProviderLunes({ api, lw, onSaved, onLost }: { api: NodeApi; lw: LunesWalletView | null; onSaved: () => void; onLost: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const g = useGuarded(onLost);
  const ok = isLunesAddress(draft.trim());
  const save = () => g.run(async () => {
    await api.setLunesAddress(draft);
    setEdit(false); setDraft('');
    showToast({ icon: 'check_circle', title: t('provWallet.configured'), body: t('provWallet.configured.body') });
    onSaved();
  });
  const clear = () => g.run(async () => {
    await api.clearLunesAddress();
    showToast({ icon: 'delete', title: t('provWallet.removed'), body: t('provWallet.removed.body') });
    onSaved();
  });
  return (
    <View style={{ gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: c.line }}>
      <T size={14} w={600}>{t('provWallet.title')}</T>
      {lw?.address && <T size={12} mono selectable numberOfLines={2}>{lw.address}</T>}
      <T size={12.5} lh={1.4} color={c.ink2}>{lunesWalletLine(lw, t)}</T>
      {edit ? (
        <>
          <TextInput value={draft} onChangeText={v => setDraft(v.replace(/\s/g, ''))} placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel={t('provWallet.address.a11y')} maxLength={80}
            style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(500) }} />
          <T size={11.5} lh={1.4} color={c.ink2}>{draft && !ok ? t('provWallet.badChecksum') : t('provWallet.address.hint')}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t('common.cancel')} variant="soft" height={40} fontSize={13} style={{ flex: 1 }} onPress={() => { setEdit(false); setDraft(''); g.setPending(null); }} />
            <Button label={g.busy ? t('provWallet.saving') : t('common.save')} height={40} fontSize={13} style={{ flex: 1 }} disabled={!ok || g.busy} onPress={() => void save()} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={lw?.address ? t('wallet.receiveSheet.change') : t('provWallet.setAddress')} variant="outline" height={40} fontSize={13} style={{ flex: 1 }} disabled={!lw || g.busy} onPress={() => setEdit(true)} />
          {lw?.address && <Button label={t('common.remove')} variant="outline" height={40} fontSize={13} style={{ flex: 1 }} disabled={g.busy} onPress={() => void clear()} />}
        </View>
      )}
      {g.err && <T size={12.5} color={c.ink} accessibilityRole="alert">{g.err}</T>}
      {g.pending && <StepUp api={api} reason={t('provWallet.stepUp.wallet')} onCancel={() => g.setPending(null)} onDone={() => { const f = g.pending!; void g.run(f); }} />}
    </View>
  );
}

/** "Declarar carteira do lote": o nó assina, com a chave técnica dele, a carteira que recebe o lote. */
function LotClaim({ api, claims: initial, suggestion, onLost }: { api: NodeApi; claims: ClaimsView; suggestion: string; onLost: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const [claims, setClaims] = useState(initial);
  const [epoch, setEpoch] = useState(initial.epochs[0] ?? '');
  const [address, setAddress] = useState(suggestion);
  const g = useGuarded(onLost);
  useEffect(() => { setClaims(initial); setEpoch(e => (initial.epochs.includes(e) ? e : initial.epochs[0] ?? '')); }, [initial]);
  useEffect(() => { setAddress(a => a || suggestion); }, [suggestion]);
  const ok = isLunesAddress(address.trim());
  const declare = () => g.run(async () => {
    const a = address.trim();
    setClaims(await api.declareClaim(epoch, a));
    showToast({ icon: 'verified', title: t('provWallet.claimSigned'), body: t('provWallet.claimSigned.body', { epoch, address: shortAddress(a) }) });
  });
  return (
    <View style={{ gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: c.line }}>
      <T size={14} w={600}>{t('provWallet.lotWallet')}</T>
      <T size={12.5} lh={1.4} color={c.ink2}>{t('provWallet.lotWallet.desc')}</T>
      {claims.enabled && claims.epochs.length > 0 && (
        <>
          <Segmented label={t('provWallet.lot')} value={epoch} onChange={setEpoch} options={claims.epochs.map((e, i) => [e, epochLabel(e, i, t)] as [string, string])} />
          <TextInput value={address} onChangeText={v => setAddress(v.replace(/\s/g, ''))} placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel={t('provWallet.lotAddress.a11y')} maxLength={60}
            style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(500) }} />
          <T size={11.5} lh={1.4} color={c.ink2}>{address && !ok ? t('provWallet.badChecksum') : claimNote(claims, epoch, t)}</T>
          <Button label={g.busy ? t('provWallet.signing') : t('provWallet.declare')} height={42} fontSize={13.5} disabled={!ok || !epoch || g.busy} left={<Icon name="verified" size={18} color={c.invink} />} onPress={() => void declare()} />
        </>
      )}
      {!claims.enabled && <T size={12.5} color={c.ink2}>{claimNote(claims, epoch, t)}</T>}
      {claims.claims.map(x => (
        <View key={x.epoch} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <Icon name="verified" size={16} />
          <T size={12.5} w={600}>{x.epoch}</T>
          <T size={12} mono color={c.ink2} style={{ flex: 1 }} numberOfLines={1}>{shortAddress(x.address)}</T>
        </View>
      ))}
      {!claims.claims.length && <T size={12} color={c.ink2}>{t('provWallet.noneDeclared')}</T>}
      {g.err && <T size={12.5} color={c.ink} accessibilityRole="alert">{g.err}</T>}
      {g.pending && <StepUp api={api} reason={t('provWallet.stepUp.claim')} onCancel={() => g.setPending(null)} onDone={() => { const f = g.pending!; void g.run(f); }} />}
    </View>
  );
}

/** Sessão perdida (401): apaga a sessão guardada do equipamento. */
export const forgetSession = (d: ProvNode) => saveNodeSession(d.phoneId, null);
