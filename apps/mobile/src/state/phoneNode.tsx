/**
 * Modo nó do celular (docs/economia/no-celular.md §7): API das telas M1…M6e
 * (design/handoff/docs/TELAS-NOVAS.md). Regras em lib/phoneNodeCore.ts; estado em lib/phoneNodeStore.ts;
 * efeitos que valem em qualquer tela (certificado do dia, registro, devolução, aviso aos contatos)
 * em state/phoneNodeEffects.ts. Nenhum texto de tela aqui: as telas montam as frases pelo i18n.
 *
 * Erros das ações saem como `PhoneNodeError` com `code` estável, para a tela escolher o texto.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { router, type Href } from 'expo-router';
import { Paths } from 'expo-file-system';
import { toHex } from '../protocol/bytes';
import { bondOwnerMessage, dayOfSec, makeEndorsement } from '../protocol/phoneNode';
import { useBattery, useLowPower } from '../lib/battery';
import {
  activate as activateCore, bind, BOND_ADDRESS, bondAffordable, bondBlock, bondFromTransfer, bondPhase, bondSent, register, cancelExit as cancelExitCore, certBar, dismissRequest, dropFailedBond,
  eligibleEndorsers, endorseBlock, ENDORSE_REQUEST_TTL_SEC, estimateCredits, givenThisMonth, leave as leaveCore, NODE_MODE_LIMITS, pauseReason, PHONE_NODE_BOND,
  PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH, PHONE_NODE_MIN_ENDORSEMENTS, PHONE_NODE_REWARDS_ON, phoneNodeStatus, recordAsked, recordGiven, refundStatus,
  registryFileName, registryFileOf, requestState, requirementsOf, requirementsOk, revokeGiven,
} from '../lib/phoneNodeCore';
import { PhoneNodeError, type PhoneNodeErrorCode } from '../lib/phoneNodeErrors';
import { getPhoneNode, subscribePhoneNode, updatePhoneNode } from '../lib/phoneNodeStore';
import { readPersisted, usePersisted } from '../lib/persist';
import { signWithWalletKey, withWalletKey } from '../lib/walletKey';
import type { WalletQuote, WalletTransferRecord } from '../lib/walletTransfer';
import { useKeys } from './keys';
import { chatIdFor, useMessaging } from './messaging';
import { useNetwork } from './network';
import { issueTodayCert, useRelayBattery } from './phoneNodeEffects';
import { useSettings } from './settings';
import { useStore } from './store';
import { useTransport } from './transport';
import { useWallet } from './wallet';

const nowSec = () => Math.floor(Date.now() / 1000);
const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));

export { PhoneNodeError, type PhoneNodeErrorCode };
/** Último compartilhamento do arquivo de registro (s) — N7b some depois de compartilhar a saída. */
const SHARED_KEY = 'phone.node.registryShared';
/** Evidências já soltas na malha (quantidade) — N10c "nada para enviar". */
const CARRIED_KEY = 'phone.node.evidenceCarried';

function freeBytes(): number | null { try { const n = Paths.availableDiskSpace; return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; } }

