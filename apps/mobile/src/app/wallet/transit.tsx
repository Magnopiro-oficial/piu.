import { Redirect, router, type Href } from 'expo-router';
import { useState } from 'react';
import { transitPill, transitSteps, wholeLunes } from '../../lib/carryView';
import { addrGroups } from '../../lib/phoneNodeView';
import { useWallet } from '../../state/wallet';
import { TransitView } from '../../ui/NodeViews';
import { usePnFail } from '../../ui/PhoneNode';
import { Screen } from '../../ui/Screen';
import { useDestName } from '../../ui/useDestName';

/**
 * N9 "Em trânsito pela malha" (Piu 11): o detalhe da transferência levada pela malha. O que um gateway
 * informa (`carried.report`: na fila, em bloco, finalizada, recusada) fica marcado como não conferido até
 * este celular ler a Mainnet com internet (só "Confirmada" é conferida). "Soltar de novo na malha" reenvia
 * os MESMOS bytes assinados (`recarryTransfer`, nunca reassina); "Conferir com internet" lê a Mainnet
 * (`retryTransfer` → `reconcileCarriedTransfer`). N9c: recusa informada. O número de aparelhos por onde a
 * carga passou não existe no protocolo, então a etapa "Na malha" não o mostra.
 */
export default function Transit() {
  const fail = usePnFail();
  const { pendingTransfer: r, recarryTransfer, retryTransfer, refreshTransfer } = useWallet();
  const name = useDestName(r?.dest);
  const [busy, setBusy] = useState(false);
  const [legend, setLegend] = useState(false);
  if (!r?.carried) return <Redirect href={'/(tabs)/wallet' as Href} />;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); } };
  return (
    <Screen>
      <TransitView
        d={{
          amount: wholeLunes(r.value), name: name ?? addrGroups(r.dest), pill: transitPill(r), steps: transitSteps(r),
          block: r.carried.report?.block?.number ?? r.block?.number ?? null, reason: r.carried.report?.reason ?? null, error: r.error ?? null, busy, showLegend: legend,
        }}
        a={{
          recarry: () => { void run(recarryTransfer); },
          check: () => { void run(async () => { await retryTransfer(); await refreshTransfer(); }); },
          legend: () => setLegend(v => !v),
          back: () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet' as Href)),
        }} />
    </Screen>
  );
}
