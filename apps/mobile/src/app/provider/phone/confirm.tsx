import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../../i18n';
import { confirmOutcomeOf, nodeParamsOf, shortHash } from '../../../lib/phoneNodeView';
import { usePhoneNode } from '../../../state/phoneNode';
import { ConfirmView, type ConfirmResult } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';

/**
 * N4 "Confirmar caução" (Piu 11): abre quando a transferência da caução finaliza. "Confirmar com
 * biometria" faz a carteira assinar o vínculo com a chave deste celular e o registro fecha
 * (`confirmBond`). Resultados: N4a confirmada, N4b ainda não finalizada, N4c biometria cancelada,
 * N4d biometria trocada → N4e (confirmar a frase). O quadro "Confirmar caução" do protótipo é o pedido
 * de biometria do próprio sistema (o app não o desenha).
 */
export default function PhoneConfirm() {
  const t = useT();
  const pn = usePhoneNode();
  const fail = usePnFail();
  const { phase, transfer } = pn.bond;
  const [result, setResult] = useState<ConfirmResult>(phase === 'registered' ? 'ok' : phase === 'confirmed' ? null : 'notFinal');
  const [busy, setBusy] = useState(false);
  const panel = () => router.replace('/provider/phone' as Href);

  const confirm = async () => {
    setBusy(true);
    try { await pn.confirmBond(t('n11.n4.prompt')); setResult('ok'); }
    catch (e) {
      const o = confirmOutcomeOf(e);
      if (o === 'toast') fail(e); else setResult(o);
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <ConfirmView
        d={{ bond: pn.params.bond, days: nodeParamsOf(pn.params).days, hash: shortHash(transfer?.hash ?? pn.state.bond?.txHash), finalizedMs: transfer?.status === 'finalized' ? transfer.updatedAt : null, result, busy }}
        a={{ confirm: () => { void confirm(); }, later: panel, panel, phrase: () => router.push('/provider/phone/phrase' as Href), back: panel }} />
    </Screen>
  );
}