export function usePhoneNode() {
  const state = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  const { phoneOperator, nodeKeyFor, walletAddress, unlockPhrase } = useKeys();
  const { quoteTransfer, sendTransfer, pendingTransfer, retryTransfer, refreshTransfer } = useWallet();
  const { phoneNodeMsg } = useMessaging();
  const { chats, verified } = useStore();
  const { relay, battery: userBattery, chargingOnly } = useNetwork();
  const relayBattery = useRelayBattery(userBattery);
  const { bat } = useSettings();
  const { level, charging } = useBattery();
  const lowPower = useLowPower();
  const { peers } = useTransport();
  const phonePk = phoneOperator ? toHex(phoneOperator.pk) : null;
  const need = () => { if (!phoneOperator || !phonePk) throw new PhoneNodeError('noKeys'); return { op: phoneOperator, pk: phonePk }; };
  const now = nowSec();

  /**
   * Assina o vínculo carteira → chave de operador do celular (biometria). Sem ele, o registro não fecha.
   * Piu 11: é o "Confirmar caução" (N4), depois de a transferência finalizar. Biometria trocada (`recover`)
   * volta para a tela decidir (N4d → N4e), sem abrir outra tela por conta própria.
   */
  const ensureBinding = useCallback(async (prompt: string, wallet: string) => {
    const { pk } = need();
    if (!BOND_ADDRESS) throw new PhoneNodeError('soon');
    const s = getPhoneNode();
    if (s.binding && s.binding.wallet === wallet && s.binding.bondAddress === BOND_ADDRESS) return;
    const u = await unlockPhrase(prompt);
    if (u.status === 'recover') throw new PhoneNodeError('recover');
    if (u.status !== 'ok') throw new PhoneNodeError('cancelled');
    const walletAddress = wallet;
    const sig = withWalletKey(u.words, key => {
      if (key.address !== walletAddress) throw new PhoneNodeError('wrongWallet');
      return signWithWalletKey(key, bondOwnerMessage(pk, key.address, BOND_ADDRESS!));
    });
    await updatePhoneNode(x => bind(x, walletAddress, BOND_ADDRESS!, sig));
  }, [phoneOperator, unlockPhrase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── N1 (M1e quando falta requisito) ──
  const requirements = requirementsOf({ bondAddress: BOND_ADDRESS, walletAddress, backupDone: readPersisted<boolean>('set.backupDone') === true, freeBytes: freeBytes(), batterySaver: lowPower });
  /**
   * N1 "Ativar": confere os requisitos e liga o modo (um toque; nada é assinado nem movido). A carteira
   * assina duas vezes depois, cada uma no seu momento: a transferência da caução (N3) e o vínculo (N4).
   */
  const activate = useCallback(async () => {
    need();
    if (!requirementsOk(requirements)) throw new PhoneNodeError('requirements', requirements.filter(r => !r.ok).map(r => r.key).join(','));
    await updatePhoneNode(s => activateCore(s, nowSec()));
  }, [phoneOperator, requirements.map(r => r.ok).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── M2 / M2e1 ──
  /** Cotação da caução (valor + taxa) e se o saldo dá (M2e1 quando `affordable.ok` é falso). */
  const quoteBond = useCallback(async (): Promise<{ quote: WalletQuote; affordable: ReturnType<typeof bondAffordable> }> => {
    if (!BOND_ADDRESS) throw new PhoneNodeError('soon');
    const quote = await quoteTransfer(BOND_ADDRESS, PHONE_NODE_BOND);
    return { quote, affordable: bondAffordable(quote) };
  }, [quoteTransfer]);
  /** N3 "Segure para assinar": paga a caução (biometria do `sendTransfer`); o painel mostra "Caução enviada". */
  const payBond = useCallback(async (o: { quote?: WalletQuote; guard?: () => boolean }): Promise<WalletTransferRecord> => {
    const block = bondBlock(getPhoneNode(), { bondAddress: BOND_ADDRESS, walletAddress });
    if (block) throw new PhoneNodeError(block === 'soon' ? 'soon' : 'bond', block);
    const q = o.quote ?? (await quoteTransfer(BOND_ADDRESS!, PHONE_NODE_BOND));
    if (!bondAffordable(q).ok) throw new PhoneNodeError('insufficient');
    const rec = await sendTransfer(q, o.guard);
    await updatePhoneNode(s => bondSent(s, rec, nowSec()));
    return rec;
  }, [walletAddress, quoteTransfer, sendTransfer]);

  // ── M2b / M2e2 ──
  const bondTransfer = pendingTransfer && state.bond && pendingTransfer.hash === state.bond.txHash ? pendingTransfer : null;
  /**
   * N4 "Confirmar com biometria": com a caução finalizada na rede, a carteira assina o vínculo com a chave
   * deste celular e o registro fecha na hora. Antes de finalizar: `notFinal` (N4b). Biometria cancelada:
   * `cancelled` (N4c). Biometria trocada: `recover` (N4d → N4e).
   */
  const confirmBond = useCallback(async (prompt: string) => {
    const { op } = need();
    const s = getPhoneNode();
    if (s.registration) return;
    const bond = bondFromTransfer(bondTransfer, BOND_ADDRESS);
    if (!s.bond || !bond || bond.txHash !== s.bond.txHash) throw new PhoneNodeError('notFinal');
    await ensureBinding(prompt, bond.wallet);
    await updatePhoneNode(x => (x.registration ? x : register(x, op, bond, nowSec())));
  }, [phoneOperator, bondTransfer, ensureBinding]); // eslint-disable-line react-hooks/exhaustive-deps
  /** M2e2 "Tentar de novo": reenvia os MESMOS bytes assinados (sem nova assinatura). */
  const retryBond = useCallback(async () => { if (bondTransfer) { await retryTransfer(); await refreshTransfer(); } }, [bondTransfer, retryTransfer, refreshTransfer]);
  /** Consulta a rede agora (o app já acompanha sozinho; um recibo de gateway também atualiza a carteira). */
  const refreshBond = useCallback(() => refreshTransfer(), [refreshTransfer]);
  /** Caução que falhou de vez: limpa para pagar de novo. */
  const abandonBond = useCallback(() => updatePhoneNode(s => (bondPhase(s, bondTransfer, nowSec()) === 'failed' ? dropFailedBond(s) : s)), [bondTransfer]);

  // ── M3 / M3v / M3e ──
  const retryCert = useCallback(() => issueTodayCert(phoneOperator, nodeKeyFor), [phoneOperator, nodeKeyFor]);
  const relayInfo = phoneNodeMsg.relay();
  const pause = pauseReason({
    relayOn: relay, batteryLevel: level, charging, batteryPct: relayBattery, chargingOnly,
    dailyExhausted: relayInfo?.reason === 'daily', outOfHours: relayInfo?.reason === 'hours', peers: peers.filter(p => p.connected).length,
  });

  // ── M4 / M4v ──
  const contacts = useMemo(() => chats.filter(c => c.peer && !c.group && c.ident === 'public').map(c => ({ contactId: c.peer!, chatId: c.id, name: c.name, verified: !!verified[c.id] })), [chats, verified]);
  const bondOk = !!state.registration;
  const requestEndorsement = useCallback(async (contactId: string) => {
    const { pk } = need();
    const c = contacts.find(x => x.contactId === contactId);
    if (!c || !eligibleEndorsers(getPhoneNode(), [c], nowSec()).length) throw new PhoneNodeError('notEligible');
    const at = nowSec();
    phoneNodeMsg.request(contactId, pk, { createdAt: at, bondOk });
    await updatePhoneNode(s => recordAsked(s, contactId, at));
  }, [phoneOperator, phoneNodeMsg, contacts, bondOk]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Desiste de um pedido (quem recebeu vê M5e "cancelado"). */
  const cancelRequest = useCallback(async (contactId: string) => {
    const { pk } = need();
    const a = getPhoneNode().asked.find(x => x.contactId === contactId);
    if (!a) return;
    phoneNodeMsg.request(contactId, pk, { createdAt: a.at, bondOk, cancel: true });
    await updatePhoneNode(s => recordAsked(s, contactId, a.at, true));
  }, [phoneOperator, phoneNodeMsg, bondOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── M5 / M5e ──
  /** M5 "Segurar para avalizar": só contato verificado pessoalmente, com pedido válido; o aval afirma a verificação. */
  const endorse = useCallback(async (contactId: string) => {
    const { op, pk } = need();
    const s = getPhoneNode();
    const req = s.requests.find(r => r.contactId === contactId);
    if (!req) throw new PhoneNodeError('endorse', 'noRequest');
    const chat = contacts.find(c => c.contactId === contactId);
    const why = endorseBlock(s, { contactId, phonePk: req.phonePk, verified: !!chat?.verified, request: req }, pk, nowSec());
    if (why) throw new PhoneNodeError('endorse', why);
    const e = makeEndorsement(op, hexToBytes(req.phonePk), dayOfSec(nowSec()), { inPerson: true });
    phoneNodeMsg.endorse(contactId, e);
    await updatePhoneNode(x => recordGiven(x, contactId, e));
  }, [phoneOperator, phoneNodeMsg, contacts]); // eslint-disable-line react-hooks/exhaustive-deps
  /** M5 "Recusar" (sem motivo; nada vai para quem pediu) e M5e "Fechar". */
  const decline = useCallback((contactId: string) => updatePhoneNode(s => dismissRequest(s, contactId)), []);
  const revokeEndorsement = useCallback(async (contactId: string) => { const { op } = need(); await updatePhoneNode(s => revokeGiven(s, op, contactId, nowSec())); }, [phoneOperator]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── M6 / M6b / M6e ──
  /** M6 "Segurar para sair": pedido de saída assinado (a caução volta 7 dias depois, à mão). */
  const leave = useCallback(async () => { const { op } = need(); await updatePhoneNode(s => leaveCore(s, op, nowSec())); }, [phoneOperator]); // eslint-disable-line react-hooks/exhaustive-deps
  /** M6b "Voltar a ser nó": cancela a saída; os dias zeram. */
  const cancelExit = useCallback(async () => { const { op } = need(); await updatePhoneNode(s => cancelExitCore(s, op, nowSec())); }, [phoneOperator]); // eslint-disable-line react-hooks/exhaustive-deps

  const registryFile = useCallback(() => (phoneOperator && nodeKeyFor ? registryFileOf(getPhoneNode(), phoneOperator, nodeKeyFor, nowSec()) : null), [phoneOperator, nodeKeyFor]);

  const hour = Math.floor(now / 3600);
  const derived = useMemo(() => ({
    status: phonePk ? phoneNodeStatus(state, phonePk, now) : null,
    bond: {
      amount: PHONE_NODE_BOND, address: BOND_ADDRESS, block: bondBlock(state, { bondAddress: BOND_ADDRESS, walletAddress }),
      phase: bondPhase(state, bondTransfer, now), transfer: bondTransfer, sentAt: state.bond?.at ?? null,
    },
    certBar: certBar(state, now),
    certError: state.certError ?? null,
    endorsers: eligibleEndorsers(state, contacts, now),
    asked: state.asked.map(a => ({ ...a, chatId: chatIdFor(a.contactId), expiresAt: a.at + ENDORSE_REQUEST_TTL_SEC })),
    requests: state.requests.map(r => {
      const chat = contacts.find(c => c.contactId === r.contactId);
      return {
        ...r, chatId: chatIdFor(r.contactId), name: chat?.name ?? '', state: requestState(r, now),
        block: phonePk ? endorseBlock(state, { contactId: r.contactId, phonePk: r.phonePk, verified: !!chat?.verified, request: r }, phonePk, now) : ('inactive' as const),
      };
    }),
    given: { thisMonth: givenThisMonth(state, now), max: PHONE_NODE_MAX_ENDORSEMENTS_PER_MONTH },
    refund: refundStatus(state, now),
  }), [state, phonePk, walletAddress, bondTransfer, contacts, hour]); // eslint-disable-line react-hooks/exhaustive-deps

  const bound = !!state.binding && !!BOND_ADDRESS && state.binding.bondAddress === BOND_ADDRESS && (!state.bond || state.binding.wallet === state.bond.wallet);
  const [sharedAt, setSharedAt] = usePersisted<number | null>(SHARED_KEY, null);
  const [carriedItems, setCarriedItems] = usePersisted<number | null>(CARRIED_KEY, null);

  return {
    state, phonePk, ...derived, bound,
    /** N7b: a saída assinada ainda não foi compartilhada no arquivo de registro. */
    registryShared: { at: sharedAt, mark: () => setSharedAt(nowSec()) },
    /** N10c: quantas evidências já foram soltas na malha (soltar não é entregar). */
    evidenceCarried: { items: carriedItems, mark: (n: number) => setCarriedItems(n) },
    confirmBond,
    params: { bond: PHONE_NODE_BOND, minEndorsements: PHONE_NODE_MIN_ENDORSEMENTS, dailyBytes: NODE_MODE_LIMITS.dailyBytes, batteryPct: NODE_MODE_LIMITS.batteryPct, rewardsOn: PHONE_NODE_REWARDS_ON },
    requirements, requirementsOk: requirementsOk(requirements),
    pause, relayToday: { bytes: relayInfo?.bytesToday ?? 0, limit: Math.min(bat.traffic * 1024 * 1024, NODE_MODE_LIMITS.dailyBytes) },
    /** Estimativa local (não é dinheiro; com recompensas desligadas, zero LUNES). */
    credits: () => estimateCredits(phoneNodeMsg.credits(), getPhoneNode()),
    activate, quoteBond, payBond, retryBond, refreshBond, abandonBond, retryCert,
    requestEndorsement, cancelRequest, endorse, decline, revokeEndorsement, leave, cancelExit, registryFile,
    registryFileName: () => registryFileName(Date.now()),
  };
}
