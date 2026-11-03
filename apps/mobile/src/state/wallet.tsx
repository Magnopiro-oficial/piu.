import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatRequest, NearProfile } from '../data/wallet';
import { pruneLegacyData } from '../lib/legacyData';
import { readPersisted, usePersisted } from '../lib/persist';
import { nowHM } from '../lib/text';
import type { EarnedMove, InviteMove } from '../lib/walletCore';
import { useStore } from './store';

type ReqStatus = 'accepted' | 'declined' | 'blocked';

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Visibilidade em Por perto desliga sozinha (design: 1 h). */
export const NEARBY_VISIBLE_MS = HOUR;
/** Convite pago não aceito volta para a carteira (design: 24 h). */
export const INVITE_HOLD_MS = DAY;
/** Novo convite para a mesma pessoa só depois de 30 dias (design). */
export const INVITE_COOLDOWN_MS = 30 * DAY;
export type InviteState = { kind: 'none' } | { kind: 'pending'; hoursLeft: number } | { kind: 'cooldown'; daysLeft: number };

interface Wallet {
  /** Saldo on-chain: 0 enquanto a liquidação não está conectada à Lunes Mainnet (nada inventado). */
  onchain: number;
  /** Convites pagos reservados (24 h), devolvidos e taxas de pedidos aceitos (a receber). */
  reserved: InviteMove[];
  refunded: InviteMove[];
  earned: EarnedMove[];
  /** Quando este aparelho começou a usar a carteira (ms), para os 7 dias do bônus. */
  since: number | null;
  // Por perto
  visible: boolean; setVisible: (v: boolean) => void;
  /** Minutos até a visibilidade desligar sozinha (null se invisível). */
  visibleMinutesLeft: number | null;
  /**
   * Perfis públicos e pedidos de conversa recebidos pela malha. Ainda não existe o anúncio de perfil
   * de Por perto no protocolo: as listas ficam vazias até ele existir (sem perfis de exemplo).
   */
  profiles: NearProfile[];
  requests: ChatRequest[];
  /** Pendente (24 h), em espera de 30 dias, ou livre para convidar. */
  inviteState: (id: string) => InviteState;
  /** Convite pago para alguém por perto: o valor fica reservado por 24 h. */
  invite: (id: string, name: string, fee: number) => void;
  /** Taxa que eu cobro para abrir conversa (escolha salva no aparelho). */
  myFee: number; setMyFee: (n: number) => void;
  reqStatus: Record<string, ReqStatus>;
  /** Aceita o pedido: abre a conversa e a taxa fica a receber. */
  accept: (id: string) => void;
  decline: (id: string) => void;
  block: (id: string) => void;
}

const Ctx = createContext<Wallet | null>(null);
const NO_PROFILES: NearProfile[] = [];
const NO_REQUESTS: ChatRequest[] = [];

export function WalletProvider({ children }: { children: ReactNode }) {
  const { addChat, setIdentity, onboarded, showToast } = useStore();
  // Campos novos (os antigos, `wallet.*` e `nearby.invited/reqStatus`, só tinham dados de exemplo e
  // são apagados por `pruneLegacyData`).
  const [invites, setInvites] = usePersisted<Record<string, number>>('nearby.invites', {});
  const [reserved, setReserved] = usePersisted<InviteMove[]>('nearby.reserved', []);
  const [refunded, setRefunded] = usePersisted<InviteMove[]>('nearby.refunded', []);
  const [earned, setEarned] = usePersisted<EarnedMove[]>('nearby.earned', []);
  const [reqStatus, setReqStatus] = usePersisted<Record<string, ReqStatus>>('nearby.answers', {});
  const [since, setSince] = usePersisted<number | null>('wallet.since', null);
  const [myFee, setMyFee] = usePersisted('nearby.myFee', 3);
  // Visível até este instante (ms). Liga por 1 h; desliga sozinha, mesmo com o app fechado.
  // Na primeira vez segue Privacidade → "Por perto começa" (padrão: invisível).
  const [visibleUntil, setVisibleUntil] = usePersisted<number | null>('nearby.visibleUntil',
    () => (readPersisted<{ near?: string }>('set.priv')?.near === '1h' ? Date.now() + NEARBY_VISIBLE_MS : null));
  const [now, setNow] = useState(Date.now);
  const visible = visibleUntil != null && visibleUntil > now;
  const requests = NO_REQUESTS;

  // Uma vez por abertura: tira do disco o que versões antigas salvaram como exemplo.
  useEffect(() => { void pruneLegacyData(); }, []);
  useEffect(() => { if (onboarded && since == null) setSince(Date.now()); }, [onboarded, since, setSince]);

  // Relógio: desligar a visibilidade, contar o tempo e devolver convites vencidos.
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
    const due = reserved.filter(r => r.at + INVITE_HOLD_MS <= now);
    if (!due.length) return;
    setReserved(rs => rs.filter(r => !due.includes(r)));
    setRefunded(rf => [...due.map(d => ({ ...d, at: now })), ...rf]);
    showToast({ kind: 'wallet', icon: 'undo', title: due.length === 1 ? 'Convite devolvido' : `${due.length} convites devolvidos`, body: `${due.map(d => d.to).join(', ')} não respondeu em 24 h. O valor voltou para a sua carteira.` });
  }, [now, reserved, setReserved, setRefunded, showToast]);

  const value = useMemo<Wallet>(() => ({
    onchain: 0,
    reserved, refunded, earned, since,
    visible,
    setVisible: v => { setVisibleUntil(v ? Date.now() + NEARBY_VISIBLE_MS : null); setNow(Date.now()); },
    visibleMinutesLeft: visible ? Math.max(1, Math.ceil((visibleUntil! - now) / 60_000)) : null,
    profiles: NO_PROFILES,
    requests,
    inviteState: id => {
      const at = invites[id];
      if (at == null || now - at >= INVITE_COOLDOWN_MS) return { kind: 'none' };
      if (reserved.some(r => r.id === id)) return { kind: 'pending', hoursLeft: Math.max(1, Math.ceil((at + INVITE_HOLD_MS - now) / HOUR)) };
      return { kind: 'cooldown', daysLeft: Math.max(1, Math.ceil((at + INVITE_COOLDOWN_MS - now) / DAY)) };
    },
    invite: (id, name, fee) => {
      const at = invites[id];
      if (at != null && Date.now() - at < INVITE_COOLDOWN_MS) return; // sem insistência: 30 dias
      setInvites(m => ({ ...m, [id]: Date.now() }));
      setReserved(r => [{ id, to: name, amt: fee, at: Date.now() }, ...r]);
    },
    myFee, setMyFee,
    reqStatus,
    accept: id => {
      const r = requests.find(x => x.id === id);
      if (!r || reqStatus[id] === 'accepted') return;
      setReqStatus(m => ({ ...m, [id]: 'accepted' }));
      setEarned(e => [{ from: r.name, amt: r.fee, at: Date.now() }, ...e]);
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
  }), [reserved, refunded, earned, since, visible, visibleUntil, now, requests, invites, myFee, reqStatus, setVisibleUntil, setInvites, setReserved, setMyFee, setReqStatus, setEarned, setIdentity, addChat]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet fora de WalletProvider');
  return w;
}
