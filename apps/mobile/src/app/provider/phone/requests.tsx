import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../../i18n';
import { ENDORSE_REQUEST_TTL_SEC, PHONE_NODE_MIN_AGE_DAYS } from '../../../lib/phoneNodeCore';
import { keyGroups, monthRenewalMs, nodeParamsOf, requestList } from '../../../lib/phoneNodeView';
import { usePhoneNode } from '../../../state/phoneNode';
import { useStore } from '../../../state/store';
import { RequestsView } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';

/**
 * N6 "Pedidos de aval recebidos" (Piu 11). Abre pela notificação (N6n, ui/PhoneNodeWatch.tsx) ou pelo
 * cartão na conversa (`?c=<id do contato>` abre aquele pedido expandido; sem ele, o primeiro).
 * Avalizar = segurar 0,9 s (assina com a chave do nó, `endorse`, que afirma a verificação pessoal).
 * Bloqueios no lugar do gesto: N6a fora do modo nó, N6b a si mesmo, N6c já avalizou, N6d limite do mês;
 * e os demais motivos reais (não verificado, nó novo, pedido vencido/cancelado, caução de quem pede).
 * Ignorar não envia nada a quem pediu. N6v: nenhum pedido.
 */
export default function PhoneRequests() {
  const t = useT();
  const fail = usePnFail();
  const pn = usePhoneNode();
  const { showToast } = useStore();
  const { c } = useLocalSearchParams<{ c?: string }>();
  const [focus, setFocus] = useState<string | null>(typeof c === 'string' ? c : null);
  const [holdKey, setHoldKey] = useState(0);
  const params = nodeParamsOf(pn.params);
  const nowS = Math.floor(Date.now() / 1000);
  const items = requestList(pn.requests, focus).map(r => {
    const g = pn.state.given.find(x => x.contactId === r.contactId);
    return { contactId: r.contactId, name: r.name || '—', createdAtMs: r.createdAt * 1000, keyGroups: keyGroups(r.phonePk), state: r.state, block: r.block, expanded: r.expanded, givenAtMs: g ? g.day * 86_400_000 : null };
  });
  const chatOf = (id: string) => pn.requests.find(r => r.contactId === id)?.chatId;

  const endorse = async (contactId: string) => {
    const name = (pn.requests.find(r => r.contactId === contactId)?.name ?? '').split(/\s+/)[0] ?? '';
    try {
      await pn.endorse(contactId);
      showToast({ icon: 'verified', title: t('pn.m5.sentTitle', { name }), body: t('pn.m5.sentBody', { days: params.endorseValidityDays }) });
    } catch (e) { fail(e); setHoldKey(k => k + 1); }
  };

  return (
    <Screen>
      <RequestsView
        d={{ given: pn.given.thisMonth, max: pn.given.max, renewsMs: monthRenewalMs(nowS), items, validityDays: params.endorseValidityDays, minAgeDays: PHONE_NODE_MIN_AGE_DAYS, ttlDays: Math.round(ENDORSE_REQUEST_TTL_SEC / 86400), holdKey }}
        a={{
          endorse: id => { void endorse(id); },
          ignore: id => { void pn.decline(id); if (focus === id) setFocus(null); },
          expand: setFocus,
          activate: () => router.push('/provider/connect?mode=phone' as Href),
          verify: id => { const chatId = chatOf(id); if (chatId) router.push({ pathname: '/scan', params: { verify: chatId } }); },
          openChat: id => { const chatId = chatOf(id); if (chatId) router.push({ pathname: '/chat/[id]', params: { id: chatId } }); },
          back: () => (router.canGoBack() ? router.back() : router.replace('/' as Href)),
        }} />
    </Screen>
  );
}
