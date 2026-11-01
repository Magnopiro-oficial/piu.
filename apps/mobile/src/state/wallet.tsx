import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { REQUESTS, START_BALANCE } from '../data/wallet';
import { nowHM } from '../lib/text';
import { useStore } from './store';

type ReqStatus = 'accepted' | 'declined' | 'blocked';
interface Movement { to: string; amt: number }

interface Wallet {
  /** Saldo = inicial − enviados − reservados (convites pagos) + recebidos. */
  balance: number;
  sent: Movement[];
  reserved: Movement[];
  earned: { from: string; amt: number }[];
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
  const { addChat, setIdentity } = useStore();
  const [sent, setSent] = useState<Movement[]>([]);
  const [reserved, setReserved] = useState<Movement[]>([]);
  const [earned, setEarned] = useState<{ from: string; amt: number }[]>([]);
  const [nearPay, setNearPay] = useState(true);
  const [visible, setVisible] = useState(true);
  const [invited, setInvited] = useState<Record<string, boolean>>({});
  const [myFee, setMyFee] = useState(3);
  const [reqStatus, setReqStatus] = useState<Record<string, ReqStatus>>({});

  const value = useMemo<Wallet>(() => {
    const total = (xs: { amt: number }[]) => xs.reduce((a, x) => a + x.amt, 0);
    return {
      balance: START_BALANCE - total(sent) - total(reserved) + total(earned),
      sent, reserved, earned,
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
        setEarned(e => [{ from: r.name, amt: r.fee }, ...e]);
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
  }, [sent, reserved, earned, nearPay, visible, invited, myFee, reqStatus, addChat, setIdentity]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet fora de WalletProvider');
  return w;
}
