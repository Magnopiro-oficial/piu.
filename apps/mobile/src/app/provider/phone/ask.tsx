import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useT } from '../../../i18n';
import { ENDORSE_REQUEST_TTL_SEC } from '../../../lib/phoneNodeCore';
import { askRows, keyGroups, sortAskRows } from '../../../lib/phoneNodeView';
import { usePhoneNode } from '../../../state/phoneNode';
import { useStore } from '../../../state/store';
import { AskView, type AskItem } from '../../../ui/NodeViews';
import { usePnFail } from '../../../ui/PhoneNode';
import { Screen } from '../../../ui/Screen';

/**
 * N5 "Pedir aval" e N5v "Sem contatos públicos" (Piu 11). Contatos públicos aceitos: quem já avalizou
 * (✓), a quem já pedi (PEDIDO), quem pode avalizar ("Pedir aval") e, apagados com o motivo, quem não
 * pode (não verificado pessoalmente, nó há poucos dias, sem modo nó). O pedido (`requestEndorsement`)
 * vale 3 dias. Embaixo, a chave do nó para mandar a um operador de Piu Node.
 */
export default function PhoneAsk() {
  const t = useT();
  const fail = usePnFail();
  const pn = usePhoneNode();
  const { chats, verified, showToast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const contacts = useMemo(() => chats.filter(ch => ch.peer && !ch.group && ch.ident === 'public').map(ch => ({ contactId: ch.peer!, chatId: ch.id, name: ch.name, verified: !!verified[ch.id] })), [chats, verified]);
  const rows = sortAskRows(askRows(pn.state, contacts, Math.floor(Date.now() / 1000)));
  const items: AskItem[] = rows.map(r => {
    const base = { contactId: r.contactId, name: r.name };
    switch (r.kind) {
      case 'received': return { ...base, kind: 'received', atMs: r.at * 1000 };
      case 'asked': return { ...base, kind: 'asked', atMs: r.at * 1000 };
      case 'tooNew': return { ...base, kind: 'tooNew', nodeDays: r.nodeDays, daysLeft: r.daysLeft };
      default: return { ...base, kind: r.kind };
    }
  });
  const chatOf = (id: string) => contacts.find(x => x.contactId === id)?.chatId;

  const ask = async (contactId: string) => {
    const name = contacts.find(x => x.contactId === contactId)?.name ?? '';
    setBusy(contactId);
    try {
      await pn.requestEndorsement(contactId);
      showToast({ icon: 'verified', title: t('pn.m4.sentTitle', { name }), body: t('pn.m4.sentBody', { days: Math.round(ENDORSE_REQUEST_TTL_SEC / 86400) }) });
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const copyKey = () => {
    if (!pn.phonePk) return;
    void Clipboard.setStringAsync(pn.phonePk).then(() => showToast({ icon: 'content_copy', title: t('n11.copied'), body: t('n11.keyPrefix', { key: keyGroups(pn.phonePk) }) })).catch(() => {});
  };

  return (
    <Screen>
      <AskView
        d={{ endorsements: pn.status?.endorsements ?? 0, needed: pn.status?.needed ?? pn.params.minEndorsements, items, keyGroups: keyGroups(pn.phonePk), bondPending: !pn.state.registration, busy }}
        a={{
          ask: id => { void ask(id); },
          verify: id => { const chatId = chatOf(id); if (chatId) router.push({ pathname: '/scan', params: { verify: chatId } }); },
          copyKey, addContact: () => router.push('/new' as Href),
          back: () => (router.canGoBack() ? router.back() : router.replace('/provider/phone' as Href)),
        }} />
    </Screen>
  );
}
