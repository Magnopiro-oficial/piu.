import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { desktopPaymentActive, desktopPaymentStatus, finishDesktopPayment, startDesktopPayment, useDesktopLink } from '../lib/desktopLinkSession';
import type { DesktopPaymentRequest } from '../lib/desktopPayment';
import { formatLunes } from '../lib/lunesRpc';
import { canSignWalletAddress } from '../lib/walletSelection';
import { WalletTransferError, type WalletQuote, type WalletTransferRecord } from '../lib/walletTransfer';
import { useWallet } from '../state/wallet';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { T } from './T';
import { TransferSheet } from './ownWallet/TransferSheet';

export function DesktopPayment() {
  const { payment } = useDesktopLink();
  return payment ? <PaymentReview key={`${payment.token}:${payment.id}`} payment={payment} /> : null;
}

function PaymentReview({ payment }: { payment: DesktopPaymentRequest }) {
  const t = useT(), { c } = useTheme();
  const wallet = useWallet();
  const latest = useRef(wallet); latest.current = wallet;
  const [quote, setQuote] = useState<WalletQuote | null>(null);
  const [record, setRecord] = useState<WalletTransferRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(true);
  const [fatal, setFatal] = useState(false);
  const [hidden, setHidden] = useState(false);
  const workingRef = useRef(false);
  const safe = () => desktopPaymentActive(payment) && latest.current.canSign && latest.current.canSignAddress(payment.expectedFrom) && canSignWalletAddress(payment.expectedFrom, latest.current.lunesAddress);
  useEffect(() => {
    let live = true;
    const prepare = async () => {
      try {
        if (!safe()) throw new Error(t('ownWallet.watchOnly'));
        const q = await latest.current.quoteTransfer(payment.dest, payment.amount);
        if (!safe() || !canSignWalletAddress(q.from, payment.expectedFrom) || !canSignWalletAddress(q.dest, payment.dest)) throw new Error(t('ownWallet.accountChanged'));
        if (live) setQuote(q);
      } catch (e) {
        const message = e instanceof Error ? e.message : t('ownWallet.error');
        desktopPaymentStatus(payment, 'error', undefined, message);
        if (live) { setError(message); setFatal(true); }
      } finally { if (live) setWorking(false); }
    };
    void prepare(); return () => { live = false; };
  }, []); // request is immutable and the component is keyed per request
  useEffect(() => {
    if (!record) return;
    const current = wallet.pendingTransfer;
    if (current?.hash === record.hash && (current.status !== record.status || current.error !== record.error)) setRecord(current);
  }, [wallet.pendingTransfer, record]);
  useEffect(() => {
    if (!record) return;
    desktopPaymentStatus(payment, record.status, record.hash, record.error);
    if (record.status === 'finalized' || record.status === 'failed') {
      if (hidden) finishDesktopPayment(payment);
      return;
    }
    const timer = setInterval(() => { void latest.current.refreshTransfer().catch(e => desktopPaymentStatus(payment, 'error', record.hash, e instanceof Error ? e.message : t('ownWallet.error'))); }, 10_000);
    return () => clearInterval(timer);
  }, [record, hidden]);
  const close = () => {
    if (workingRef.current) return;
    if (record && record.status !== 'finalized' && record.status !== 'failed') { setHidden(true); return; }
    if (!record && !fatal) desktopPaymentStatus(payment, 'cancelled');
    finishDesktopPayment(payment);
  };
  const send = async () => {
    if (!quote || workingRef.current || !safe() || !startDesktopPayment(payment)) return;
    workingRef.current = true; setWorking(true); setError(null);
    try {
      const result = await latest.current.sendTransfer(quote, safe);
      setRecord(result);
    } catch (e) {
      if (e instanceof WalletTransferError && e.code === 'review_required' && e.quote && safe()) {
        setQuote(e.quote); setError(t('ownWallet.reviewChanged')); desktopPaymentStatus(payment, 'review');
      } else if (e instanceof WalletTransferError && e.code === 'cancelled') {
        desktopPaymentStatus(payment, 'cancelled'); finishDesktopPayment(payment);
      } else {
        const message = e instanceof Error ? e.message : t('ownWallet.error');
        desktopPaymentStatus(payment, 'error', undefined, message); setError(message); setFatal(true);
      }
    } finally { workingRef.current = false; setWorking(false); }
  };
  if (hidden) return null;
  const value = (n: string) => `${formatLunes(BigInt(n))} LUNES`;
  return <TransferSheet onClose={close} label={t('wallet.sendSheet.title')}>
    <T size={22} w={700}>Piu Desktop · {t('wallet.sendSheet.title')}</T>
    {record ? <>
      <T size={16} w={650}>{t(`ownWallet.status.${record.status}`)}</T>
      <T size={13}>{record.hash}</T>
      {record.error && <T size={13}>{record.error}</T>}
      <Button label={t('common.close')} variant="soft" onPress={close} />
    </> : <>
      <T size={17} w={650}>{t('ownWallet.review')}</T>
      <T size={13} color={c.ink2}>{t('ownWallet.from')}</T><T size={13} selectable>{payment.expectedFrom}</T>
      <T size={13} color={c.ink2}>{t('ownWallet.to')}</T><T size={13} selectable>{payment.dest}</T>
      {quote && <View style={{ backgroundColor: c.bg2, borderRadius: 18, padding: 16, gap: 12 }}>
        {[[t('ownWallet.amount'), quote.value], [t('ownWallet.fee'), quote.fee], [t('ownWallet.total'), quote.total]].map(([label, n]) => <View key={label} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><T size={13}>{label}</T><T size={14} w={600}>{value(n!)}</T></View>)}
      </View>}
      {!!error && <T size={13}>{error}</T>}
      <Button label={working ? t('ownWallet.authenticating') : t('ownWallet.authenticate')} disabled={working || !quote || fatal} onPress={() => { void send(); }} />
      <Button label={t('common.cancel')} variant="outline" disabled={workingRef.current} onPress={close} />
    </>}
  </TransferSheet>;
}
