import { router } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { REQUESTS, START_BALANCE } from '../data/wallet';
import { usePersisted } from '../lib/persist';
import { nowHM } from '../lib/text';
import { useStore } from './store';

type ReqStatus = 'accepted' | 'declined' | 'blocked';
interface Movement { to: string; amt: number }
/** Recebido: taxa de convite aceito (Por perto) ou distribuição por pessoa convidada. */
interface Earned { from: string; amt: number; kind?: 'invite' | 'referral' }

interface Wallet {
  /** Saldo = inicial − enviados − reservados (convites pagos) + recebidos. */
  balance: number;
  sent: Movement[];
  reserved: Movement[];
  earned: Earned[];
  /** Distribuição de João Souza já paga (simulação: completa os 7 dias com o app aberto). */
  joaoPaid: boolean;
  send: (to: string, amt: number) => void;
  nearPay: boolean; setNearPay: (v: boolean) => void;
  // Por perto
  visible: boolean; setVisible: (v: boolean) => void;
  invited: Record<string, boolean>;
  /** Convite pago para alguém por perto: o valor fica reservado por 24 h. */
  invite: (id: string, name: string, fee: number) => void;
  myFee: number; setMyFee: (n: number) => void;
  reqStatus: Record<string, ReqStatus>;
  /** Aceita o pedido: abre a conversa e a taxa entra na carteira. */
  accept: (id: string) => void;
  decline: (id: string) => void;
  block: (id: string) => void;
}

const Ctx = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { addChat, setIdentity, onboarded, showToast } = useStore();
  const [sent, setSent] = usePersisted<Movement[]>('wallet.sent', []);
  const [reserved, setReserved] = usePersisted<Movement[]>('wallet.reserved', []);
  const [earned, setEarned] = usePersisted<Earned[]>('wallet.earned', []);
  const [joaoPaid, setJoaoPaid] = usePersisted('wallet.joaoPaid', false);
  const [helenaNotified, setHelenaNotified] = usePersisted('nearby.helenaNotified', false);
  const [nearPay, setNearPay] = usePersisted('wallet.nearPay', true);
  const [visible, setVisible] = usePersisted('nearby.visible', true);
  const [invited, setInvited] = usePersisted<Record<string, boolean>>('nearby.invited', {});
  const [myFee, setMyFee] = usePersisted('nearby.myFee', 3);
  const [reqStatus, setReqStatus] = usePersisted<Record<string, ReqStatus>>('nearby.reqStatus', {});

  // SIMULAÇÃO dos eventos da carteira e de Por perto (o modelo econômico ainda está em aberto):
  // um pedido de conversa chega pouco depois de abrir o app com Por perto ligado, e o convidado
  // João Souza completa os 7 dias de uso. Cada um acontece uma vez só, com o banner do design.
  const toast = useRef(showToast); toast.current = showToast;
  useEffect(() => {
    if (!onboarded || !visible || helenaNotified || reqStatus.helena) return;
    const h = REQUESTS.find(r => r.id === 'helena');
    if (!h) return;
    const t = setTimeout(() => {
      setHelenaNotified(true);
      toast.current({ kind: 'nearby', icon: 'waving_hand', title: `${h.name} quer conversar`, body: `+${h.fee.toFixed(2).replace('.', ',')} LUNES se você aceitar · expira em 24 h`, action: 'Ver', go: () => router.push('/nearby/requests') });
    }, 20_000);
    return () => clearTimeout(t);
  }, [onboarded, visible, helenaNotified, reqStatus.helena, setHelenaNotified]);
  useEffect(() => {
    if (!onboarded || joaoPaid) return;
    const t = setTimeout(() => {
      setJoaoPaid(true);
      setEarned(e => [{ from: 'João Souza', amt: 25, kind: 'referral' }, ...e]);
      toast.current({ kind: 'wallet', icon: 'toll', coin: true, title: 'Você recebeu 25,00 LUNES', body: 'Distribuição · João Souza ficou ativo por 7 dias', go: () => router.push('/(tabs)/wallet') });
    }, 45_000);
    return () => clearTimeout(t);
  }, [onboarded, joaoPaid, setJoaoPaid, setEarned]);

  const value = useMemo<Wallet>(() => {
    const total = (xs: { amt: number }[]) => xs.reduce((a, x) => a + x.amt, 0);
    return {
      balance: START_BALANCE - total(sent) - total(reserved) + total(earned),
      sent, reserved, earned, joaoPaid,
      send: (to, amt) => setSent(s => [{ to, amt }, ...s]),
      nearPay, setNearPay,
      visible, setVisible,
      invited,
      invite: (id, name, fee) => { setInvited(m => ({ ...m, [id]: true })); setReserved(r => [{ to: name, amt: fee }, ...r]); },
      myFee, setMyFee,
      reqStatus,
      accept: id => {
        const r = REQUESTS.find(x => x.id === id);
        if (!r || reqStatus[id] === 'accepted') return;
        setReqStatus(m => ({ ...m, [id]: 'accepted' }));
        setEarned(e => [{ from: r.name, amt: r.fee, kind: 'invite' }, ...e]);
        setIdentity('public');
        addChat({
          id: 'near-' + id, ident: 'public', kind: 'direct', name: r.name, initials: r.initials, time: 'agora', unread: 0,
          sub: `${r.prox} · direto`, via: 'Bluetooth LE · direto', viaIcon: 'bluetooth',
          route: { nodes: [{ n: 'Você', k: 'Este aparelho' }, { n: r.name, k: 'Destino' }], vias: ['Bluetooth LE'] },
          msgs: [{ id: 'nm-' + id, from: 'them', text: r.msg, time: nowHM() }],
        });
      },
      decline: id => setReqStatus(m => ({ ...m, [id]: 'declined' })),
      block: id => setReqStatus(m => ({ ...m, [id]: 'blocked' })),
    };
  }, [sent, reserved, earned, joaoPaid, nearPay, visible, invited, myFee, reqStatus, addChat, setIdentity]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet fora de WalletProvider');
  return w;
}
