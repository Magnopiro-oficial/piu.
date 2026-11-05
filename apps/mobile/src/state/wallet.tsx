import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { t } from '../i18n/core';
import { confirmDevice } from '../lib/deviceAuth';
import { buildTransferKeepAlive } from '../lib/extrinsic';
import { parseLunesAmount } from '../lib/paymentRequest';
import { walletAddressFromPhrase, withWalletKey } from '../lib/walletKey';
import { canSignWalletAddress, walletSelection } from '../lib/walletSelection';
import { isActiveWalletTransfer, isWalletTransferRecord, prepareWalletTransfer, retryWalletTransfer, sendWalletTransfer, trackWalletTransfer, WalletTransferError, type WalletQuote, type WalletTransferRecord } from '../lib/walletTransfer';
import { useKeys } from './keys';
import { pruneLegacyData } from '../lib/legacyData';
import { fetchLunesHistory, toHistorySnapshot, type HistorySnapshot } from '../lib/lunesHistory';
import { accountBalance, formatLunes, LunesRpc, planckToLunes } from '../lib/lunesRpc';
import { persistNow, persistedReadFailed, readPersisted, usePersisted } from '../lib/persist';
import { mustBlockWalletRecovery } from '../lib/persistSafety';
import { decodeSs58 } from '../lib/ss58';
import type { EarnedMove, InviteMove, OnchainSnapshot, OnchainStatus } from '../lib/walletCore';
import { useStore } from './store';

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Visibilidade em Por perto desliga sozinha (design: 1 h). */
export const NEARBY_VISIBLE_MS = HOUR;
/** Convite pago não aceito volta para a carteira (design: 24 h). */
export const INVITE_HOLD_MS = DAY;
/** Novo convite para a mesma pessoa só depois de 30 dias (design). */
export const INVITE_COOLDOWN_MS = 30 * DAY;
export type InviteState = { kind: 'none' } | { kind: 'pending'; hoursLeft: number } | { kind: 'cooldown'; daysLeft: number };

interface Wallet {
  /**
   * Saldo livre (`free`) em LUNES da conta Lunes informada, lido na Lunes Mainnet. 0 sem endereço ou
   * antes da primeira leitura (nada inventado). A chave própria deriva da frase no cofre nativo.
   */
  onchain: number;
  /** Endereço selecionado: próprio, ou endereço externo salvo para consulta. */
  lunesAddress: string | null;
  /** Salva o endereço (conferido: base58, prefixo 57 ou 42, soma de verificação). Devolve o erro, ou null. null seleciona a própria sem apagar o endereço externo salvo. */
  setLunesAddress: (a: string | null) => string | null;
  /** Carteira própria: mesma frase do backup, somente com cofre nativo seguro. */
  ownAddress: string | null;
  watchedAddress: string | null;
  nativeWalletReady: boolean;
  canSign: boolean;
  canSignAddress: (address: string) => boolean;
  useOwnWallet: () => void;
  quoteTransfer: (dest: string, amount: string) => Promise<WalletQuote>;
  sendTransfer: (quote: WalletQuote) => Promise<WalletTransferRecord>;
  pendingTransfer: WalletTransferRecord | null;
  transferRecoveryBlocked: boolean;
  refreshTransfer: () => Promise<void>;
  retryTransfer: () => Promise<WalletTransferRecord>;
  /** Última leitura (guardada para mostrar sem rede) e o estado da consulta. */
  onchainSnap: OnchainSnapshot | null;
  onchainStatus: OnchainStatus;
  /** Lê o saldo de novo na Mainnet (ao abrir a carteira e ao puxar a tela). */
  refreshOnchain: () => Promise<void>;
  /**
   * Histórico de transferências de LUNES do endereço, lido do indexador da Lunes (lib/lunesHistory.ts):
   * última leitura guardada (para mostrar sem rede) e o estado da consulta. Separado do saldo porque
   * a fonte é outra (indexador, não o nó): um pode falhar sem derrubar o outro.
   */
  historySnap: HistorySnapshot | null;
  historyStatus: OnchainStatus;
  /** Lê o histórico de novo (ao abrir a carteira e ao puxar a tela). */
  refreshHistory: () => Promise<void>;
  /**
   * Convites pagos reservados (24 h), devolvidos, aceitos por quem eu convidei (pagos) e taxas de
   * pedidos que eu aceitei (a receber). Tudo é registro local: a reserva assinada em LUNES depende da
   * liquidação na Lunes Mainnet, que ainda não está ligada ao app.
   */
  reserved: InviteMove[];
  refunded: InviteMove[];
  spent: InviteMove[];
  earned: EarnedMove[];
  /** Quando este aparelho começou a usar a carteira (ms), para os 7 dias do bônus. */
  since: number | null;
  // Por perto (perfis e pedidos vêm da malha: state/messaging.tsx, `nearby`)
  visible: boolean; setVisible: (v: boolean) => void;
  /** Fim da visibilidade (ms), para o anúncio de presença; null = invisível. */
  visibleUntil: number | null;
  /** Minutos até a visibilidade desligar sozinha (null se invisível). */
  visibleMinutesLeft: number | null;
  /** Pendente (24 h), em espera de 30 dias, ou livre para convidar. */
  inviteState: (id: string) => InviteState;
  /** Convite pago enviado pela malha: o valor fica reservado por 24 h (registro local). */
  invite: (id: string, name: string, fee: number) => void;
  /** Quem eu convidei aceitou: o valor reservado sai da carteira (vai para a pessoa). */
  settleInvite: (id: string) => void;
  /** Aceitei um pedido: a taxa fica a receber. */
  recordEarned: (from: string, fee: number) => void;
  /** Taxa que eu cobro para abrir conversa (escolha salva no aparelho e anunciada em Por perto). */
  myFee: number; setMyFee: (n: number) => void;
}

