import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { leaveMode, nodeParamsOf } from '../../../lib/phoneNodeView';
import { usePhoneNode } from '../../../state/phoneNode';
import { LeaveView } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';

/**
 * N7 "Sair do programa" (Piu 11). Segurar 0,9 s assina o pedido de saída com a chave do nó (`leave`);
 * a caução volta 7 dias depois, À MÃO (pode demorar). Depois, o painel mostra N7b até o arquivo de
 * registro (que leva a saída) ser compartilhado. Sem caução confirmada, sair só desliga o modo; com a
 * caução ainda a caminho, o botão espera a confirmação (a saída perderia a referência à transferência).
 */
export default function PhoneLeave() {
  const fail = usePnFail();
  const pn = usePhoneNode();
  const [holdKey, setHoldKey] = useState(0);
  const mode = leaveMode({ registered: !!pn.state.registration, bond: pn.bond.phase });
  const stay = () => (router.canGoBack() ? router.back() : router.replace('/provider/phone' as Href));
  const sign = async () => {
    try { await pn.leave(); router.replace((mode === 'refund' ? '/provider/phone' : '/provider') as Href); }
    catch (e) { fail(e); setHoldKey(k => k + 1); }
  };
  return (
    <Screen>
      <LeaveView d={{ params: nodeParamsOf(pn.params), mode, holdKey }} a={{ sign: () => { void sign(); }, stay, back: stay }} />
    </Screen>
  );
}
