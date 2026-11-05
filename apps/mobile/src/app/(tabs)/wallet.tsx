import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { REFERRAL_REWARD, WELCOME_BONUS } from '../../data/wallet';
import { CREDIT_PARAMS } from '../../messaging/credits';
import { fmtDate, fmtNumber, useT, type Key } from '../../i18n';
import { balanceEye, maskAmount, maskBalance } from '../../lib/balanceMask';
import { explorerAccountUrl, fromHistorySnapshot, indexerAccountId, moveRow, type HistorySnapshot } from '../../lib/lunesHistory';
import { formatLunes, LUNES_EXPLORER } from '../../lib/lunesRpc';
import { shareTextFile } from '../../lib/shareFile';
import { activityRows, bonusSteps, dayLabel, lunes2, onchainView, referralStats, walletSummary, whenLabel, type OnchainStatus } from '../../lib/walletCore';
import { evidenceFileName } from '../../messaging/evidence';
import { useMessaging, useStats } from '../../state/messaging';
import { useSettings } from '../../state/settings';
import { useStore } from '../../state/store';
import { useWallet } from '../../state/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { SectionLabel, Segmented } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';
import { ReceiveSheet, SendSheet } from '../../ui/WalletSheets';

const NO_TOTALS = { pendente: 0, validado: 0, em_lote: 0, rejeitado: 0, pago: 0 };
const STATE_LABEL: Record<string, Key> = { pendente: 'wallet.state.pendente', validado: 'wallet.state.validado', em_lote: 'wallet.state.em_lote', rejeitado: 'wallet.state.rejeitado', pago: 'wallet.state.pago' };

/** Carteira: Saldo (enviar, receber, convidar, bônus, distribuição, atividade) e Créditos de rede. */
export default function WalletTab() {
  const { c } = useTheme();
  const t = useT();
  const [tab, setTab] = useState<'wallet' | 'rewards'>('wallet');
  const [sheet, setSheet] = useState<'send' | 'receive' | null>(null);
  const { lunesAddress, onchainSnap, onchainStatus, refreshOnchain, historyStatus, refreshHistory } = useWallet();
  const view = onchainView({ address: lunesAddress, snap: onchainSnap, status: onchainStatus, now: Date.now() });
  // Lê o saldo (nó da Mainnet) e o histórico (indexador) ao abrir a carteira e de novo quando o endereço muda.
  const refreshAll = useCallback(() => { void refreshOnchain(); void refreshHistory(); }, [refreshOnchain, refreshHistory]);
  useFocusEffect(refreshAll);
  const refreshing = onchainStatus.state === 'loading' || historyStatus.state === 'loading';

  return (
    <Screen edges={['top']} enter="tab">
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={lunesAddress ? <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={c.ink2} /> : undefined}>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <T size={36} w={700} ls={-0.045} style={{ lineHeight: 38 }} accessibilityRole="header">{t('tabs.wallet')}</T>
          <View accessibilityLabel={view.pill} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 99, borderWidth: 1, borderColor: c.line2, flexShrink: 1 }}>
            <Icon name={view.pillIcon} size={14} color={c.ink2} />
            <T size={12} w={500} color={c.ink2} numberOfLines={1}>{view.pill}</T>
          </View>
        </View>
        <View style={{ paddingTop: 12, paddingHorizontal: 20 }}>
          <Segmented label={t('tabs.wallet')} value={tab} onChange={setTab} options={[['wallet', t('wallet.tab.balance')], ['rewards', t('wallet.tab.credits')]]} />
        </View>
        {tab === 'wallet' ? <Balance onSheet={setSheet} /> : <Rewards />}
      </ScrollView>
      {sheet === 'send' && <SendSheet onClose={() => setSheet(null)} />}
      {sheet === 'receive' && <ReceiveSheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}

