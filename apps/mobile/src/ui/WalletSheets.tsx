import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, TextInput, View } from 'react-native';
import type { Chat } from '../data/types';
import { useT } from '../i18n';
import { formatLunes, LUNES_EXPLORER } from '../lib/lunesRpc';
import { blockLabel, whenLabel } from '../lib/walletCore';
import { WalletTransferError, type WalletQuote, type WalletTransferRecord } from '../lib/walletTransfer';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';
import { useWallet } from '../state/wallet';
import { ContactPickerSheet, PayRequestSheet } from './PaymentRequest';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { QrCode } from './QrCode';
import { T } from './T';
import { TransferSheet } from './ownWallet/TransferSheet';

/** Revisar primeiro; a assinatura só acontece no state, após autenticação no cofre nativo. */
export function SendSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { canSign, nativeWalletReady, useOwnWallet, quoteTransfer, sendTransfer, pendingTransfer, transferRecoveryBlocked, refreshTransfer, retryTransfer } = useWallet();
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<WalletQuote | null>(null);
  const [record, setRecord] = useState<WalletTransferRecord | null>(pendingTransfer);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'quoting' | 'sending' | 'refreshing'>('idle');
  const working = useRef(false);
  const busy = phase !== 'idle';
  useEffect(() => { if (pendingTransfer) setRecord(pendingTransfer); }, [pendingTransfer]);
  const active = record && ['signed', 'submitted', 'included'].includes(record.status);
  const edit = () => { if (working.current) return; setQuote(null); setError(null); };
  const run = async (kind: typeof phase, fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setPhase(kind); setError(null); Keyboard.dismiss();
    try { await fn(); }
    catch (e) {
      if (e instanceof WalletTransferError && e.code === 'review_required' && e.quote) {
        setQuote(e.quote); setError(t('ownWallet.reviewChanged'));
      } else if (e instanceof WalletTransferError && e.code === 'cancelled') setError(t('ownWallet.cancelled'));
      else setError(e instanceof Error ? e.message : t('ownWallet.error'));
    } finally { working.current = false; setPhase('idle'); }
  };
  const value = (planck: string) => `${formatLunes(BigInt(planck))} LUNES`;
  const field = { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: c.line2, backgroundColor: c.bg2, paddingHorizontal: 16, paddingVertical: 12, color: c.ink, fontSize: 14, fontFamily: fontFamily(400, true) } as const;
  return (
    <TransferSheet onClose={onClose} label={t('wallet.sendSheet.title')}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.sendSheet.title')}</T>
      {transferRecoveryBlocked && <Pending icon="error" title={t('wallet.sendSheet.title')} body={t('ownWallet.recoveryError')} />}
      {!transferRecoveryBlocked && record && (
        <View accessibilityLiveRegion="polite" style={{ padding: 16, backgroundColor: c.bg2, borderRadius: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name={record.status === 'finalized' ? 'check_circle' : record.status === 'failed' ? 'error' : 'schedule_send'} size={24} />
            <T size={16} w={650} style={{ flex: 1 }}>{t(`ownWallet.status.${record.status}`)}</T>
          </View>
          <AddressLine label={t('ownWallet.from')} address={record.from} />
          <AddressLine label={t('ownWallet.to')} address={record.dest} />
          <T size={18} w={650} tabular>{value(record.value)}</T>
          <AddressLine label={t('ownWallet.hash')} address={record.hash} />
          {active && <T size={13} lh={1.45} color={c.ink2}>{t('ownWallet.pendingNote')}</T>}
          {!!record.error && <T size={13} lh={1.45}>{record.error}</T>}
          <Button label={t('wallet.explorer')} variant="outline" height={46} onPress={() => { void Linking.openURL(record.block ? `${LUNES_EXPLORER}block/${record.block.number}` : LUNES_EXPLORER).catch(() => {}); }} />
          {active && <Button label={t('ownWallet.refresh')} variant="soft" height={46} disabled={busy} onPress={() => { void run('refreshing', refreshTransfer); }} />}
          {record.status === 'signed' && retryTransfer && <Button label={t('ownWallet.retry')} variant="outline" height={46} disabled={busy} onPress={() => { void run('sending', async () => { setRecord(await retryTransfer()); }); }} />}
          {!active && <Button label={t('common.close')} variant="soft" height={46} onPress={onClose} />}
          {!active && <Button label={t('wallet.send')} variant="outline" height={46} onPress={() => { setRecord(null); setQuote(null); setDest(''); setAmount(''); setError(null); }} />}
        </View>
      )}
      {!transferRecoveryBlocked && !active && !record && (!nativeWalletReady ? (
        <Pending icon="key_off" title={t('ownWallet.unavailableTitle')} body={t('ownWallet.unavailableNote')} />
      ) : !canSign ? (
        <>
          <Pending icon="visibility" title={t('ownWallet.watchTitle')} body={t('ownWallet.watchNote')} />
          <Button label={t('ownWallet.useOwn')} onPress={useOwnWallet} />
        </>
      ) : quote ? (
        <>
          <T size={17} w={650}>{t('ownWallet.review')}</T>
          <AddressLine label={t('ownWallet.from')} address={quote.from} />
          <AddressLine label={t('ownWallet.to')} address={quote.dest} />
          <View style={{ backgroundColor: c.bg2, borderRadius: 18, padding: 16, gap: 12 }}>
            {[[t('ownWallet.amount'), quote.value], [t('ownWallet.fee'), quote.fee], [t('ownWallet.total'), quote.total], [t('ownWallet.available'), quote.available]].map(([label, planck]) => (
              <View key={label} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                <T size={13} color={c.ink2}>{label}</T><T size={14} w={600} tabular>{value(planck!)}</T>
              </View>
            ))}
          </View>
          <T size={13} lh={1.45} color={c.ink2}>{t('ownWallet.keepAlive')}</T>
          <Button label={busy ? t('ownWallet.authenticating') : t('ownWallet.authenticate')} disabled={busy || !canSign}
            left={<Icon name="fingerprint" size={20} color={c.invink} />} onPress={() => { void run('sending', async () => { setRecord(await sendTransfer(quote)); setQuote(null); }); }} />
          <Button label={t('ownWallet.edit')} variant="outline" disabled={busy} onPress={edit} />
        </>
      ) : (
        <>
          <T size={13.5} lh={1.45} color={c.ink2}>{t('ownWallet.sendIntro')}</T>
          <T size={13} w={600}>{t('ownWallet.destination')}</T>
          <TextInput value={dest} onChangeText={v => { setDest(v.replace(/\s/g, '')); setError(null); }} editable={!busy}
            placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3} accessibilityLabel={t('ownWallet.destination')}
            autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60} style={field} />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <TextInput value={amount} onChangeText={v => { setAmount(v); setError(null); }} editable={!busy} accessibilityLabel={t('ownWallet.amount')}
              placeholder="0" placeholderTextColor={c.ink3} keyboardType="decimal-pad" autoCorrect={false} maxLength={28}
              style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: 56, fontFamily: fontFamily(650), color: c.ink, letterSpacing: -3, minHeight: 74 }} />
            <T size={14} w={600} color={c.ink2}>LUNES</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {['1', '5', '10'].map(n => <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} LUNES`} disabled={busy} onPress={() => { setAmount(n); setError(null); }} style={{ minHeight: 36, paddingHorizontal: 18, borderRadius: 18, backgroundColor: c.bg2, justifyContent: 'center' }}><T size={13.5} w={550}>{n}</T></Pressable>)}
          </View>
          <Button label={phase === 'quoting' ? t('ownWallet.estimating') : t('ownWallet.estimate')} disabled={busy || !dest || !amount.trim()}
            onPress={() => { void run('quoting', async () => { setQuote(await quoteTransfer(dest, amount)); }); }} />
        </>
      ))}
      {!!error && <T size={13} lh={1.45} accessibilityLiveRegion="polite">{error}</T>}
    </TransferSheet>
  );
}

function AddressLine({ label, address }: { label: string; address: string }) {
  const { c } = useTheme();
  return <View style={{ gap: 5 }}><T size={12.5} color={c.ink2}>{label}</T><T size={12.5} lh={1.5} mono selectable>{address}</T></View>;
}

/** Endereço próprio do cofre nativo ou endereço externo escolhido explicitamente para consulta. */
export function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { showToast, chats } = useStore();
  const { payments } = useMessaging();
  const { lunesAddress, ownAddress, canSign, nativeWalletReady, useOwnWallet, setLunesAddress, onchainSnap, refreshOnchain } = useWallet();
  const address = lunesAddress ?? (nativeWalletReady ? ownAddress : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lunesAddress ?? '');
  const [err, setErr] = useState<string | null>(null);
  // "Pedir a um contato" (regra 7.3): escolhe a conversa, monta o pedido e abre a conversa com o balão.
  const [ask, setAsk] = useState<'pick' | Chat | null>(null);
  const snap = onchainSnap && onchainSnap.address === address ? onchainSnap : null;
  const sendAsk = (chat: Chat, input: { amount: string; desc: string }) => {
    try {
      payments.send(chat.id, input);
      onClose();
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch (e) { showToast({ icon: 'error', title: t('wallet.ask.fail'), body: e instanceof Error ? e.message : t('common.tryAgain') }); }
  };

  const save = () => {
    const e = setLunesAddress(draft);
    setErr(e);
    if (e) return;
    setEditing(false);
    showToast({ icon: 'check_circle', title: t('wallet.addressSaved'), body: t('wallet.addressSaved.body') });
    // O estado do endereço muda no próximo render; a carteira lê de novo quando o endereço muda.
  };
  const copy = () => {
    if (!address) return;
    void Clipboard.setStringAsync(address).then(() => showToast({ icon: 'content_copy', title: t('wallet.addressCopied'), body: address })).catch(() => {});
  };

  return (
    <TransferSheet onClose={onClose} label={t('wallet.receiveSheet.title')}>
      <T size={22} w={700} ls={-0.03} accessibilityRole="header">{t('wallet.receiveSheet.title')}</T>
      <Pending icon={canSign ? 'account_balance_wallet' : 'visibility'} title={t(canSign ? 'ownWallet.title' : address ? 'ownWallet.watchTitle' : 'ownWallet.unavailableTitle')}
        body={t(canSign ? 'ownWallet.nativeNote' : address ? 'ownWallet.watchNote' : 'ownWallet.unavailableNote')} />
      {address && !nativeWalletReady && <T size={12.5} lh={1.45} color={c.ink2}>{t('ownWallet.unavailableNote')}</T>}
      {!canSign && nativeWalletReady && ownAddress && <Button label={t('ownWallet.useOwn')} onPress={() => { useOwnWallet(); setEditing(false); setErr(null); }} />}
      {editing || !address ? (
        <>
          <T size={13.5} lh={1.45} color={c.ink2}>{t('ownWallet.watchPaste')}</T>
          <View style={{ gap: 6 }}>
            <TextInput value={draft} onChangeText={v => { setDraft(v.replace(/\s/g, '')); setErr(null); }} placeholder={t('wallet.receiveSheet.placeholder')} placeholderTextColor={c.ink3}
              accessibilityLabel={t('wallet.receiveSheet.input.a11y')} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={60}
              style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: err ? c.ink : c.line2, color: c.ink, fontSize: 14, fontFamily: fontFamily(400, true) }} />
            {err && <T size={12.5} lh={1.4} color={c.ink} accessibilityLiveRegion="polite">{err}</T>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {address && <Button label={t('common.cancel')} variant="outline" height={48} style={{ flex: 1 }} onPress={() => { setEditing(false); setDraft(address); setErr(null); }} />}
            <Button label={t('wallet.receiveSheet.save')} height={48} style={{ flex: 1 }} disabled={!draft} onPress={save} />
          </View>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <QrCode value={address} size={208} label={t('wallet.receiveSheet.qr')} />
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.bg2 }}>
              <T size={13} w={500} mono lh={1.45} selectable style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>{address}</T>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.copy')} accessibilityValue={{ text: address }} onPress={copy}
                style={({ pressed }) => ({ width: 44, height: 44, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.bg3 : 'transparent' })}>
                <Icon name="content_copy" size={18} />
              </Pressable>
            </View>
          </View>
          {snap && (
            <T size={12.5} lh={1.4} color={c.ink2} align="center">{`${formatLunes(BigInt(snap.free))} LUNES · ${t('wallet.block')} ${blockLabel(snap.block)} · ${whenLabel(snap.at, Date.now())}`}</T>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t('common.copy')} height={48} style={{ flex: 1 }} onPress={copy} left={<Icon name="content_copy" size={18} color={c.invink} />} />
            <Button label={t('wallet.explorer')} variant="outline" height={48} style={{ flex: 1 }} onPress={() => { void Linking.openURL(LUNES_EXPLORER).catch(() => {}); }} left={<Icon name="public" size={18} />} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t(canSign ? 'ownWallet.watchAnother' : 'wallet.receiveSheet.change')} variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setDraft(canSign ? '' : address); setEditing(true); }} />
            {!canSign && <Button label={t('common.remove')} variant="ghost" height={44} fontSize={14} style={{ flex: 1 }} onPress={() => { setLunesAddress(null); setDraft(''); setEditing(!nativeWalletReady); }} />}
          </View>
          <Button label={t('wallet.receiveSheet.readNow')} variant="soft" height={44} fontSize={14} onPress={() => { void refreshOnchain(); }} />
          <Button label={t('wallet.receiveSheet.askContact')} variant="outline" height={48} onPress={() => setAsk('pick')} left={<Icon name="account_balance_wallet" size={18} />} />
        </>
      )}
      <T size={12.5} lh={1.4} color={c.ink2}>{t('wallet.receiveSheet.note')}</T>
      {ask === 'pick' && <ContactPickerSheet chats={chats} onClose={() => setAsk(null)} onPick={ch => setAsk(ch)} />}
      {ask && ask !== 'pick' && <PayRequestSheet address={address} toName={ask.name} onClose={() => setAsk(null)} onSend={input => sendAsk(ask, input)} />}
    </TransferSheet>
  );
}

function Pending({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
      <Icon name={icon} size={24} w={300} />
      <View style={{ flex: 1, gap: 3 }}>
        <T size={15} w={600}>{title}</T>
        <T size={13} lh={1.45} color={c.ink2}>{body}</T>
      </View>
    </View>
  );
}
