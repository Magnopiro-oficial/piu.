import { router } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { REQUESTS, START_BALANCE } from '../data/wallet';
import { usePersisted } from '../lib/persist';
import { nowHM } from '../lib/text';
import { useStore } from './store';

type ReqStatus = 'accepted' | 'declined' | 'blocked';
/** `at`: quando aconteceu (ms); `id`: perfil de Por perto, nos convites pagos. */
interface Movement { to: string; amt: number; at?: number; id?: string }

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Visibilidade em Por perto desliga sozinha (design: 1 h). */
export const NEARBY_VISIBLE_MS = HOUR;
/** Convite pago não aceito volta para a carteira (design: 24 h). */
export const INVITE_HOLD_MS = DAY;
/** Novo convite para a mesma pessoa só depois de 30 dias (design). */
export const INVITE_COOLDOWN_MS = 30 * DAY;
export type InviteState = { kind: 'none' } | { kind: 'pending'; hoursLeft: number } | { kind: 'cooldown'; daysLeft: number };
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
  /** Minutos até a visibilidade desligar sozinha (null se invisível). */
  visibleMinutesLeft: number | null;
  /** Convites já enviados (perfil → quando). */
  invited: Record<string, number>;
  /** Pendente (24 h), em espera de 30 dias, ou livre para convidar. */
  inviteState: (id: string) => InviteState;
  refunded: Movement[];
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
  // Visível até este instante (ms). Liga por 1 h; desliga sozinha, mesmo com o app fechado.
  const [visibleUntil, setVisibleUntil] = usePersisted<number | null>('nearby.visibleUntil', () => Date.now() + NEARBY_VISIBLE_MS);
  const [now, setNow] = useState(Date.now);
  const visible = visibleUntil != null && visibleUntil > now;
  const setVisible = (v: boolean) => { setVisibleUntil(v ? Date.now() + NEARBY_VISIBLE_MS : null); setNow(Date.now()); };
  // Convites antigos (booleano) passam a contar a partir de agora.
  const [invited, setInvited] = usePersisted<Record<string, number>>('nearby.invited', {}, saved =>
    Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, typeof v === 'number' ? v : Date.now()])));
  const [refunded, setRefunded] = usePersisted<Movement[]>('wallet.refunded', []);
  const [myFee, setMyFee] = usePersisted('nearby.myFee', 3);
  const [reqStatus, setReqStatus] = usePersisted<Record<string, ReqStatus>>('nearby.reqStatus', {});

  // Relógio de minuto: desligar a visibilidade, contar o tempo e devolver convites vencidos.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (visibleUntil == null) return;
    if (visibleUntil <= now) { setVisibleUntil(null); return; }
    const t = setTimeout(() => setNow(Date.now()), visibleUntil - now + 50);
    return () => clearTimeout(t);
  }, [visibleUntil, now, setVisibleUntil]);
  useEffect(() => {
    const due = reserved.filter(r => (r.at ?? now) + INVITE_HOLD_MS <= now);
    if (!due.length) return;
    setReserved(rs => rs.filter(r => !due.includes(r)));
    setRefunded(rf => [...due.map(d => ({ ...d, at: now })), ...rf]);
    showToast({ kind: 'wallet', icon: 'undo', title: due.length === 1 ? 'Convite devolvido' : `${due.length} convites devolvidos`, body: `${due.map(d => d.to).join(', ')} não respondeu em 24 h. O valor voltou para a sua carteira.` });
  }, [now, reserved, setReserved, setRefunded, showToast]);

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
      visibleMinutesLeft: visible ? Math.max(1, Math.ceil((visibleUntil! - now) / 60_000)) : null,
      invited,
      inviteState: id => {
        const at = invited[id];
        if (at == null || now - at >= INVITE_COOLDOWN_MS) return { kind: 'none' };
        if (reserved.some(r => r.id === id)) return { kind: 'pending', hoursLeft: Math.max(1, Math.ceil((at + INVITE_HOLD_MS - now) / HOUR)) };
        return { kind: 'cooldown', daysLeft: Math.max(1, Math.ceil((at + INVITE_COOLDOWN_MS - now) / DAY)) };
      },
      refunded,
      invite: (id, name, fee) => {
        const at = invited[id];
        if (at != null && Date.now() - at < INVITE_COOLDOWN_MS) return; // sem insistência: 30 dias
        setInvited(m => ({ ...m, [id]: Date.now() }));
        setReserved(r => [{ to: name, amt: fee, at: Date.now(), id }, ...r]);
      },
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
  }, [sent, reserved, earned, joaoPaid, nearPay, visible, visibleUntil, now, refunded, invited, myFee, reqStatus, addChat, setIdentity]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet fora de WalletProvider');
  return w;
}