function Balance({ onSheet }: { onSheet: (s: 'send' | 'receive') => void }) {
  const { c } = useTheme();
  const t = useT();
  const { onchain, reserved, refunded, spent, earned, lunesAddress, onchainSnap, onchainStatus, historySnap, historyStatus, refreshHistory, canSign, nativeWalletReady, useOwnWallet, pendingTransfer } = useWallet();
  const { backupDone, hideBalance, setHideBalance } = useSettings();
  // Olho do saldo: só esconde a exibição (saldo, "a liberar", reservado); os dados ficam intactos.
  const eye = balanceEye(hideBalance);
  const { onboarded, verified, chats, showToast } = useStore();
  const st = useStats(5000);
  const now = Date.now();
  const sum = walletSummary({ onchain, totals: st?.credits.totals ?? NO_TOTALS, reserved, perLunes: CREDIT_PARAMS.creditsPerLunes });
  const activity = activityRows({ lots: st?.credits.lots ?? [], reserved, refunded, spent, earned, now });
  // Só contatos reais (pelo QR) contam para "Confirmada por 1 contato".
  const verifiedContact = chats.some(ch => ch.peer && verified[ch.id]);
  // "7 dias": dias com entrega confirmada para 3+ contatos distintos (registro local do mensageiro).
  const steps = bonusSteps({ onboarded, backupDone, verifiedContact, activeDays: st?.usage.activeDays ?? 0 });
  const refs = referralStats(st?.usage.accepted ?? [], now);
  const view = onchainView({ address: lunesAddress, snap: onchainSnap, status: onchainStatus, now });
  const snap = view.has ? onchainSnap : null;
  const copy = () => {
    if (!lunesAddress) return;
    void Clipboard.setStringAsync(lunesAddress).then(() => showToast({ icon: 'content_copy', title: t('wallet.addressCopied'), body: lunesAddress })).catch(() => {});
  };
  const actions: [IconName, string, () => void][] = [
    ['arrow_upward', t('wallet.send'), () => onSheet('send')],
    ['arrow_downward', t('wallet.receive'), () => onSheet('receive')],
    ['person_add', t('wallet.invite'), () => router.push('/invite')],
  ];

  return (
    <>
      <View style={{ marginTop: 14, marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: c.line2, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Icon name={canSign ? 'account_balance_wallet' : 'visibility'} size={22} />
          <T size={15} w={650} style={{ flex: 1 }}>{t(canSign ? 'ownWallet.title' : lunesAddress ? 'ownWallet.watchTitle' : 'ownWallet.unavailableTitle')}</T>
        </View>
        <T size={12.5} lh={1.45} color={c.ink2}>{t(canSign ? 'ownWallet.nativeNote' : lunesAddress ? 'ownWallet.watchNote' : 'ownWallet.unavailableNote')}</T>
        {!canSign && nativeWalletReady && <Button label={t('ownWallet.useOwn')} variant="outline" height={46} onPress={useOwnWallet} />}
      </View>
      <View style={{ marginTop: 14, marginHorizontal: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, borderRadius: 28, backgroundColor: c.ink, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <T size={13} color={c.invink} style={{ opacity: 0.7 }}>{t('wallet.available')}</T>
            <Pressable onPress={() => setHideBalance(!hideBalance)} accessibilityRole="button" accessibilityLabel={eye.label} accessibilityState={{ selected: hideBalance }} hitSlop={8}
              style={{ width: 36, height: 36, marginVertical: -8, marginRight: -8, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: 0.85 }}>
              <Icon name={eye.icon} size={20} color={c.invink} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            {/* Sem leitura da Mainnet (sem endereço, ou nunca lido): traço, não um zero que pareça saldo. */}
            <T size={54} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 56 }} accessibilityLiveRegion="polite">{maskBalance(view.has ? lunes2(sum.available) : '—', hideBalance)}</T>
            <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>LUNES</T>
          </View>
          <T size={12.5} lh={1.4} color={c.invink} style={{ opacity: view.stale ? 0.9 : 0.75 }}>{view.line}</T>
          {snap && sum.reserved > 0 && <T size={12.5} lh={1.4} color={c.invink} style={{ opacity: 0.75 }}>{t('wallet.reservedLine', { free: maskAmount(formatLunes(BigInt(snap.free)), hideBalance), reserved: maskAmount(lunes2(sum.reserved), hideBalance) })}</T>}
          <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.75 }}>{sum.toRelease > 0 ? t('wallet.toRelease', { amount: maskAmount(lunes2(sum.toRelease), hideBalance), pending: t('wallet.mainnetPending') }) : t('wallet.creditsLine', { pending: t('wallet.mainnetPending') })}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {actions.map(([icon, label, go]) => (
            <Pressable key={label} onPress={go} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={24} color={c.ink} /></View>
              <T size={12.5} w={550} color={c.invink}>{label}</T>
            </Pressable>
          ))}
        </View>
        {lunesAddress ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)' }}>
            <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel={t('wallet.copyAddress.a11y', { address: lunesAddress })} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.85 }}>
              <Icon name="content_copy" size={16} color={c.invink} />
              <T size={12} mono color={c.invink} numberOfLines={1} style={{ flex: 1 }}>{`${lunesAddress.slice(0, 10)}…${lunesAddress.slice(-6)}`}</T>
            </Pressable>
            <Pressable onPress={() => { void Linking.openURL(LUNES_EXPLORER).catch(() => {}); }} accessibilityRole="link" accessibilityLabel={t('wallet.explorer.a11y')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.85 }}>
              <T size={12} w={600} color={c.invink}>{t('wallet.explorer')}</T>
              <Icon name="north_east" size={14} color={c.invink} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => onSheet('receive')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)', opacity: 0.85 }}>
            <Icon name="key" size={16} color={c.invink} />
            <T size={12} lh={1.4} color={c.invink} style={{ flex: 1 }}>{t('wallet.needAddress')}</T>
            <Icon name="chevron_right" size={16} color={c.invink} />
          </Pressable>
        )}
      </View>

      {pendingTransfer && (
        <View accessibilityLiveRegion="polite" style={{ marginTop: 12, marginHorizontal: 20, padding: 16, backgroundColor: c.bg2, borderRadius: 20, gap: 10 }}>
          <T size={15} w={650}>{t(`ownWallet.status.${pendingTransfer.status}`)}</T>
          {['signed', 'submitted', 'included'].includes(pendingTransfer.status) && <T size={12.5} lh={1.45} color={c.ink2}>{t('ownWallet.pendingNote')}</T>}
          <T size={11.5} mono lh={1.45} selectable>{pendingTransfer.hash}</T>
          <Button label={t('ownWallet.openTransfer')} variant="outline" height={46} onPress={() => onSheet('send')} />
        </View>
      )}

      <View style={{ marginTop: 12, marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="redeem" size={22} w={300} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15.5} w={600}>{t('wallet.bonus')}</T>
            <T size={12.5} lh={1.35} color={c.ink2}>{t('wallet.bonus.desc')}</T>
          </View>
          <T size={16} w={650} tabular color={c.ink2}>{lunes2(WELCOME_BONUS)}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {steps.map(([label, w]) => (
            <View key={label} accessibilityLabel={`${label}: ${w === 100 ? t('wallet.bonus.done') : `${w}%`}`} style={{ flex: 1, gap: 7 }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}><View style={{ height: '100%', width: `${w}%`, backgroundColor: c.ink }} /></View>
              <T size={11} lh={1.25} w={w === 100 ? 450 : 650} color={w === 100 ? c.ink2 : c.ink}>{label}</T>
            </View>
          ))}
        </View>
        <T size={11.5} lh={1.4} color={c.ink2}>{t('wallet.bonus.note')}</T>
      </View>

      <View style={{ marginTop: 12, marginHorizontal: 20, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16, borderRadius: 22, borderWidth: 1.5, borderColor: c.ink, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <T size={19} w={650} ls={-0.025}>{t('wallet.ref.title')}</T>
          <T size={13.5} lh={1.4} color={c.ink2}>{t('wallet.ref.desc', { reward: REFERRAL_REWARD })}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[[String(refs.accepted), t('wallet.ref.accepted')], [String(refs.paid), t('wallet.ref.paid')], [lunes2(refs.earned), t('wallet.ref.earned')]].map(([v, l]) => (
            <View key={l} style={{ flex: 1, gap: 2 }}>
              <T size={22} w={650} ls={-0.03} tabular>{v}</T>
              <T size={11.5} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>
        <T size={11.5} lh={1.4} color={c.ink2}>{t('wallet.ref.note', { reward: REFERRAL_REWARD })}</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={t('wallet.ref.inviteNow')} height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => router.push('/invite')} />
          <Button label={t('wallet.ref.seeInvited')} variant="outline" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => router.push('/wallet/referrals')} />
        </View>
      </View>

      <SectionLabel>{t('wallet.moves')}</SectionLabel>
      <LunesActivity address={lunesAddress} snap={historySnap} status={historyStatus} hidden={hideBalance} now={now} onRetry={() => { void refreshHistory(); }} onNeedAddress={() => onSheet('receive')} />
      {/* Registros só deste aparelho (créditos de rede, convites pagos): não são movimentações da Mainnet. */}
      {activity.length > 0 && (
        <>
          <SectionLabel>{t('wallet.localRecords')}</SectionLabel>
          <View style={{ marginHorizontal: 20 }}>
            {activity.map((r, i) => <Row key={`${r.title}-${i}`} icon={r.icon} t={r.title} d={`${dayLabel(r.at, now)} · ${r.status}`} v={maskAmount(r.value, hideBalance)} />)}
          </View>
        </>
      )}
      <View style={{ marginTop: 18, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
        <Icon name="key" size={17} />
        <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('wallet.footnote')}</T>
      </View>
    </>
  );
}

function Rewards() {
  const { c } = useTheme();
  const t = useT();
  const st = useStats(3000);
  const { evidence, ready } = useMessaging();
  const { showToast } = useStore();
  const [exporting, setExporting] = useState(false);
  /** Recibos e provas deste aparelho no formato do validador, por um arquivo temporário e a folha de compartilhar. */
  const exportEvidence = async () => {
    const file = evidence();
    if (!file || exporting) return;
    setExporting(true);
    try {
      await shareTextFile(evidenceFileName(Date.now()), JSON.stringify(file, null, 2), { mimeType: 'application/json', dialogTitle: t('wallet.evidence.dialog') });
    } catch (e) {
      showToast({ icon: 'error', title: t('wallet.evidence.fail'), body: (e as Error).message || t('common.tryAgain') });
    } finally { setExporting(false); }
  };
  // Antes das chaves (ou sem nada ainda), mostra os números deste aparelho mesmo assim: zero.
  const tot = st?.credits.totals ?? NO_TOTALS;
  // "Em lote": o lote da semana fechou neste aparelho e aguarda liquidação. "Pagos" só com liquidação real (ainda não existe no celular).
  const rows: [string, number, number][] = [[t('wallet.credits.validated'), tot.validado, 1], [t('wallet.credits.batched'), tot.em_lote, 0.7], [t('wallet.credits.pending'), tot.pendente, 0.45], [t('wallet.credits.rejected'), tot.rejeitado, 0.15],
    ...(tot.pago > 0 ? [[t('wallet.credits.paid'), tot.pago, 0.3] as [string, number, number]] : [])];
  const total = rows.reduce((a, x) => a + x[1], 0);
  const fmt = (n: number) => fmtNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const lunes = (n: number) => fmtNumber(n / CREDIT_PARAMS.creditsPerLunes, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const history: [IconName, string, string, string][] = [
    ...(st?.credits.lots ?? []).map(l => ['account_balance_wallet', t('wallet.lotClosed', { id: l.id.replace('lote-', '') }), `${fmtDate(l.closedAt * 1000, { day: '2-digit', month: 'short' })} · ${lunes(l.credits)} LUNES · ${t('wallet.awaitingSettlement')}`, fmt(l.credits)] as [IconName, string, string, string]),
    ...(st?.credits.list ?? []).slice(0, 12).map(x => [
      x.state === 'rejeitado' ? 'block' : x.state === 'pendente' ? 'hourglass_top' : x.state === 'em_lote' ? 'toll' : 'verified',
      t('wallet.thirdPartyDelivery', { kb: fmtNumber(Math.round(x.bytes / 100) / 10) }),
      // Regra 7.6: o valor é estimado, dividido entre os relays que este aparelho conhece até ele.
      `${fmtDate(x.at * 1000, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${STATE_LABEL[x.state] ? t(STATE_LABEL[x.state]!) : x.state}${x.reason ? ` (${x.reason})` : ''} · ${t('wallet.estimate')}${(x.relays ?? 1) > 1 ? ` ÷ ${x.relays} relays` : ''}`,
      `${x.state === 'rejeitado' ? '' : '≈ +'}${fmt(x.credits)}`,
    ] as [IconName, string, string, string]),
  ];
  return (
    <>
      <View style={{ marginTop: 10, marginHorizontal: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, borderRadius: 26, backgroundColor: c.ink, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <T size={13} color={c.invink} style={{ opacity: 0.7 }}>{t('wallet.credits.readyTitle')}</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={52} w={650} ls={-0.05} tabular color={c.invink} style={{ lineHeight: 54 }}>{fmt(tot.validado)}</T>
            <T size={15} color={c.invink} style={{ opacity: 0.7 }}>{t('wallet.credits.unit')}</T>
          </View>
          <T size={12.5} mono color={c.invink} style={{ opacity: 0.7 }}>≈ {lunes(tot.validado)} LUNES · {t('wallet.estimate')}</T>
        </View>
        <View accessibilityLabel={t('wallet.credits.byState')} style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, backgroundColor: total ? 'transparent' : 'rgba(127,127,127,0.35)' }}>
          {total > 0 && rows.map(([l, n, op]) => <View key={l} style={{ width: `${(n / total) * 100}%`, backgroundColor: c.invink, opacity: op }} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16 }}>
          {rows.map(([l, n, op]) => (
            <View key={l} style={{ width: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.invink, opacity: op }} />
              <T size={12.5} color={c.invink} style={{ flex: 1, opacity: 0.75 }}>{l}</T>
              <T size={13} w={600} tabular color={c.invink}>{fmt(n)}</T>
            </View>
          ))}
        </View>
      </View>
      <View style={{ marginTop: 12, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="cloud_off" size={22} w={300} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14} w={600}>{t('wallet.lots.pendingTitle')}</T>
          <T size={12.5} lh={1.35} color={c.ink2}>{t('wallet.lots.pendingBody')}</T>
        </View>
      </View>
      <View style={{ marginTop: 12, marginHorizontal: 20, padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="description" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>{t('wallet.evidence')}</T>
            <T size={12.5} lh={1.35} color={c.ink2}>{t('wallet.evidence.desc')}</T>
          </View>
        </View>
        <Button label={exporting ? t('wallet.evidence.preparing') : t('wallet.evidence.share')} variant="outline" height={44} fontSize={14} disabled={!ready || exporting} left={<Icon name="upload" size={18} />} onPress={() => void exportEvidence()} />
        <T size={11.5} lh={1.4} color={c.ink2}>{t('wallet.evidence.note')}</T>
      </View>
      <SectionLabel>{t('wallet.history')}</SectionLabel>
      <View style={{ marginHorizontal: 20 }}>
        {history.length === 0 && <T size={13} lh={1.45} color={c.ink2} style={{ paddingVertical: 12, paddingHorizontal: 4 }}>{t('wallet.history.empty')}</T>}
        {history.map(([icon, title, d, v], i) => <Row key={`${title}-${i}`} icon={icon} t={title} d={d} v={v} />)}
      </View>
      <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 18, marginHorizontal: 24 }}>{t('wallet.credits.note1')}</T>
      <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 8, marginHorizontal: 24 }}>{t('wallet.credits.note2')}</T>
    </>
  );
}

/**
 * Histórico real de transferências de LUNES do endereço, do indexador da Lunes (lib/lunesHistory.ts).
 * Estados: sem endereço, consultando, sem movimentações, erro (toque para tentar de novo) e a lista,
 * cada linha abrindo o bloco no explorador. Nada inventado: sem leitura, diz que não há.
 */
function LunesActivity({ address, snap, status, hidden, now, onRetry, onNeedAddress }: {
  address: string | null; snap: HistorySnapshot | null; status: OnchainStatus; hidden: boolean; now: number;
  onRetry: () => void; onNeedAddress: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const note = (text: string, o: { onPress?: () => void; icon?: IconName; label?: string } = {}) => (
    <Pressable onPress={o.onPress} disabled={!o.onPress} accessibilityRole={o.onPress ? 'button' : undefined} accessibilityLabel={o.label}
      style={{ marginHorizontal: 20, paddingVertical: 12, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {o.icon && <Icon name={o.icon} size={18} color={c.ink2} />}
      <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{text}</T>
      {o.onPress && <Icon name="chevron_right" size={16} color={c.ink2} />}
    </Pressable>
  );
  if (!address) return note(t('wallet.moves.needAddress'), { onPress: onNeedAddress, icon: 'key' });
  const history = snap && snap.address === address ? fromHistorySnapshot(snap) : null;
  if (!history) {
    if (status.state === 'error') return note(t('wallet.moves.error', { error: status.error }), { onPress: onRetry, icon: 'cloud_off', label: t('wallet.moves.retry.a11y') });
    return note(t('wallet.moves.loading'), { icon: 'cloud' });
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => {}); };
  const all = explorerAccountUrl(indexerAccountId(address));
  const updated = status.state === 'loading' ? t('wallet.moves.updating') : t('wallet.moves.updated', { when: whenLabel(history.at, now) });
  return (
    <View style={{ marginHorizontal: 20 }}>
      {history.moves.length === 0 && <T size={13} lh={1.45} color={c.ink2} style={{ paddingVertical: 12, paddingHorizontal: 4 }}>{t('wallet.moves.empty')}</T>}
      {history.moves.map(m => {
        const r = moveRow(m, now, hidden);
        return (
          <Pressable key={m.id} onPress={() => open(r.url)} accessibilityRole="link" accessibilityLabel={`${r.title}, ${r.value} LUNES, ${r.detail}. ${t('wallet.moves.openExplorer')}`}>
            <Row icon={r.icon} t={r.title} d={r.detail} v={r.value} />
          </Pressable>
        );
      })}
      {status.state === 'error' && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={{ paddingTop: 12, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="cloud_off" size={16} color={c.ink2} />
          <T size={12} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{t('wallet.moves.offline', { updated })}</T>
        </Pressable>
      )}
      <Pressable onPress={() => open(all)} accessibilityRole="link" accessibilityLabel={t('wallet.moves.all.a11y')} style={{ paddingTop: 12, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T size={12} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{`${history.truncated ? `${t('wallet.moves.truncated', { shown: history.moves.length, total: history.total })} · ` : ''}${t('wallet.moves.source')}${status.state === 'error' ? '' : ` · ${updated}`}`}</T>
        <T size={12} w={600} color={c.ink2}>{t('wallet.explorer')}</T>
        <Icon name="north_east" size={14} color={c.ink2} />
      </Pressable>
    </View>
  );
}

function Row({ icon, t, d, v }: { icon: IconName; t: string; d: string; v: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={14.5} w={550} numberOfLines={2}>{t}</T>
        <T size={12.5} color={c.ink2}>{d}</T>
      </View>
      <T size={14} w={600} tabular>{v}</T>
    </View>
  );
}
