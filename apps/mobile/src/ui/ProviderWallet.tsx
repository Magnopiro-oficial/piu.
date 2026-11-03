/**
 * Ganhos e carteira de provider de um equipamento pareado, lidos da API local do piu-node:
 * recibos (`/api/relay/receipts`), saldo e lotes liquidados do nó (`/api/wallet`), carteira de provider
 * na Lunes Mainnet (`/api/wallet/lunes`) e a declaração da carteira do lote (`/api/payout-claims`).
 * Mudanças de carteira exigem step-up: um código novo do equipamento (`POST /api/reauth`).
 */
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
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
  const errors = [w, r, c, l].filter(p => p.status === 'rejected').map(p => ((p as PromiseRejectedResult).reason as Error)?.message ?? 'Falhou.');
  const lost = [w, r, c, l].some(p => p.status === 'rejected' && (p as PromiseRejectedResult).reason instanceof NodeApiError && ((p as PromiseRejectedResult).reason as NodeApiError).status === 401);
  if (lost) throw new NodeApiError(401, 'A sessão com o equipamento acabou. Conecte de novo na tela dele.');
  return { wallet: val(w), receipts: val(r), claims: val(c), lunes: val(l), errors: [...new Set(errors)] };
}

/** Cartão de um equipamento conectado: recibos, saldo do nó, lotes liquidados e carteiras. */
export function NodeEarningsCard({ d, api, data, onReload, onLost }: { d: ProvNode; api: NodeApi; data: NodeLoad; onReload: () => void; onLost: () => void }) {
  const { c } = useTheme();
  const e: NodeEarnings = nodeEarnings(data.wallet, data.receipts);
  const rows: [string, string][] = [
    ['Recibos', e.receipts ? `${e.receipts.keptOwn} deste nó · ${e.receipts.kept} guardados para o validador` : 'retransmissão desligada'],
    ['Saldo do nó', data.wallet ? `${lunes2(e.balance)} LUNES · registro do nó` : 'não lido'],
    ['Recebido', data.wallet ? `${lunes2(e.received)} LUNES em ${e.lots.length} ${e.lots.length === 1 ? 'lote liquidado' : 'lotes liquidados'}` : 'não lido'],
  ];
  return (
    <View style={{ marginHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: c.line2, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <Icon name="router" size={22} w={300} />
        <T size={15} w={600} style={{ flex: 1 }} numberOfLines={1}>{d.node}</T>
        <Button label="Atualizar" variant="soft" height={34} fontSize={12.5} style={{ paddingHorizontal: 12 }} onPress={onReload} />
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
          <T size={12.5} style={{ flex: 1 }}>{`${dayLabel(l.at, Date.now())} · ${l.from}`}</T>
          <T size={13} w={600} tabular>{`+${lunes2(l.amount)}`}</T>
        </View>
      ))}
      {data.errors.length > 0 && <T size={12} color={c.ink2} style={{ paddingHorizontal: 16, paddingBottom: 10 }} accessibilityRole="alert">{`Não lido: ${data.errors.join(' · ')}`}</T>}
      <ProviderLunes api={api} lw={data.lunes} onSaved={onReload} onLost={onLost} />
      {data.claims && <LotClaim api={api} claims={data.claims} suggestion={data.lunes?.address ?? ''} onLost={onLost} />}
    </View>
  );
}

