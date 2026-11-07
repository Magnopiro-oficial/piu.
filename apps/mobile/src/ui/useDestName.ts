import { useMemo } from 'react';
import { contactAddresses } from '../lib/walletSend';
import { decodeSs58 } from '../lib/ss58';
import { useMessaging } from '../state/messaging';
import { useStore } from '../state/store';

/** Nome do contato dono de um endereço Lunes (o que ele compartilhou ou o do último pedido de pagamento), ou null. */
export function useDestName(address: string | null | undefined): string | null {
  const { chats } = useStore();
  const { payments, walletContacts } = useMessaging();
  return useMemo(() => {
    if (!address) return null;
    const key = (a: string) => { const d = decodeSs58(a); return d.ok ? Array.from(d.publicKey).join(',') : a; };
    const want = key(address);
    const shared = walletContacts().find(w => key(w.address) === want);
    if (shared) return shared.name;
    for (const [chatId, a] of contactAddresses(chats, payments.all())) if (key(a) === want) return chats.find(ch => ch.id === chatId)?.name ?? null;
    return null;
  }, [address, chats, payments.epoch, walletContacts]); // eslint-disable-line react-hooks/exhaustive-deps
}
