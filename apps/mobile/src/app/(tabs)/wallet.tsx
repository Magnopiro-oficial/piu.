import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { REFERRAL_REWARD, WELCOME_BONUS } from '../../data/wallet';
import { CREDIT_PARAMS } from '../../messaging/credits';
import { fmtDate, fmtNumber, useT, type Key } from '../../i18n';
import { balanceEye, maskAmount, maskBalance } from '../../lib/balanceMask';
import { explorerAccountUrl, fromHistorySnapshot, indexerAccountId, moveRow, type HistorySnapshot } from '../../lib/lunesHistory';
import { formatLunes, planckToLunes } from '../../lib/lunesRpc';
import { shareTextFile } from '../../lib/shareFile';
import { activityRows, balanceCardLine, bonusSteps, dayLabel, lunes2, onchainView, referralStats, walletSummary, whenLabel, type OnchainStatus } from '../../lib/walletCore';
import { ACTION_POP, CARD_IN, COUNT, ROW_FRESH, ROW_UP, SHINE, SPIN, actionDelay, countFrame, rowDelay } from '../../lib/walletMotion';
import { lunesUri, transferRow, type TransferRow } from '../../lib/walletSend';
import type { WalletTransferRecord } from '../../lib/walletTransfer';
import { alpha, at, popStyle, range, seg, upStyle, useClock } from '../../ui/motion';
import { shortAddress } from '../../ui/PayScene';
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
import { TransitActivityRow } from '../../ui/NodeViews';
import { useDestName } from '../../ui/useDestName';
import { transitPill, wholeLunes } from '../../lib/carryView';
import { addrGroups } from '../../lib/phoneNodeView';

const NO_TOTALS = { pendente: 0, validado: 0, em_lote: 0, rejeitado: 0, pago: 0 };
const STATE_LABEL: Record<string, Key> = { pendente: 'wallet.state.pendente', validado: 'wallet.state.validado', em_lote: 'wallet.state.em_lote', rejeitado: 'wallet.state.rejeitado', pago: 'wallet.state.pago' };