/** Código novo do equipamento para operações sensíveis (step-up). */
function StepUp({ api, reason, onDone, onCancel }: { api: NodeApi; reason: string; onDone: () => void; onCancel: () => void }) {
  const { c } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: c.ink }}>
      <T size={13} lh={1.4}>{`${reason} Digite um código novo de 8 dígitos do console do equipamento.`}</T>
      <TextInput value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" maxLength={8} placeholder="00000000" placeholderTextColor={c.ink3}
        accessibilityLabel="Código novo de 8 dígitos do equipamento"
        style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 18, letterSpacing: 4, fontFamily: fontFamily(500) }} />
      {err && <T size={12.5} color={c.ink2} accessibilityRole="alert">{err}</T>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Cancelar" variant="soft" height={40} fontSize={13} style={{ flex: 1 }} onPress={onCancel} />
        <Button label={busy ? 'Confirmando…' : 'Confirmar'} height={40} fontSize={13} style={{ flex: 1 }} disabled={code.length !== 8 || busy}
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
  const { showToast } = useStore();
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const g = useGuarded(onLost);
  const ok = isLunesAddress(draft.trim());
  const save = () => g.run(async () => {
    await api.setLunesAddress(draft);
    setEdit(false); setDraft('');
    showToast({ icon: 'check_circle', title: 'Carteira de provider configurada', body: 'O nó lê o saldo dela na Lunes Mainnet. Ele não tem a chave e não assina nada com ela.' });
    onSaved();
  });
  const clear = () => g.run(async () => {
    await api.clearLunesAddress();
    showToast({ icon: 'delete', title: 'Endereço removido', body: 'O nó parou de ler o saldo dessa carteira.' });
    onSaved();
  });
  return (
    <View style={{ gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: c.line }}>
      <T size={14} w={600}>Carteira de provider (Lunes)</T>
      {lw?.address && <T size={12} mono selectable numberOfLines={2}>{lw.address}</T>}
      <T size={12.5} lh={1.4} color={c.ink2}>{lunesWalletLine(lw)}</T>
      {edit ? (
        <>
          <TextInput value={draft} onChangeText={t => setDraft(t.replace(/\s/g, ''))} placeholder="Endereço Lunes (SS58)" placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel="Endereço Lunes da carteira de provider" maxLength={80}
            style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(500) }} />
          <T size={11.5} lh={1.4} color={c.ink2}>{draft && !ok ? 'Confira o endereço: a soma de verificação não bate (SS58 da Lunes).' : 'O nó confere o endereço de novo e só lê o saldo. Pede um código novo do equipamento.'}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Cancelar" variant="soft" height={40} fontSize={13} style={{ flex: 1 }} onPress={() => { setEdit(false); setDraft(''); g.setPending(null); }} />
            <Button label={g.busy ? 'Salvando…' : 'Salvar'} height={40} fontSize={13} style={{ flex: 1 }} disabled={!ok || g.busy} onPress={() => void save()} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={lw?.address ? 'Trocar endereço' : 'Definir endereço'} variant="outline" height={40} fontSize={13} style={{ flex: 1 }} disabled={!lw || g.busy} onPress={() => setEdit(true)} />
          {lw?.address && <Button label="Remover" variant="outline" height={40} fontSize={13} style={{ flex: 1 }} disabled={g.busy} onPress={() => void clear()} />}
        </View>
      )}
      {g.err && <T size={12.5} color={c.ink} accessibilityRole="alert">{g.err}</T>}
      {g.pending && <StepUp api={api} reason="Mudar a carteira de provider exige uma confirmação recente." onCancel={() => g.setPending(null)} onDone={() => { const f = g.pending!; void g.run(f); }} />}
    </View>
  );
}

/** "Declarar carteira do lote": o nó assina, com a chave técnica dele, a carteira que recebe o lote. */
function LotClaim({ api, claims: initial, suggestion, onLost }: { api: NodeApi; claims: ClaimsView; suggestion: string; onLost: () => void }) {
  const { c } = useTheme();
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
    showToast({ icon: 'verified', title: 'Carteira do lote assinada', body: `${epoch} · ${shortAddress(a)}. Leve a declaração e as evidências ao validador pelo painel do equipamento.` });
  });
  return (
    <View style={{ gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: c.line }}>
      <T size={14} w={600}>Carteira do lote</T>
      <T size={12.5} lh={1.4} color={c.ink2}>O nó assina qual carteira LUNES recebe o lote. O vínculo vale só para aquele lote. Quem paga é a liquidação na Lunes, ainda não conectada a este celular.</T>
      {claims.enabled && claims.epochs.length > 0 && (
        <>
          <Segmented label="Lote" value={epoch} onChange={setEpoch} options={claims.epochs.map((e, i) => [e, epochLabel(e, i)] as [string, string])} />
          <TextInput value={address} onChangeText={t => setAddress(t.replace(/\s/g, ''))} placeholder="Endereço Lunes (SS58)" placeholderTextColor={c.ink3} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel="Endereço Lunes que recebe o lote" maxLength={60}
            style={{ height: 46, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.bg2, color: c.ink, fontSize: 13, fontFamily: fontFamily(500) }} />
          <T size={11.5} lh={1.4} color={c.ink2}>{address && !ok ? 'Confira o endereço: a soma de verificação não bate (SS58 da Lunes).' : claimNote(claims, epoch)}</T>
          <Button label={g.busy ? 'Assinando…' : 'Declarar carteira do lote'} height={42} fontSize={13.5} disabled={!ok || !epoch || g.busy} left={<Icon name="verified" size={18} color={c.invink} />} onPress={() => void declare()} />
        </>
      )}
      {!claims.enabled && <T size={12.5} color={c.ink2}>{claimNote(claims, epoch)}</T>}
      {claims.claims.map(x => (
        <View key={x.epoch} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <Icon name="verified" size={16} />
          <T size={12.5} w={600}>{x.epoch}</T>
          <T size={12} mono color={c.ink2} style={{ flex: 1 }} numberOfLines={1}>{shortAddress(x.address)}</T>
        </View>
      ))}
      {!claims.claims.length && <T size={12} color={c.ink2}>Nenhuma declarada. Sem carteira declarada, o que o nó tiver para receber fica para o lote seguinte.</T>}
      {g.err && <T size={12.5} color={c.ink} accessibilityRole="alert">{g.err}</T>}
      {g.pending && <StepUp api={api} reason="Declarar a carteira que recebe o lote exige uma confirmação recente." onCancel={() => g.setPending(null)} onDone={() => { const f = g.pending!; void g.run(f); }} />}
    </View>
  );
}

/** Sessão perdida (401): apaga a sessão guardada do equipamento. */
export const forgetSession = (d: ProvNode) => saveNodeSession(d.phoneId, null);
