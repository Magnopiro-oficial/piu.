import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { meshFunds, readingAgeDays } from '../../lib/carryView';
import { formatLunes } from '../../lib/lunesRpc';
import { parseLunesAmount } from '../../lib/paymentRequest';
import { addrGroups } from '../../lib/phoneNodeView';
import { OFFLINE_CONTEXT_MAX_AGE_MS } from '../../lib/walletCarry';
import { WalletTransferError, type WalletQuote } from '../../lib/walletTransfer';
import { useWallet } from '../../state/wallet';
import { MeshSendView, type MeshBlock } from '../../ui/NodeViews';
import { Screen } from '../../ui/Screen';
import { useDestName } from '../../ui/useDestName';

const MAX_DAYS = Math.round(OFFLINE_CONTEXT_MAX_AGE_MS / 86_400_000);

/**
 * N8 "Enviar sem internet" (Piu 11): o Enviar da carteira quando não há rede. A transferência é
 * assinada aqui com a última leitura da rede (`quoteCarriedTransfer`, era imortal) e solta na malha
 * (`carryTransfer`: biometria, assinatura, gravação, carga). Taxa com folga (o dobro da última lida).
 * N8a: sem leitura da rede ou mais velha que 7 dias. N8b: saldo da última leitura não cobre valor + folga.
 * Depois de soltar, abre N9 (em trânsito). Chega da folha Enviar com `dest` e `amount`.
 */
export default function MeshSend() {
  const t = useT();
  const { dest = '', amount = '' } = useLocalSearchParams<{ dest?: string; amount?: string }>();
  const { offlineContext, quoteCarriedTransfer, carryTransfer } = useWallet();
  const name = useDestName(dest);
  const [holdKey, setHoldKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const { quote, block, why } = useMemo((): { quote: WalletQuote | null; block: MeshBlock; why?: string } => {
    if (!offlineContext) return { quote: null, block: { kind: 'noReading', maxDays: MAX_DAYS } };
    if (now - offlineContext.at > OFFLINE_CONTEXT_MAX_AGE_MS) return { quote: null, block: { kind: 'stale', days: readingAgeDays(offlineContext.at, now), maxDays: MAX_DAYS } };
    try { return { quote: quoteCarriedTransfer(dest, amount), block: null }; }
    catch (e) {
      if (e instanceof WalletTransferError && e.code === 'funds') {
        const f = meshFunds({ value: parseLunesAmount(amount) ?? 0n, fee: BigInt(offlineContext.fee), available: BigInt(offlineContext.available) });
        return { quote: null, block: { kind: 'funds', have: formatLunes(f.have), need: formatLunes(f.need) } };
      }
      if (e instanceof WalletTransferError && e.code === 'offline_context') return { quote: null, block: { kind: 'noReading', maxDays: MAX_DAYS } };
      return { quote: null, block: null, why: e instanceof Error ? e.message : t('ownWallet.error') };
    }
  }, [offlineContext, dest, amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = quote ? meshFunds({ value: BigInt(quote.value), fee: BigInt(quote.fee), available: BigInt(quote.available) }) : null;
  const sign = async () => {
    if (!quote) return;
    setError(null);
    try { await carryTransfer(quote); router.replace('/wallet/transit' as Href); }
    catch (e) {
      setError(e instanceof WalletTransferError && e.code === 'cancelled' ? t('ownWallet.cancelled') : e instanceof Error ? e.message : t('ownWallet.error'));
      setHoldKey(k => k + 1);
    }
  };

  return (
    <Screen>
      <MeshSendView
        d={{
          name, address: addrGroups(dest), amount: quote ? formatLunes(BigInt(quote.value)).replace(/,00$/, '') : amount || '0',
          fee: f ? formatLunes(f.fee) : '—', total: f ? formatLunes(f.total) : '—',
          readingDays: offlineContext ? readingAgeDays(offlineContext.at, now) : null, block, holdKey, error: error ?? why ?? null,
        }}
        a={{ sign: () => { void sign(); }, adjust: () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet' as Href)), back: () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet' as Href)) }} />
    </Screen>
  );
}