/** Carteira: Saldo (enviar, receber, convidar, bônus, distribuição, atividade) e Créditos de rede. */
export default function WalletTab() {
  const { c } = useTheme();
  const t = useT();
  const [tab, setTab] = useState<'wallet' | 'rewards'>('wallet');
  const [sheet, setSheet] = useState<'send' | 'receive' | null>(null);
  // `/(tabs)/wallet?send=<chatId>`: vindo de uma conversa, abre Enviar com aquele contato já selecionado.
  const params = useLocalSearchParams<{ send?: string }>();
  const [sendTo, setSendTo] = useState<string | undefined>(undefined);
  useEffect(() => { if (params.send) { setSendTo(params.send); setSheet('send'); router.setParams({ send: undefined }); } }, [params.send]);
  // `seq` reinicia a entrada animada (cartão, contagem do saldo, botões, linhas) toda vez que a aba aparece.
  const [seq, setSeq] = useState(0);
  // Transferência que acabou de sair pela cena de pagamento (hash + leitura da Mainnet naquele momento):
  // o saldo desce ao valor esperado e a linha nova entra destacada, até a Mainnet devolver uma leitura diferente.
  const [fresh, setFresh] = useState<FreshSend | null>(null);
  const { lunesAddress, onchainSnap, onchainStatus, refreshOnchain, historyStatus, refreshHistory } = useWallet();
  const view = onchainView({ address: lunesAddress, snap: onchainSnap, status: onchainStatus, now: Date.now() });
  // Lê o saldo (nó da Mainnet) e o histórico (indexador) ao abrir a carteira e de novo quando o endereço muda.
  const refreshAll = useCallback(() => { void refreshOnchain(); void refreshHistory(); }, [refreshOnchain, refreshHistory]);
  useFocusEffect(useCallback(() => { refreshAll(); setSeq(s => s + 1); }, [refreshAll]));
  const refreshing = onchainStatus.state === 'loading' || historyStatus.state === 'loading';
  const onSent = (record: WalletTransferRecord) => { setFresh({ hash: record.hash, free: onchainSnap?.free ?? null }); refreshAll(); };

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
          <Segmented size="lg" label={t('tabs.wallet')} value={tab} onChange={setTab} options={[['wallet', t('wallet.tab.balance')], ['rewards', t('wallet.tab.credits')]]} />
        </View>
        {tab === 'wallet' ? <Balance onSheet={setSheet} seq={seq} fresh={fresh} /> : <Rewards />}
      </ScrollView>
      {sheet === 'send' && <SendSheet onClose={() => { setSheet(null); setSendTo(undefined); }} onSent={onSent} toChatId={sendTo} />}
      {sheet === 'receive' && <ReceiveSheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}

/** Duração da coreografia de entrada (o brilho termina em 2,05 s). */
const ENTRY_TOTAL = 2100;
/** Envio recém-concluído pela cena: hash do registro e `free` da última leitura da Mainnet antes dele. */
interface FreshSend { hash: string; free: string | null }

function Balance({ onSheet, seq, fresh: sent }: { onSheet: (s: 'send' | 'receive') => void; seq: number; fresh: FreshSend | null }) {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
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

  // Entrada da carteira (design): cartão `piuCardIn`, anéis, brilho, botões `piuPop` escalonados, linhas `piuUp`.
  const clock = useClock(ENTRY_TOTAL, seq);
  const cardW = width - 40, shineW = cardW * 0.34;
  const cardIn = {
    opacity: seg(clock, CARD_IN.delay, CARD_IN.dur, 0, 1, CARD_IN.bezier),
    transform: [
      { perspective: 900 },
      { translateY: seg(clock, CARD_IN.delay, CARD_IN.dur, CARD_IN.dy, 0, CARD_IN.bezier) },
      { rotateX: seg(clock, CARD_IN.delay, CARD_IN.dur, CARD_IN.rotateX, 0, CARD_IN.bezier).interpolate({ inputRange: [0, CARD_IN.rotateX], outputRange: ['0deg', `${CARD_IN.rotateX}deg`] }) },
      { scale: seg(clock, CARD_IN.delay, CARD_IN.dur, CARD_IN.scale, 1, CARD_IN.bezier) },
    ],
  };
  const shine = { transform: [{ translateX: seg(clock, SHINE.delay, SHINE.dur, -1.4 * shineW, 3.8 * shineW, SHINE.bezier) }, { skewX: '-18deg' }] };
  const spin = useSpin(reduceMotion);

  // Saldo conta de 0 ao valor ao entrar (950 ms). Logo depois de um envio pela cena, desce ao valor esperado
  // (saldo − valor − taxa) em 1,3 s enquanto a Mainnet ainda devolve o mesmo `free` de antes do envio;
  // assim que a leitura muda (o débito entrou), vale só a leitura real.
  const fresh = !!sent && pendingTransfer?.hash === sent.hash && !!pendingTransfer && pendingTransfer.status !== 'failed';
  const awaitingChain = fresh && !!snap && snap.free === sent.free && pendingTransfer.status !== 'finalized';
  const expected = awaitingChain ? Math.max(0, sum.available - planckToLunes(BigInt(pendingTransfer.value) + BigInt(pendingTransfer.fee))) : sum.available;
  const shown = useBalanceCount(view.has ? expected : null, seq);
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
      <Animated.View style={[{ marginTop: 14, marginHorizontal: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, borderRadius: 28, backgroundColor: c.ink, gap: 18, overflow: 'hidden' }, cardIn]}>
        {/* Anéis decorativos no canto (o maior gira em 22 s com um ponto orbitando) e brilho que atravessa uma vez. */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', right: -84, top: -96, width: 250, height: 250, borderRadius: 125, borderWidth: 1, borderColor: alpha(c.invink, 0.16), transform: [{ rotate: spin }] }}>
          <View style={{ position: 'absolute', left: 125 - 4, bottom: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: c.invink, opacity: 0.55 }} />
        </Animated.View>
        <View pointerEvents="none" style={{ position: 'absolute', right: -30, top: -42, width: 142, height: 142, borderRadius: 71, borderWidth: 1, borderColor: alpha(c.invink, 0.12) }} />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: shineW }, shine]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="piuShine" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={c.invink} stopOpacity={0} />
                <Stop offset="0.5" stopColor={c.invink} stopOpacity={0.13} />
                <Stop offset="1" stopColor={c.invink} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#piuShine)" />
          </Svg>
        </Animated.View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <T size={13} color={c.invink} style={{ opacity: 0.7 }}>{t('wallet.available')}</T>
            <Pressable onPress={() => setHideBalance(!hideBalance)} accessibilityRole="button" accessibilityLabel={eye.label} accessibilityState={{ selected: hideBalance }} hitSlop={8}
              style={({ pressed }) => ({ width: 36, height: 36, marginVertical: -8, marginRight: -8, borderRadius: 18, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
              <Icon name={eye.icon} size={21} w={300} color={c.invink} style={{ opacity: 0.8 }} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            {/* Sem leitura da Mainnet (sem endereço, ou nunca lido): traço, não um zero que pareça saldo. */}
            <T size={54} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 56 }} accessibilityLiveRegion="polite" accessibilityLabel={maskBalance(view.has ? lunes2(sum.available) : '—', hideBalance)}>{maskBalance(shown === null ? '—' : lunes2(shown), hideBalance)}</T>
            <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>LUNES</T>
          </View>
          {/* Uma linha só, como "+ 60,00 a liberar · bônus em validação" no design: créditos a liberar; sem leitura recente, o estado da Mainnet. */}
          <T size={13} lh={1.4} color={c.invink} style={{ opacity: view.stale ? 0.9 : 0.75 }}>{balanceCardLine(view, t('wallet.toRelease', { amount: maskAmount(lunes2(sum.toRelease), hideBalance) }))}</T>
          {snap && sum.reserved > 0 && <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.75 }}>{t('wallet.reservedLine', { free: maskAmount(formatLunes(BigInt(snap.free)), hideBalance), reserved: maskAmount(lunes2(sum.reserved), hideBalance) })}</T>}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {actions.map(([icon, label, go], i) => (
            <Animated.View key={label} style={[{ flex: 1 }, popStyle(clock, actionDelay(i), ACTION_POP.dur, ACTION_POP.bezier)]}>
              {/* Design: só o círculo encolhe (`:active scale(.88)`), o rótulo fica. */}
              <Pressable onPress={go} accessibilityRole="button" accessibilityLabel={label} style={{ alignItems: 'center', gap: 7 }}>
                {({ pressed }) => (
                  <>
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.88 : 1 }] }}><Icon name={icon} size={24} color={c.ink} /></View>
                    <T size={12.5} w={550} color={c.invink}>{label}</T>
                  </>
                )}
              </Pressable>
            </Animated.View>
          ))}
        </View>
        {lunesAddress ? (
          // Rodapé do design: `lunes:3P8xK2…Q7nM` em mono 12 + copiar, linha toda a 80 %. O explorador fica no fim da atividade.
          <Pressable onPress={copy} accessibilityRole="button" accessibilityLabel={t('wallet.copyAddress.a11y', { address: lunesAddress })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)', opacity: pressed ? 0.6 : 0.8 })}>
            <T size={12} mono color={c.invink} numberOfLines={1} style={{ flex: 1 }}>{lunesUri(shortAddress(lunesAddress))}</T>
            <Icon name="content_copy" size={16} color={c.invink} />
          </Pressable>
        ) : (
          <Pressable onPress={() => onSheet('receive')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)', opacity: 0.85 }}>
            <Icon name="key" size={16} color={c.invink} />
            <T size={12} lh={1.4} color={c.invink} style={{ flex: 1 }}>{t('wallet.needAddress')}</T>
            <Icon name="chevron_right" size={16} color={c.invink} />
          </Pressable>
        )}
      </Animated.View>

      {/* Estado da carteira só quando há algo a decidir: endereço externo em consulta ou cofre indisponível (design: nada entre o segmentado e o cartão). */}
      {/* Fora do design, só quando há algo a decidir: endereço externo em consulta ou cofre indisponível. Discreto, no
          estilo das notas tracejadas do app (como "Pagamento dos lotes pendente"), com a ação como texto. */}
      {!canSign && (
        <View style={{ marginTop: 12, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="visibility" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>{t(lunesAddress ? 'ownWallet.watchTitle' : 'ownWallet.unavailableTitle')}</T>
            <T size={12.5} lh={1.35} color={c.ink2}>{t(lunesAddress ? 'ownWallet.watchNote' : 'ownWallet.unavailableNote')}</T>
            {nativeWalletReady && (
              <Pressable onPress={useOwnWallet} accessibilityRole="button" hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
                <T size={13} w={600}>{t('ownWallet.useOwn')}</T>
                <Icon name="chevron_right" size={16} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={{ marginTop: 12, marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="redeem" size={22} w={300} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15.5} w={600}>{t('wallet.bonus')}</T>
            <T size={12.5} lh={1.35} color={c.ink2}>{t('wallet.bonus.desc')}</T>
          </View>
          <T size={16} w={650} tabular>{lunes2(WELCOME_BONUS)}</T>
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
      <LunesActivity address={lunesAddress} snap={historySnap} status={historyStatus} hidden={hideBalance} now={now} clock={clock} onRetry={() => { void refreshHistory(); }} onNeedAddress={() => onSheet('receive')}
        pending={pendingTransfer} fresh={fresh ? sent.hash : null} onPending={() => onSheet('send')} />
      {/* Registros só deste aparelho (créditos de rede, convites pagos): não são movimentações da Mainnet. */}
      {activity.length > 0 && (
        <>
          <SectionLabel>{t('wallet.localRecords')}</SectionLabel>
          <View style={{ marginHorizontal: 20 }}>
            {activity.map((r, i) => <Row key={`${r.title}-${i}`} icon={r.icon} t={r.title} d={`${dayLabel(r.at, now)} · ${r.status}`} v={maskAmount(r.value, hideBalance)} anim={rowUp(clock, i)} />)}
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
function CarriedRow({ record, hidden }: { record: WalletTransferRecord; hidden: boolean }) {
  const name = useDestName(record.dest);
  return <TransitActivityRow first name={name ?? addrGroups(record.dest)} amount={maskAmount(wholeLunes(record.value), hidden)} pill={transitPill(record)}
    atMs={record.status === 'finalized' ? record.updatedAt : null} onPress={() => router.push('/wallet/transit')} />;
}

function LunesActivity({ address, snap, status, hidden, now, clock, onRetry, onNeedAddress, pending, fresh, onPending }: {
  address: string | null; snap: HistorySnapshot | null; status: OnchainStatus; hidden: boolean; now: number; clock: Animated.Value;
  onRetry: () => void; onNeedAddress: () => void;
  /** Transferência deste aparelho em acompanhamento e, se acabou de sair pela cena, o hash dela (linha destacada). */
  pending: WalletTransferRecord | null; fresh: string | null; onPending: () => void;
}) {
  const { c } = useTheme();
  const t = useT();
  const history0 = address && snap && snap.address === address ? fromHistorySnapshot(snap) : null;
  const tr = pending ? transferRow(pending, history0?.moves ?? []) : null;
  // Design: a linha nova entra no topo da atividade (`piuRowFresh`) depois de Concluir; tocar abre a transferência.
  // Levada pela malha (Piu 11 N9a): a linha mostra o que um gateway informou como não conferido e abre N9.
  const top = pending?.carried ? <CarriedRow record={pending} hidden={hidden} />
    : tr && pending ? <PendingRow key={fresh === pending.hash ? pending.hash : 'static'} row={tr} hidden={hidden} fresh={fresh === pending.hash} onPress={onPending} /> : null;
  const note = (text: string, o: { onPress?: () => void; icon?: IconName; label?: string } = {}) => (
    <Pressable onPress={o.onPress} disabled={!o.onPress} accessibilityRole={o.onPress ? 'button' : undefined} accessibilityLabel={o.label}
      style={{ marginHorizontal: 20, paddingVertical: 12, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {o.icon && <Icon name={o.icon} size={18} color={c.ink2} />}
      <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{text}</T>
      {o.onPress && <Icon name="chevron_right" size={16} color={c.ink2} />}
    </Pressable>
  );
  if (!address) return note(t('wallet.moves.needAddress'), { onPress: onNeedAddress, icon: 'key' });
  const history = history0;
  if (!history) {
    if (status.state === 'error') return <>{top && <View style={{ marginHorizontal: 20 }}>{top}</View>}{note(t('wallet.moves.error', { error: status.error }), { onPress: onRetry, icon: 'cloud_off', label: t('wallet.moves.retry.a11y') })}</>;
    return <>{top && <View style={{ marginHorizontal: 20 }}>{top}</View>}{note(t('wallet.moves.loading'), { icon: 'cloud' })}</>;
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => {}); };
  const all = explorerAccountUrl(indexerAccountId(address));
  const updated = status.state === 'loading' ? t('wallet.moves.updating') : t('wallet.moves.updated', { when: whenLabel(history.at, now) });
  return (
    <View style={{ marginHorizontal: 20 }}>
      {top}
      {history.moves.length === 0 && !top && <T size={13} lh={1.45} color={c.ink2} style={{ paddingVertical: 12, paddingHorizontal: 4 }}>{t('wallet.moves.empty')}</T>}
      {history.moves.map((m, i) => {
        const r = moveRow(m, now, hidden);
        return (
          <Pressable key={m.id} onPress={() => open(r.url)} accessibilityRole="link" accessibilityLabel={`${r.title}, ${r.value} LUNES, ${r.detail}. ${t('wallet.moves.openExplorer')}`}>
            <Row icon={r.icon} t={r.title} d={r.detail} v={r.value} anim={rowUp(clock, i)} />
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

/** `piuUp .45s` da i-ésima linha de atividade (atraso .3s + 45 ms, no máximo 8 degraus). */
const rowUp = (clock: Animated.Value, i: number) => upStyle(clock, rowDelay(i), ROW_UP.dur, ROW_UP.bezier, ROW_UP.dy);

function Row({ icon, t, d, v, anim }: { icon: IconName; t: string; d: string; v: string; anim?: ReturnType<typeof rowUp> }) {
  const { c } = useTheme();
  return (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line, borderRadius: 12 }, anim]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={14.5} w={550} numberOfLines={1}>{t}</T>
        <T size={12.5} color={c.ink2}>{d}</T>
      </View>
      <T size={14} w={600} tabular>{v}</T>
    </Animated.View>
  );
}

/** Anel decorativo do cartão: `piuSpin 22s linear infinite` (parado com "reduzir movimento"). */
function useSpin(reduceMotion: boolean) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { v.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: SPIN, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, reduceMotion]);
  return v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
}

/**
 * Saldo mostrado: conta de 0 ao valor em 950 ms ao entrar (`seq` novo) e, quando o alvo muda com a aba
 * aberta (ex.: depois de um envio), vai do valor atual ao novo em 1,3 s. Easing `1 − (1 − p)^4` (rAF).
 * `null` = sem leitura (traço). Com "reduzir movimento", mostra o alvo direto.
 */
function useBalanceCount(target: number | null, seq: number): number | null {
  const { reduceMotion } = useTheme();
  const [shown, setShown] = useState<number | null>(target === null ? null : 0);
  const current = useRef<number | null>(target === null ? null : 0);
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (target === null) { current.current = null; setShown(null); return; }
    const entering = lastSeq.current !== seq || current.current === null;
    lastSeq.current = seq;
    if (reduceMotion) { current.current = target; setShown(target); return; }
    const from = entering ? 0 : current.current!;
    const dur = entering ? COUNT.enter : COUNT.settle;
    if (from === target) { current.current = target; setShown(target); return; }
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const f = countFrame(from, target, Date.now() - t0, dur);
      current.current = f.value; setShown(f.value);
      if (!f.done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, seq, reduceMotion]);
  return shown;
}

/**
 * Linha da transferência deste aparelho no topo da atividade. Logo depois de Concluir: `piuRowFresh 1.8s .35s`
 * (desce 14 px com fade até 22 %; destaque `ink` 10 % some até o fim), como a linha nova do design.
 */
function PendingRow({ row, hidden, fresh, onPress }: { row: TransferRow; hidden: boolean; fresh: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const clock = useClock(ROW_FRESH.delay + ROW_FRESH.dur, 0);
  const value = maskAmount(row.value, hidden);
  const settle = ROW_FRESH.dur * ROW_FRESH.settleAt;
  const style = fresh ? {
    opacity: seg(clock, ROW_FRESH.delay, settle, 0, 1, ROW_FRESH.bezier),
    transform: [{ translateY: seg(clock, ROW_FRESH.delay, settle, ROW_FRESH.dy, 0, ROW_FRESH.bezier) }],
  } : undefined;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={`${row.title}, ${value} LUNES, ${row.detail}. ${t('ownWallet.openTransfer')}`}>
      <Animated.View style={[{ borderRadius: 12, overflow: 'hidden' }, style]}>
        <Row icon={row.icon} t={row.title} d={row.detail} v={value} />
        {fresh && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(c.ink, 0.1), opacity: at(clock, range(ROW_FRESH.delay, ROW_FRESH.dur, 1, 0, ROW_FRESH.bezier)) }} />}
      </Animated.View>
    </Pressable>
  );
}