const Ctx = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { onboarded, showToast } = useStore();
  const { phrase, vaultIsSecure } = useKeys();
  const derivedAddress = useMemo(() => {
    if (Platform.OS === 'web' || !vaultIsSecure || !phrase) return null;
    try { return walletAddressFromPhrase(phrase); } catch { return null; }
  }, [phrase, vaultIsSecure]);
  // Campos novos (os antigos, `wallet.*` e `nearby.invited/reqStatus`, só tinham dados de exemplo e
  // são apagados por `pruneLegacyData`).
  const [invites, setInvites] = usePersisted<Record<string, number>>('nearby.invites', {});
  const [reserved, setReserved] = usePersisted<InviteMove[]>('nearby.reserved', []);
  const [refunded, setRefunded] = usePersisted<InviteMove[]>('nearby.refunded', []);
  const [spent, setSpent] = usePersisted<InviteMove[]>('nearby.spent', []);
  const [earned, setEarned] = usePersisted<EarnedMove[]>('nearby.earned', []);
  const [since, setSince] = usePersisted<number | null>('wallet.since', null);
  const [myFee, setMyFee] = usePersisted('nearby.myFee', 3);
  // Visível até este instante (ms). Liga por 1 h; desliga sozinha, mesmo com o app fechado.
  // Na primeira vez segue Privacidade → "Por perto começa" (padrão: invisível).
  const [visibleUntil, setVisibleUntil] = usePersisted<number | null>('nearby.visibleUntil',
    () => (readPersisted<{ near?: string }>('set.priv')?.near === '1h' ? Date.now() + NEARBY_VISIBLE_MS : null));
  // O campo legado mantém o endereço externo: selecionar a própria nunca o sobrescreve.
  const [externalAddress, setLunesAddressRaw] = usePersisted<string | null>('wallet.lunesAddress', null);
  const [preferOwn, setPreferOwn] = usePersisted('wallet.useOwn', false);
  const { lunesAddress, ownAddress, canSign, nativeWalletReady } = walletSelection({ native: Platform.OS !== 'web', secure: vaultIsSecure, ownAddress: derivedAddress, externalAddress, useOwn: preferOwn });
  const [transferRecoveryBlocked] = useState(() => {
    const value = readPersisted<unknown>('wallet.transfer');
    return mustBlockWalletRecovery(persistedReadFailed('wallet.transfer'), value, isWalletTransferRecord);
  });
  const [pendingTransfer, setPendingTransfer] = useState<WalletTransferRecord | null>(() => {
    const record = readPersisted<unknown>('wallet.transfer');
    return isWalletTransferRecord(record) ? record : null;
  });
  const pendingTransferRef = useRef(pendingTransfer);
  const transferBusy = useRef(false);
  const walletIdentity = useRef({ phrase, ownAddress, nativeWalletReady });
  walletIdentity.current = { phrase, ownAddress, nativeWalletReady };
  const [onchainSnap, setOnchainSnap] = usePersisted<OnchainSnapshot | null>('wallet.onchain', null);
  const [onchainStatus, setOnchainStatus] = useState<OnchainStatus>({ state: 'idle' });
  const [historySnap, setHistorySnap] = usePersisted<HistorySnapshot | null>('wallet.history', null);
  const [historyStatus, setHistoryStatus] = useState<OnchainStatus>({ state: 'idle' });
  // Endereço sendo lido agora e o endereço atual: leitura de um endereço trocado no meio é descartada.
  const reading = useRef<string | null>(null);
  const readingHistory = useRef<string | null>(null);
  const latest = useRef(lunesAddress);
  latest.current = lunesAddress;
  const [now, setNow] = useState(Date.now);
  const visible = visibleUntil != null && visibleUntil > now;

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

  /** Uma leitura por vez; o resultado só vale para o endereço que foi consultado. */
  const refreshOnchain = useCallback(async () => {
    const address = lunesAddress;
    if (!address || reading.current === address) return;
    reading.current = address;
    setOnchainStatus({ state: 'loading' });
    const rpc = new LunesRpc();
    try {
      const b = await accountBalance(rpc, address);
      if (latest.current !== address) return;
      setOnchainSnap({ address, exists: b.exists, free: b.free.toString(), reserved: b.reserved.toString(), frozen: b.frozen.toString(), block: b.block, blockHash: b.blockHash, endpoint: b.endpoint, at: Date.now() });
      setOnchainStatus({ state: 'ok' });
    } catch (e) {
      if (latest.current === address) setOnchainStatus({ state: 'error', error: e instanceof Error ? e.message : 'Falha na consulta.' });
    } finally {
      rpc.close();
      if (reading.current === address) reading.current = null;
    }
  }, [lunesAddress, setOnchainSnap]);

  /** Uma leitura do histórico por vez; o resultado só vale para o endereço consultado. */
  const refreshHistory = useCallback(async () => {
    const address = lunesAddress;
    if (!address || readingHistory.current === address) return;
    readingHistory.current = address;
    setHistoryStatus({ state: 'loading' });
    try {
      const h = await fetchLunesHistory(address);
      if (latest.current !== address) return;
      setHistorySnap(toHistorySnapshot(h));
      setHistoryStatus({ state: 'ok' });
    } catch (e) {
      if (latest.current === address) setHistoryStatus({ state: 'error', error: e instanceof Error ? e.message : 'Falha na consulta.' });
    } finally {
      if (readingHistory.current === address) readingHistory.current = null;
    }
  }, [lunesAddress, setHistorySnap]);

  const setLunesAddress = useCallback((a: string | null) => {
    if (a !== null) {
      const d = decodeSs58(a);
      if (!d.ok) return d.error;
    }
    const next = a?.trim() ?? ownAddress;
    // Mudança imediata da referência também descarta consultas em voo antes do próximo render.
    latest.current = next;
    if (next !== lunesAddress) {
      setOnchainSnap(null); setOnchainStatus({ state: 'idle' });
      setHistorySnap(null); setHistoryStatus({ state: 'idle' });
    }
    if (a === null) setPreferOwn(true);
    else { setLunesAddressRaw(a.trim()); setPreferOwn(false); }
    return null;
  }, [lunesAddress, ownAddress, setLunesAddressRaw, setPreferOwn, setOnchainSnap, setHistorySnap]);
  const useOwnWallet = useCallback(() => { setLunesAddress(null); }, [setLunesAddress]);
  const canSignAddress = useCallback((address: string) => nativeWalletReady && canSignWalletAddress(address, ownAddress), [nativeWalletReady, ownAddress]);

  const requireOwn = useCallback((from?: string) => {
    if (transferRecoveryBlocked || persistedReadFailed('wallet.transfer')) throw new WalletTransferError('persistence', t('ownWallet.recoveryError'));
    const current = walletIdentity.current;
    if (!current.nativeWalletReady || !current.phrase || !current.ownAddress) throw new WalletTransferError('signing', t('ownWallet.unavailable'));
    const address = from ?? latest.current;
    if (!canSignWalletAddress(address, current.ownAddress)) throw new WalletTransferError('signing', t('ownWallet.watchOnly'));
    if (from && !canSignWalletAddress(latest.current, from)) throw new WalletTransferError('signing', t('ownWallet.accountChanged'));
    return { phrase: current.phrase, address: address! };
  }, [transferRecoveryBlocked]);

  const saveTransfer = useCallback(async (record: WalletTransferRecord) => {
    // A Promise só resolve com o registro cifrado em disco: o motor não pode enviar antes disso.
    await persistNow('wallet.transfer', record);
    pendingTransferRef.current = record;
    setPendingTransfer(record);
  }, []);

  const quoteTransfer = useCallback(async (dest: string, amount: string) => {
    const { address } = requireOwn();
    if (isActiveWalletTransfer(pendingTransferRef.current) || transferBusy.current) throw new WalletTransferError('busy', t('ownWallet.busy'));
    const value = parseLunesAmount(amount);
    if (value === null || value <= 0n) throw new WalletTransferError('invalid', t('ownWallet.amountInvalid'));
    const quote = await prepareWalletTransfer({ from: address, dest, value: value.toString() });
    requireOwn(address);
    return quote;
  }, [requireOwn]);

  const sendTransfer = useCallback(async (quote: WalletQuote) => {
    requireOwn(quote.from);
    if (transferBusy.current || isActiveWalletTransfer(pendingTransferRef.current)) throw new WalletTransferError('busy', t('ownWallet.busy'));
    transferBusy.current = true;
    try {
      return await sendWalletTransfer(quote, {
        active: () => pendingTransferRef.current,
        authorize: async fresh => {
          requireOwn(fresh.from);
          const result = await confirmDevice(t('ownWallet.auth', { amount: formatLunes(BigInt(fresh.value)), dest: fresh.dest }));
          if (result !== 'ok') return false;
          requireOwn(fresh.from);
          return true;
        },
        sign: fresh => {
          const { phrase: words } = requireOwn(fresh.from);
          return withWalletKey(words, key => buildTransferKeepAlive(key, { dest: fresh.dest, value: BigInt(fresh.value), ctx: { ...fresh.ctx, tip: BigInt(fresh.ctx.tip) } }));
        },
        save: async record => {
          const firstSave = pendingTransferRef.current?.hash !== record.hash;
          if (firstSave) requireOwn(record.from);
          await saveTransfer(record);
          // Se a conta mudou enquanto o cofre gravava, a assinatura fica registrada, mas não sai.
          if (firstSave) requireOwn(record.from);
        },
      });
    } finally { transferBusy.current = false; }
  }, [requireOwn, saveTransfer]);

  const refreshTransfer = useCallback(async () => {
    const record = pendingTransferRef.current;
    if (!record || !isActiveWalletTransfer(record) || transferBusy.current) return;
    transferBusy.current = true;
    try {
      await trackWalletTransfer(record, { save: saveTransfer });
      void refreshOnchain(); void refreshHistory();
    } finally { transferBusy.current = false; }
  }, [saveTransfer, refreshOnchain, refreshHistory]);

  const retryTransfer = useCallback(async () => {
    const record = pendingTransferRef.current;
    if (!record) throw new WalletTransferError('invalid', t('ownWallet.unavailable'));
    requireOwn(record.from);
    if (transferBusy.current) throw new WalletTransferError('busy', t('ownWallet.busy'));
    transferBusy.current = true;
    try { return await retryWalletTransfer(record, { save: saveTransfer }); }
    finally { transferBusy.current = false; }
  }, [requireOwn, saveTransfer]);

  const onchain = onchainSnap && lunesAddress && onchainSnap.address === lunesAddress ? planckToLunes(BigInt(onchainSnap.free)) : 0;

  const value = useMemo<Wallet>(() => ({
    onchain, lunesAddress, setLunesAddress, ownAddress, watchedAddress: externalAddress, nativeWalletReady, canSign, canSignAddress, useOwnWallet, quoteTransfer, sendTransfer, pendingTransfer, transferRecoveryBlocked, refreshTransfer, retryTransfer, onchainSnap, onchainStatus, refreshOnchain,
    historySnap, historyStatus, refreshHistory,
    reserved, refunded, spent, earned, since,
    visible,
    setVisible: v => { setVisibleUntil(v ? Date.now() + NEARBY_VISIBLE_MS : null); setNow(Date.now()); },
    visibleUntil: visible ? visibleUntil : null,
    visibleMinutesLeft: visible ? Math.max(1, Math.ceil((visibleUntil! - now) / 60_000)) : null,
    inviteState: id => {
      const at = invites[id];
      if (at == null || now - at >= INVITE_COOLDOWN_MS) return { kind: 'none' };
      // O relógio da tela anda a cada 30 s: nunca mostra mais que 24 h / 30 dias.
      const t = Math.max(now, at);
      if (reserved.some(r => r.id === id)) return { kind: 'pending', hoursLeft: Math.max(1, Math.ceil((at + INVITE_HOLD_MS - t) / HOUR)) };
      return { kind: 'cooldown', daysLeft: Math.max(1, Math.ceil((at + INVITE_COOLDOWN_MS - t) / DAY)) };
    },
    invite: (id, name, fee) => {
      const at = invites[id];
      if (at != null && Date.now() - at < INVITE_COOLDOWN_MS) return; // sem insistência: 30 dias
      setInvites(m => ({ ...m, [id]: Date.now() }));
      setReserved(r => [{ id, to: name, amt: fee, at: Date.now() }, ...r]);
    },
    settleInvite: id => {
      // Aceito dentro das 24 h (reservado) ou chegando depois da devolução local (devolvido): vira pago.
      const r = reserved.find(x => x.id === id) ?? refunded.find(x => x.id === id);
      if (!r) return;
      setReserved(rs => rs.filter(x => x.id !== id));
      setRefunded(rf => rf.filter(x => x.id !== id));
      setSpent(sp => [{ ...r, at: Date.now() }, ...sp]);
    },
    recordEarned: (from, fee) => setEarned(e => [{ from, amt: fee, at: Date.now() }, ...e]),
    myFee, setMyFee,
  }), [onchain, lunesAddress, setLunesAddress, ownAddress, externalAddress, nativeWalletReady, canSign, canSignAddress, useOwnWallet, quoteTransfer, sendTransfer, pendingTransfer, transferRecoveryBlocked, refreshTransfer, retryTransfer, onchainSnap, onchainStatus, refreshOnchain, historySnap, historyStatus, refreshHistory, reserved, refunded, spent, earned, since, visible, visibleUntil, now, invites, myFee, setVisibleUntil, setInvites, setReserved, setRefunded, setSpent, setMyFee, setEarned]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWallet fora de WalletProvider');
  return w;
}
