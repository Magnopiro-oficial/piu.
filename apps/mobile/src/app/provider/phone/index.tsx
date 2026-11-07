import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useT } from '../../../i18n';
import { evidenceRowOf, exitShareNeeded, keyGroups, nodeParamsOf, phaseCardOf, phoneScreen, topCardOf, trailSteps } from '../../../lib/phoneNodeView';
import { shareTextFile } from '../../../lib/shareFile';
import { VALIDATOR_PROOF_PK } from '../../../protocol/proof';
import { useMessaging } from '../../../state/messaging';
import { usePhoneNode } from '../../../state/phoneNode';
import { useStore } from '../../../state/store';
import { PanelView, type PanelData } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';

/** Caução finalizada cuja confirmação (N4) já abriu sozinha nesta sessão: "Depois" não reabre em laço. */
let confirmOpened: string | null = null;

/**
 * N2 "Painel do modo nó" (Piu 11): a trilha com a fase atual e a ação dela (N2b no topo quando a trilha
 * não mostra a ação: caução a pagar, enviada, a confirmar, saída), créditos estimados (não é dinheiro),
 * a chave do nó para um operador de Piu Node, o arquivo de registro, as evidências pela malha (N10a–c)
 * e Sair (N7). Depois da saída: N7b até compartilhar o arquivo, e "Voltar a ser nó".
 * Desligado → N1 (Conectar, "Do celular"). Caução finalizada sem o vínculo → N4 abre uma vez sozinha.
 */
export default function PhonePanel() {
  const t = useT();
  const pn = usePhoneNode();
  const fail = usePnFail();
  const { showToast } = useStore();
  const { evidence, carryEvidence } = useMessaging();
  const screen = phoneScreen(pn.status?.phase, pn.bond.phase, pn.bound);
  const txHash = pn.bond.transfer?.hash ?? null;

  useEffect(() => {
    if (screen === 'entry') router.replace('/provider/connect?mode=phone' as Href);
    else if (screen === 'confirm' && txHash && confirmOpened !== txHash) { confirmOpened = txHash; router.push('/provider/phone/confirm' as Href); }
  }, [screen, txHash]);

  const status = pn.status;
  if (!status || screen === 'entry') return <Screen>{null}</Screen>;

  const params = nodeParamsOf(pn.params);
  const nowS = Math.floor(Date.now() / 1000);
  const card = topCardOf(phaseCardOf({ phase: status.phase, bond: pn.bond.phase, bound: pn.bound, certComplete: pn.certBar.complete, endorsements: status.endorsements, needed: status.needed }));
  const today = Math.floor(nowS / 86400);
  const file = evidence();
  const est = pn.credits();
  const d: PanelData = {
    params, pause: pn.pause, card,
    phase: {
      streak: pn.certBar.streak, daysLeft: Math.max(0, params.days - pn.certBar.streak), endorsements: status.endorsements, needed: status.needed,
      refund: pn.refund.phase, refundDueMs: pn.refund.dueAt ? pn.refund.dueAt * 1000 : null,
      minutes: pn.bond.sentAt ? Math.max(1, Math.floor((nowS - pn.bond.sentAt) / 60)) : 0,
    },
    exitShare: exitShareNeeded(pn.state.exit?.at, pn.registryShared.at),
    trail: trailSteps({ bond: pn.bond.phase, certComplete: pn.certBar.complete, endorsements: status.endorsements, needed: status.needed, ready: status.phase === 'ready' }),
    confirmedAtMs: pn.state.registeredAt ? pn.state.registeredAt * 1000 : null,
    certError: !!pn.certError && pn.certError.day === today,
    credits: { value: est.credits, receipts: est.receipts },
    keyGroups: keyGroups(pn.phonePk),
    evidence: evidenceRowOf({ validatorKey: !!VALIDATOR_PROOF_PK, messenger: !!file, items: file?.receipts.length ?? 0, carriedItems: pn.evidenceCarried.items }),
    left: status.phase === 'left',
    requests: pn.requests.filter(r => r.state === 'ok').length,
  };

  const share = async () => {
    const reg = pn.registryFile();
    if (!reg) return;
    try {
      const how = await shareTextFile(pn.registryFileName(), JSON.stringify(reg, null, 2), { mimeType: 'application/json', dialogTitle: t('n11.n2.share') });
      pn.registryShared.mark();
      if (how === 'downloaded') showToast({ icon: 'download', title: t('n11.n2.share'), body: pn.registryFileName() });
    } catch (e) { fail(e); }
  };
  const sendEvidence = () => {
    const r = carryEvidence(pn.registryFile());
    if (r.reason) return; // N10b / mensageiro abrindo: a linha já diz
    pn.evidenceCarried.mark(file?.receipts.length ?? 0);
    showToast({ icon: 'hub', title: t('n11.n10.sentTitle'), body: t('n11.n10.sentBody', { count: r.bundles }) });
  };
  const copyKey = () => {
    if (!pn.phonePk) return;
    void Clipboard.setStringAsync(pn.phonePk).then(() => showToast({ icon: 'content_copy', title: t('n11.copied'), body: t('n11.keyPrefix', { key: keyGroups(pn.phonePk) }) })).catch(() => {});
  };

  return (
    <Screen>
      <PanelView d={d} a={{
        payBond: () => router.push('/provider/phone/bond' as Href),
        confirmBond: () => router.push('/provider/phone/confirm' as Href),
        retryBond: () => { void pn.retryBond().catch(fail); },
        abandonBond: () => { void pn.abandonBond().then(() => router.push('/provider/phone/bond' as Href)).catch(fail); },
        ask: () => router.push('/provider/phone/ask' as Href),
        share: () => { void share(); },
        sendEvidence,
        leave: () => router.push('/provider/phone/leave' as Href),
        backToNode: () => { void pn.cancelExit().catch(fail); },
        copyKey,
        retryCert: () => { void pn.retryCert(); },
        requests: () => router.push('/provider/phone/requests' as Href),
        back: () => (router.canGoBack() ? router.back() : router.replace('/provider')),
      }} />
    </Screen>
  );
}
