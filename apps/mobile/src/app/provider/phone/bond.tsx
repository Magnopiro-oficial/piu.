import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { formatLunes } from '../../../lib/lunesRpc';
import { addrGroups, bondFailOf, bondSheetOf, nodeParamsOf } from '../../../lib/phoneNodeView';
import type { WalletQuote } from '../../../lib/walletTransfer';
import { usePhoneNode } from '../../../state/phoneNode';
import { BondSheetView, type BondError } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';
import { ReceiveSheet } from '../../../ui/WalletSheets';

type Quote = { quote: WalletQuote; affordable: { ok: boolean; needed: bigint; available: bigint; missing: bigint } };

/**
 * N3 "Pagar caução" (Piu 11): folha igual à de Enviar da carteira por cima do painel; segurar 0,9 s
 * assina a transferência (`payBond` → biometria do `sendTransfer`); soltar antes cancela. Os estados
 * N3a–e (em breve, sem carteira, já enviada, já registrada, modo nó desligado) entram no lugar da folha;
 * os erros N3f–h (saldo, biometria cancelada, carteira ocupada) aparecem nela depois de segurar.
 * Valor e taxa sempre da cotação real (`quoteBond`): nada fixo.
 */
export default function PhoneBond() {
  const pn = usePhoneNode();
  const fail = usePnFail();
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState<BondError | null>(null);
  const [holdKey, setHoldKey] = useState(0);
  const [seq, setSeq] = useState(0);
  const [receive, setReceive] = useState(false);
  const sheet = bondSheetOf(pn.bond.block);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/provider/phone' as Href));

  const short = (r: Quote): BondError => ({ kind: 'insufficient', missing: formatLunes(r.affordable.missing), have: formatLunes(r.affordable.available), need: formatLunes(r.affordable.needed) });
  useEffect(() => {
    if (sheet !== 'sheet') return;
    let live = true;
    pn.quoteBond().then(r => { if (live) { setQ(r); setError(r.affordable.ok ? null : short(r)); } })
      .catch(() => { if (live) setError({ kind: 'quote' }); });
    return () => { live = false; };
  }, [sheet, seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const sign = async () => {
    try {
      await pn.payBond({ quote: q?.quote });
      router.replace('/provider/phone' as Href); // o painel mostra "Caução enviada"
    } catch (e) {
      const k = bondFailOf(e);
      if (k === 'insufficient') setError(q ? short(q) : { kind: 'quote' });
      else if (k === 'cancelled') setError({ kind: 'cancelled' });
      else if (k === 'busy') setError({ kind: 'busy' });
      else if (k === 'soon') setSeq(n => n + 1);
      else fail(e);
      setHoldKey(n => n + 1);
    }
  };

  return (
    <Screen>
      <BondSheetView
        d={{
          params: nodeParamsOf(pn.params), sheet, error, holdKey,
          registeredSinceMs: pn.state.registeredAt ? pn.state.registeredAt * 1000 : null,
          quote: q ? {
            to: addrGroups(pn.bond.address), fee: formatLunes(BigInt(q.quote.fee)), total: formatLunes(q.affordable.needed),
            after: formatLunes(q.affordable.available > q.affordable.needed ? q.affordable.available - q.affordable.needed : 0n),
          } : null,
        }}
        a={{
          close, sign: () => { void sign(); },
          createWallet: () => router.push('/wallet' as Href),
          activate: () => router.replace('/provider/connect?mode=phone' as Href),
          receive: () => setReceive(true),
          retry: () => { setError(null); setHoldKey(n => n + 1); setSeq(n => n + 1); },
        }} />
      {receive && <ReceiveSheet onClose={() => { setReceive(false); setError(null); setSeq(n => n + 1); setHoldKey(n => n + 1); }} />}
    </Screen>
  );
}
