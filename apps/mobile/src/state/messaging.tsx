import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { persistNow, readPersisted, usePersisted } from '../lib/persist';
import { accountBalance, LunesOffline, LunesRpc } from '../lib/lunesRpc';
import { readBlockExecution } from '../lib/walletTransfer';
import { sealEvidence, sealRegistry } from '../lib/evidenceCarry';
import type { PhoneRegistryFile } from '../lib/phoneNodeCore';
import { bundleRefHex, CarryKind } from '../protocol/carry';
import { VALIDATOR_PROOF_PK } from '../protocol/proof';
import { checkPaymentTx, judgementText, judgePayment, newPayRequest, type PaidNotice, type PaymentRequest, type PaymentTxCheck, payRequestSummary } from '../lib/paymentRequest';
import { dropChatRoutes, lastRoute, type RouteRec, routeOf } from '../lib/routeCore';
import { Priority } from '../protocol/envelope';
import { initialsOf, nowHM } from '../lib/text';
import { STORED } from '../lib/storedText';
import { type ContactCard, decodeCard, encodeCard } from '../messaging/card';
import { type Contact, Messenger, type NearPeer, type NearRequest } from '../messaging/messenger';
import { canPost, type GroupState } from '../messaging/groups';
import { type AlertCategory, type AlertSeverity, type AlertView, type Vote } from '../messaging/communityAlerts';
import { pointBridge, usePointRuntime } from '../lib/pointBridge';
import type { CreditBook, Credit, Lot } from '../messaging/credits';
import type { EvidenceFile } from '../messaging/evidence';
import type { EndorsementJson } from '../protocol/phoneNode';
import { getPhoneNode, subscribePhoneNode } from '../lib/phoneNodeStore';
import { fromHistorySnapshot } from '../lib/lunesHistory';
import { usePhoneNodeEffects } from './phoneNodeEffects';
import type { AcceptedInvite } from '../messaging/usage';
import { b64url, unb64url } from '../messaging/card';
import { createTestDevice, TEST_DEVICE_PEER, TEST_DEVICE_NAME, type TestDevice } from '../messaging/testDevice';
import type { IdentityKind, PublicIdentity } from '../protocol';
import { getTransport } from '../transport';
import { useSessionRotationEpoch } from '../lib/migrationState';
import { toHex } from '../protocol/bytes';
import { cleanConfirmed, withConfirmed, type ConfirmedAddresses } from '../lib/walletSend';
import type { ProfilePhoto } from '../lib/avatar';
import { attachVirtualPeer } from '../transport/simulated';
import { useKeys } from './keys';
import { useNetwork } from './network';
import { useSettings } from './settings';
import { useStore } from './store';
import { useWallet } from './wallet';
import { DesktopLinkBridge } from '../lib/desktopLinkSession';
import { DesktopPayment } from '../ui/DesktopPayment';
import { onlyLora } from '../lib/loraChat';
import { CallServiceCtx, CallsProvider } from './calls';
import { getMessengerRuntime } from '../core';
import { chatFor, chatForGroup, chatIdFor, chatIdForGroup, deviceChangeText, GROUP_LINK, groupSub, nearChat, type PayCheck, type PayRecord, policyOf, receivedFiles } from '../core/messengerRuntime';

const now = () => Math.floor(Date.now() / 1000);

// Conversas e mensageiro vivem no núcleo (core/): estes nomes continuam saindo daqui para as telas.
export { chatIdFor, chatIdForGroup, deviceChangeText, GROUP_LINK, receivedFiles };
export type { PayCheck, PayRecord };

interface Messaging {
  ready: boolean;
  /** Código do meu cartão (QR) para a identidade em uso; renovado ao gerar um novo. */
  /** `fresh`: revoga o convite anterior dessa identidade e gera outro. */
  myCard: (kind: IdentityKind, fresh?: boolean) => string;
  /** Muda quando um convite meu é usado (o QR precisa ser trocado). */
  inviteEpoch: number;
  /** Lê um código colado ou escaneado. Lança erro com mensagem em português. */
  readCard: (text: string) => ContactCard;
  /** Adiciona o contato e devolve o id da conversa. */
  addFromCard: (card: ContactCard) => string;
  /** Chaves públicas do contato de uma conversa real (para o código de segurança). */
  contactKeys: (chatId: string) => PublicIdentity | null;
  /** Cartão do aparelho de teste (só no transporte simulado). */
  testDeviceCard: (() => string) | null;
  /** Contatos aceitos de uma identidade (para escolher membros). */
  contactsFor: (via: IdentityKind) => { id: string; name: string }[];
  /** Contatos públicos que compartilharam o endereço Lunes (destinatários da Carteira). */
  walletContacts: () => { chatId: string; id: string; name: string; address: string }[];
  /** Carteira: endereço já confirmado de cada conversa (o de um envio concluído), salvo no aparelho. */
  confirmedWallets: ConfirmedAddresses;
  /** Envio concluído para o contato da conversa: esse endereço passa a ser o confirmado. */
  confirmWallet: (chatId: string, address: string) => void;
  /** Estado real de um grupo/canal/comunidade da conversa (ou null). */
  groupOf: (chatId: string) => GroupState | null;
  /** Meu id na identidade usada pelo grupo (para saber se sou admin). */
  myIdIn: (via: IdentityKind) => string;
  createGroup: (o: Parameters<Messenger['createGroup']>[0]) => string;
  groupOps: {
    update: Messenger['updateGroup']; addMembers: Messenger['addMembers']; remove: Messenger['removeMember'];
    setRole: Messenger['setRole']; leave: (gid: string) => void; answerJoin: Messenger['answerJoin'];
    pending: (gid: string) => { id: string; name: string }[];
    joinChild: (communityId: string, childId: string) => void;
    isMember: (gid: string) => boolean;
    /** Posso convidar? (admin, ou membro com "Quem pode convidar: Todos os membros"). */
    canInvite: (gid: string) => boolean;
    /** Link/QR do convite do grupo (7 dias, até 50 usos). */
    inviteLink: (gid: string, fresh?: boolean) => string;
  } | null;
  /** Lê um convite de grupo (`piug:`) e pede para entrar. Devolve o nome do grupo. */
  joinFromLink: (text: string) => string;
  /** Muda quando grupos ou pedidos mudam (para as telas se atualizarem). */
  groupEpoch: number;
  /**
   * Alertas da comunidade (messaging/communityAlerts.ts): publicados e classificados pelos membros,
   * no grupo da própria comunidade. `null` antes das chaves. Erros em português.
   */
  alerts: {
    /** Das minhas comunidades (ou de uma), na ordem da lista. */
    list: (communityId?: string) => AlertView[];
    get: (id: string) => AlertView | null;
    publish: (communityId: string, d: { cat: AlertCategory; sev: AlertSeverity; title: string; text: string; area?: string; durSec: number }) => AlertView;
    vote: (id: string, v: Vote) => AlertView;
    close: (id: string) => AlertView;
    /** Por que não posso publicar agora (limite), ou `null`. */
    limit: (communityId: string) => string | null;
  } | null;
  /** Muda quando um alerta chega, muda de estado ou vence. */
  alertEpoch: number;
  /** Métricas e créditos deste aparelho (null antes das chaves). */
  stats: () => Stats | null;
  /** Arquivo de evidências deste aparelho (formato do validador), ou null antes das chaves. */
  evidence: () => EvidenceFile | null;
  /**
   * Leva pela malha, até um gateway com a caixa do validador, o arquivo de evidências e (se houver) o de
   * registro do modo nó, em partes seladas para a chave do validador. O arquivo manual continua valendo.
   * `bundles`: partes soltas; `0` com `reason` quando não dá (sem chave do validador publicada ou malha
   * ainda subindo). Docs: docs/carteira/transacoes-pela-malha.md.
   */
  carryEvidence: (registry?: PhoneRegistryFile | null) => { bundles: number; reason?: 'no-validator-key' | 'not-ready' };
  /** Modo nó: pedir aval e mandar aval (só contato público aceito; `chatId` da conversa ou id do contato). */
  phoneNodeMsg: {
    request: (contactId: string, phonePk: string, o: { createdAt: number; bondOk: boolean; cancel?: boolean }) => void;
    endorse: (contactId: string, e: EndorsementJson) => void;
    credits: () => Credit[];
    /** Estado da retransmissão (pausa por horário ou limite diário). */
    relay: () => ReturnType<Messenger['relayStatus']> | null;
  };
  /** Troca (ou remove) a foto do perfil público e manda a versão pequena aos contatos públicos. */
  setProfilePhoto: (p: ProfilePhoto | null) => void;
  /** Rota real de uma mensagem (meio, envelope, blocos, prioridade), se houver registro. */
  routeFor: (chatId: string, msgId: string) => RouteRec | undefined;
  /** Última rota da conversa (rodapé e "Última rota" do contato). */
  lastRouteOf: (chatId: string) => RouteRec | undefined;
  /** Os vizinhos de agora são só a malha LoRa (Meshtastic): nenhum outro meio alcança ninguém. */
  onlyLora: boolean;
  /** Prioridade com que a conversa envia (canal com "Prioridade Alta" definida pelo admin). */
  chatPriority: (chatId: string) => Priority;
  /**
   * Apaga a conversa deste aparelho. Conversa direta: o contato sai do mensageiro e a fila para ele é
   * descartada. Grupo ou canal em que ainda participo: sai antes (os admins trocam a chave).
   */
  deleteChat: (chatId: string) => void;
  /**
   * Por perto pela malha: perfis visíveis (só enquanto eu estou visível), pedidos recebidos, convite
   * pago e respostas. `null` antes das chaves.
   */
  nearby: {
    profiles: NearPeer[];
    requests: NearRequest[];
    /** Envia o convite com o texto. Lança erro em português (fora de alcance, 30 dias, texto). */
    invite: (profileId: string, text: string) => { fee: number; name: string };
    /** Aceitar devolve o id da conversa aberta; recusar e bloquear devolvem null. */
    answer: (id: string, a: 'accept' | 'decline' | 'block') => string | null;
    /** Denunciar perfil: some da lista de Por perto neste aparelho. */
    hide: (profileId: string) => void;
  } | null;
  /**
   * Pedidos de pagamento (regra 7.3; lib/paymentRequest.ts). O Piu não envia LUNES: quem pede manda
   * o endereço Lunes dele, quem recebe paga pela própria carteira, e quem pediu confere na Mainnet.
   */
  payments: {
    /** Registro de um pedido pelo id da mensagem (aceita o prefixo `in-`). */
    get: (msgId: string) => PayRecord | undefined;
    /** Cria e envia ao contato da conversa. Devolve o id. Lança erro em português (sem endereço salvo, valor, texto). */
    send: (chatId: string, input: { amount: string; desc: string }) => string;
    /** Reenvia um pedido meu (falha ou expirado na fila), se ainda vale. */
    resend: (id: string) => void;
    /** Quem recebeu avisa que pagou; os hashes são opcionais (0x + 64 hex). */
    markPaid: (id: string, proof: { txHash?: string; blockHash?: string }) => void;
    /** Quem pediu confere na Mainnet (só leitura). Lança erro sem rede. Nunca marca "recebido" sem prova. */
    check: (id: string) => Promise<PayCheck>;
    /** Todos os registros deste aparelho (ex.: endereços Lunes conhecidos dos contatos, na folha Enviar). */
    all: () => PayRecord[];
    /** Muda quando um registro muda. */
    epoch: number;
  };
}

export interface Stats {
  metrics: ReturnType<Messenger['metrics']>;
  credits: { totals: ReturnType<CreditBook['totals']>; list: Credit[]; lots: Lot[] };
  relay: ReturnType<Messenger['relayStatus']>;
  /** Uso real registrado neste aparelho: dias com entrega a 3+ contatos e convites aceitos. */
  usage: { activeDays: number; accepted: AcceptedInvite[] };
}

const Ctx = createContext<Messaging | null>(null);

/**
 * Mensagens reais: as conversas com `peer` são cifradas (Double Ratchet dentro do envelope selado),
 * vão para a fila do roteador e saem pelo transporte para cada vizinho conectado.
 * O estado das sessões é gravado ANTES de qualquer envio: depois de um travamento, uma chave de
 * mensagem nunca é reutilizada.
 */
export function MessagingProvider({ children }: { children: ReactNode }) {
  const { identities, node, nodeKeyFor, phoneOperator } = useKeys();
  const { profile, onboarded, setOutbound, receive, setMsgStatus, addChat, chats, setFileOps, patchChat, setIdentity, blocked, setPreviewMode, setSignals, removeChat } = useStore();
  const { relay: relayOn, relayPaused, storage, gateway: gatewaySetting } = useNetwork();
  // Ponto Piu ativo (state/point.tsx): guardião guarda e repassa com os limites do ponto; nível gateway liga o gateway.
  const pointRt = usePointRuntime();
  const gatewayOn = gatewaySetting || pointRt.gateway;
  const relay = (relayOn && !relayPaused) || pointRt.relay;
  const { priv, sto, bat, preview } = useSettings();
  // Pré-visualização "Nunca" também nos banners dentro do app (store.tsx, showToast).
  useEffect(() => { setPreviewMode(preview); }, [preview, setPreviewMode]);
  const transport = useMemo(getTransport, []);
  // O mensageiro vive no núcleo (core/messengerRuntime.ts): a tela assina; desmontar não descarta nada.
  const rt = useMemo(() => getMessengerRuntime(), []);
  const rs = useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
  const { messenger, call: phoneCall, inviteEpoch, groupEpoch, nearEpoch, alertEpoch, pays, payEpoch, routes } = rs;
  const [testDevice, setTestDevice] = useState<TestDevice | null>(null);
  const wallet = useWallet();
  const { verified } = useStore();
  // Modo nó do celular: limites, certificado do dia, registro, devolução e aviso aos contatos verificados.
  const phoneNode = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  const phoneNodeActive = phoneNode.activeSince !== null && !phoneNode.exit;
  const historyMoves = useMemo(() => (wallet.historySnap ? fromHistorySnapshot(wallet.historySnap).moves : null), [wallet.historySnap]);
  const walletRef = useRef(wallet); walletRef.current = wallet;
  // Endereço Lunes que os contatos públicos recebem (`wa`); `null` com o ajuste desligado.
  const sharedWallet = priv.shareWallet !== false ? wallet.lunesAddress : null;
  const [lastShared, setLastShared] = usePersisted<string | null>('wallet.shared', null);
  // Endereço já confirmado de cada conversa (usado num envio concluído): a folha Enviar avisa quando o contato aparece com outro.
  const [confirmedWallets, setConfirmedWallets] = usePersisted<ConfirmedAddresses>('wallet.confirmed', {}, cleanConfirmed);
  const putPay = rt.putPay;
  const rotationEpoch = useSessionRotationEpoch();
  const { setProfile } = useStore();
  const privRef = useRef(priv); privRef.current = priv;
  const msgToChat = rt.msgToChat;

  // Perfil do backup restaurado e convite pago aceito: são da tela (StoreProvider, WalletProvider).
  useEffect(() => {
    rt.setHost({ importProfile: p => setProfile(p as never), settleInvite: id => walletRef.current.settleInvite(id) });
    return () => rt.setHost({ importProfile: undefined, settleInvite: undefined });
  }, [rt, setProfile]);
  // Desmontar (deslizar o app dos recentes) não para o mensageiro nem a chamada (os alertas são do
  // núcleo); solta só o que depende da tela: a retransmissão pausada pela bateria.
  const pointRelay = useRef(pointRt.relay); pointRelay.current = pointRt.relay;
  useEffect(() => () => rt.detach({ relay: pointRelay.current }), [rt]);
  // Ajustes → mensageiro (política do roteador, bloqueados, descoberta, retransmissão e gateway).
  const blockedIds = useMemo(() => blocked.map(b => b.id).filter(id => id.startsWith('piu:')), [blocked]);
  useEffect(() => {
    rt.setPrefs({
      relay, gateway: gatewayOn, blocked: blockedIds,
      priv: { find: priv.find, read: priv.read, typing: priv.typing, temp: priv.temp, delay: priv.delay, pad: priv.pad, noRoutes: priv.noRoutes },
      policy: policyOf({ storageMb: storage, retentionH: Number(sto.retention), trafficMb: bat.traffic, bw: bat.bw, hours: bat.hours, custom: bat.custom, phoneNodeActive, point: pointRt }),
    });
  }, [rt, relay, gatewayOn, blockedIds, priv.find, priv.read, priv.typing, priv.temp, priv.delay, priv.pad, priv.noRoutes, storage, sto.retention, bat.traffic, bat.bw, bat.hours, bat.custom, phoneNodeActive, pointRt]);
  // Cria o mensageiro quando as chaves existem; as mesmas chaves (a tela remontou) mantêm o mesmo.
  useEffect(() => {
    rt.start(identities && node && onboarded ? { identities, node, nodeKeyFor, phonePk: phoneOperator ? toHex(phoneOperator.pk) : null, rotation: rotationEpoch } : null);
  }, [rt, identities, node, nodeKeyFor, onboarded, rotationEpoch, phoneOperator]);

  /** Lê o saldo livre do endereço na Mainnet, uma vez, para servir de base ao pedido criado agora. */
  const readBaseline = useCallback(async (id: string, address: string) => {
    const rpc = new LunesRpc();
    try {
      const b = await accountBalance(rpc, address);
      const cur = rt.getSnapshot().pays[id];
      // Só se ainda não há base nem conferência: uma base lida depois de pagar marcaria como "nada".
      if (cur && cur.baseline == null && !cur.check && !cur.paid) rt.putPay({ ...cur, baseline: b.free.toString() });
    } catch { /* sem rede: a conferência pelo saldo fica indisponível; pelo hash continua */ } finally { rpc.close(); }
  }, [rt]);

  /** Pedido meu: envia pela sessão e acompanha os estados como uma mensagem. */
  const sendPay = useCallback((rec: PayRecord, r: PaymentRequest, peer: string) => {
    const m = rt.messenger();
    if (!m) throw new Error('As chaves ainda estão carregando.');
    const ct = m.getContact(peer);
    if (ct?.request) m.addContact(ct); // pedir aceita o pedido de conversa, como responder
    msgToChat.set(r.id, rec.chatId);
    m.sendPayRequest(peer, r);
  }, [rt, msgToChat]);

  const verifiedContacts = useMemo(() => chats.filter(c => verified[c.id] && c.peer && !c.group).map(c => c.peer!), [chats, verified]);
  usePhoneNodeEffects({
    phoneOperator, nodeKeyFor, pendingTransfer: wallet.pendingTransfer, historyMoves, verifiedContacts,
    sendNodeStatus: messenger ? (id, since) => messenger.sendNodeStatus(id, since) : null,
  });
  // Ponto Piu: contagem do que é de terceiros e "encerrar apaga o que o ponto guarda" (lib/pointBridge.ts).
  useEffect(() => {
    if (!messenger) return;
    pointBridge.setHandlers({ stored: () => messenger.router.thirdPartyStats(), dropThirdParty: () => messenger.router.dropThirdParty() });
    return () => pointBridge.setHandlers(null);
  }, [messenger]);
  // Armazenamento → "Baixar mídia automaticamente".
  useEffect(() => { messenger?.setAutoDownload(sto.auto); }, [messenger, sto.auto]);
  // Endereço Lunes para os contatos públicos: manda quando muda (ou quando o ajuste muda), uma vez.
  // Contato novo recebe na hora em que entra (addFromCard / Por perto).
  useEffect(() => {
    if (!messenger || sharedWallet === lastShared) return;
    try { messenger.sendWalletAddress(sharedWallet); setLastShared(sharedWallet); } catch { /* endereço inválido: não compartilha */ }
  }, [messenger, sharedWallet, lastShared, setLastShared]);
  useEffect(() => { if (messenger) messenger.displayName = profile.idType === 'public' ? profile.name.trim() : ''; }, [messenger, profile]);
  // Por perto: anúncio de presença só enquanto visível (até o fim da 1 h), com o perfil PÚBLICO
  // (nome e foto pequena) e a minha taxa. Invisível = retirada do anúncio.
  const { visibleUntil, myFee } = wallet;
  useEffect(() => {
    messenger?.setNearby({ until: visibleUntil ? Math.floor(visibleUntil / 1000) : null, fee: myFee, name: profile.name.trim(), photo: profile.photoSmall });
    rt.bump('near');
  }, [rt, messenger, visibleUntil, myFee, profile.name, profile.photoSmall]);

  // Store → mensageiro (arquivos reais).
  useEffect(() => {
    if (!messenger) { setFileOps(null); return; }
    setFileOps({
      send: (chatId, peer, msgId, f, expireSec) => {
        try { msgToChat.set(msgId, chatId); return messenger.sendFile(peer, msgId, f, expireSec); } catch { return null; }
      },
      setPaused: (msgId, paused) => messenger.setFilePaused(msgId, paused),
      download: (peer, msgId) => messenger.downloadFile(peer, msgId),
    });
    return () => setFileOps(null);
  }, [messenger, setFileOps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store → mensageiro (envio real).
  useEffect(() => {
    if (!messenger) { setOutbound(null); return; }
    setOutbound((chatId, peer, msgId, text, expireSec, loc) => {
      try {
        // Responder aceita o pedido de conversa.
        const ct = messenger.getContact(peer);
        if (ct?.request) messenger.addContact(ct);
        msgToChat.set(msgId, chatId);
        if (peer.startsWith('group:')) messenger.sendGroupText(peer.slice(6), msgId, text, loc);
        else messenger.sendText(peer, msgId, text, expireSec, loc);
        return true;
      } catch { return false; }
    });
    return () => setOutbound(null);
  }, [messenger, setOutbound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store → mensageiro: confirmação de leitura e "digitando…", só com o ajuste de Privacidade ligado.
  useEffect(() => {
    if (!messenger) { setSignals(null); return; }
    setSignals({
      read: (_chatId, peer, ids) => { if (privRef.current.read) messenger.sendRead(peer, ids); },
      typing: (_chatId, peer) => { if (privRef.current.typing) messenger.sendTyping(peer); },
    });
    return () => setSignals(null);
  }, [messenger, setSignals]);

  // Aparelho de teste: só no transporte simulado (navegador / Expo Go).
  useEffect(() => {
    if (transport.kind !== 'sim' || !messenger) return;
    const td = createTestDevice(now, readPersisted<string>('msg.testDevice'), s => { void persistNow('msg.testDevice', s).catch(() => {}); });
    td.messenger.peerConnected('app', 'ble');
    const detach = attachVirtualPeer({
      id: TEST_DEVICE_PEER, name: TEST_DEVICE_NAME,
      receive: (data, reply) => { td.setReply(reply); td.messenger.receive('app', data); },
    });
    setTestDevice(td);
    return () => { detach(); td.stop(); setTestDevice(null); };
  }, [transport, messenger]);

  const lora = onlyLora(rs.linkMedia);
  const value = useMemo<Messaging>(() => ({
    ready: !!messenger,
    myCard: (kind, fresh) => (identities && messenger ? encodeCard(identities[kind], kind === 'public' ? profile.name : '', messenger.issueInvite(kind, fresh)) : ''),
    inviteEpoch,
    readCard: text => decodeCard(text, now()),
    addFromCard: card => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const via: IdentityKind = card.kind; // anônima conversa com anônima, pública com pública
      const contact: Contact = { id: card.id, via, pub: card.pub, name: card.name, invite: card.invite };
      messenger.addContact(contact);
      const cid = chatIdFor(card.id);
      addChat(chatFor(contact, false, priv.temp));
      // Contato público novo: recebe a foto do perfil público (o anônimo nunca recebe foto).
      if (via === 'public' && profile.photoSmall) messenger.sendProfilePhoto(profile.photoSmall, card.id);
      if (via === 'public' && sharedWallet) messenger.sendWalletAddress(sharedWallet, card.id);
      return cid;
    },
    setProfilePhoto: p => {
      setProfile({ photo: p?.full ?? null, photoSmall: p?.small ?? null });
      messenger?.sendProfilePhoto(p?.small ?? null);
    },
    contactKeys: chatId => {
      const peer = chats.find(c => c.id === chatId)?.peer;
      return (peer && messenger?.getContact(peer)?.pub) || null;
    },
    testDeviceCard: testDevice ? testDevice.card : null,
    confirmedWallets,
    confirmWallet: (chatId, address) => setConfirmedWallets(m => withConfirmed(m, chatId, address, chats.map(c => c.id))),
    walletContacts: () => (messenger ? messenger.listContacts()
      .filter(c => c.via === 'public' && !c.request && !!c.lunes)
      .map(c => ({ chatId: chatIdFor(c.id), id: c.id, name: c.name || c.id.slice(4, 8).toUpperCase(), address: c.lunes! })) : []),
    contactsFor: via => (messenger ? messenger.listContacts().filter(c => c.via === via && !c.request).map(c => ({ id: c.id, name: c.name || c.id.slice(4, 8).toUpperCase() })) : []),
    groupOf: chatId => {
      const gid = chats.find(c => c.id === chatId)?.group;
      return (gid && messenger?.getGroup(gid)) || null;
    },
    myIdIn: via => identities?.[via].id ?? '',
    createGroup: o => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const g = messenger.createGroup(o);
      addChat(chatForGroup(g, identities![o.via].id));
      setIdentity(o.via);
      rt.bump('group');
      return chatIdForGroup(g.id);
    },
    groupOps: messenger ? {
      update: (gid, p) => { const g = messenger.updateGroup(gid, p); rt.bump('group'); patchChat(chatIdForGroup(gid), { name: g.name, initials: initialsOf(g.name), sub: groupSub(g), owner: canPost(g, identities![g.via].id) || undefined }); return g; },
      addMembers: (gid, ids) => { const g = messenger.addMembers(gid, ids); rt.bump('group'); patchChat(chatIdForGroup(gid), { sub: groupSub(g) }); return g; },
      remove: (gid, id) => { const g = messenger.removeMember(gid, id); rt.bump('group'); patchChat(chatIdForGroup(gid), { sub: groupSub(g) }); return g; },
      setRole: (gid, id, role) => { const g = messenger.setRole(gid, id, role); rt.bump('group'); return g; },
      leave: gid => { messenger.leaveGroup(gid); rt.bump('group'); },
      answerJoin: (gid, id, ok) => { messenger.answerJoin(gid, id, ok); rt.bump('group'); },
      pending: gid => messenger.pendingJoinsOf(gid),
      joinChild: (comId, childId) => messenger.requestJoinChild(comId, childId),
      isMember: gid => !!messenger.getGroup(gid),
      canInvite: gid => messenger.canInvite(gid),
      inviteLink: (gid, fresh) => {
        const g = messenger.getGroup(gid)!;
        const inv = messenger.groupInvite(gid, fresh);
        if (fresh) rt.bump('group');
        // O link leva o meu cartão (assinado, com o código do convite) e o id do grupo.
        const card = encodeCard(identities![g.via], g.via === 'public' ? profile.name : '', { code: inv.code, expiresAt: inv.expiresAt });
        return GROUP_LINK + b64url(new TextEncoder().encode(JSON.stringify({ c: card, g: g.id, n: g.name, k: g.kind })));
      },
    } : null,
    joinFromLink: text => {
      if (!messenger) throw new Error('As chaves ainda estão carregando.');
      const t = text.trim();
      if (!t.startsWith(GROUP_LINK)) throw new Error('Isto não é um convite de grupo do Piu.');
      let j: { c?: string; g?: string; n?: string; k?: string };
      try { j = JSON.parse(new TextDecoder().decode(unb64url(t.slice(GROUP_LINK.length)))); } catch { throw new Error('Convite incompleto ou corrompido.'); }
      if (typeof j.c !== 'string' || typeof j.g !== 'string' || !/^[0-9a-f]{32}$/.test(j.g)) throw new Error('Convite incompleto ou corrompido.');
      const card = decodeCard(j.c, now()); // assinatura e validade (7 dias) conferidas aqui
      if (messenger.getGroup(j.g)) throw new Error('Você já participa deste grupo.');
      messenger.requestJoin({ id: card.id, via: card.kind, pub: card.pub, name: card.name }, j.g, card.invite);
      return String(j.n ?? 'grupo').slice(0, 60);
    },
    groupEpoch,
    alerts: messenger ? {
      list: gid => messenger.communityAlerts(gid),
      get: id => messenger.communityAlert(id),
      publish: (gid, d) => { const v = messenger.publishAlert(gid, d); rt.bump('alert'); return v; },
      vote: (id, v) => { const out = messenger.voteAlert(id, v); rt.bump('alert'); return out; },
      close: id => { const out = messenger.closeAlert(id); rt.bump('alert'); return out; },
      limit: gid => messenger.alertLimit(gid),
    } : null,
    alertEpoch,
    nearby: messenger ? {
      profiles: messenger.nearbyProfiles(),
      requests: messenger.nearRequests(),
      invite: (profileId, text) => {
        const r = messenger.sendNearInvite(profileId, text);
        rt.bump('near');
        return { fee: r.fee, name: r.name };
      },
      answer: (id, a) => {
        const r = messenger.answerNear(id, a);
        rt.bump('near');
        if (!r) return null;
        const cid = chatIdFor(r.contact.id);
        if (!chats.some(x => x.id === cid)) addChat(nearChat(r.contact, priv.temp, STORED.sysNearYou, r.request.msg));
        setIdentity('public');
        wallet.recordEarned(r.request.name, r.request.fee);
        if (profile.photoSmall) messenger.sendProfilePhoto(profile.photoSmall, r.contact.id);
        if (sharedWallet) messenger.sendWalletAddress(sharedWallet, r.contact.id);
        return cid;
      },
      hide: id => messenger.hideNear(id),
    } : null,
    routeFor: (chatId, msgId) => routeOf(routes, chatId, msgId),
    lastRouteOf: chatId => lastRoute(routes, chatId),
    onlyLora: lora,
    chatPriority: chatId => {
      const gid = chats.find(c => c.id === chatId)?.group;
      return gid && messenger ? messenger.groupPriority(gid) : Priority.Normal;
    },
    deleteChat: chatId => {
      const ch = chats.find(c => c.id === chatId);
      if (!ch) return;
      if (ch.peer) messenger?.removeContact(ch.peer);
      if (ch.group && messenger?.getGroup(ch.group)) { messenger.leaveGroup(ch.group); rt.bump('group'); }
      for (const [k, v] of msgToChat) if (v === chatId) msgToChat.delete(k);
      rt.setRoutes(b => dropChatRoutes(b, chatId));
      removeChat(chatId);
    },
    stats: () => (messenger ? {
      metrics: messenger.metrics(), credits: { totals: messenger.credits.totals(), list: messenger.credits.list().slice(0, 30), lots: messenger.credits.lots }, relay: messenger.relayStatus(),
      usage: { activeDays: messenger.deliveryDays.activeDays(), accepted: messenger.acceptedInvites() },
    } : null),
    evidence: () => (messenger ? messenger.evidence() : null),
    carryEvidence: registry => {
      if (!VALIDATOR_PROOF_PK) return { bundles: 0, reason: 'no-validator-key' };
      if (!messenger) return { bundles: 0, reason: 'not-ready' };
      const sealed = [...sealEvidence(messenger.evidence(), VALIDATOR_PROOF_PK), ...sealRegistry(registry ?? null, VALIDATOR_PROOF_PK)];
      for (const b of sealed) messenger.carry({ kind: CarryKind.Evidence, sealed: b }, bundleRefHex(b));
      return { bundles: sealed.length };
    },
    phoneNodeMsg: {
      request: (contactId, phonePk, o) => { if (!messenger) throw new Error('Mensageiro não iniciou.'); messenger.requestEndorsement(contactId, phonePk, o); },
      endorse: (contactId, e) => { if (!messenger) throw new Error('Mensageiro não iniciou.'); messenger.sendEndorsement(contactId, e); },
      credits: () => (messenger ? messenger.credits.list() : []),
      relay: () => (messenger ? messenger.relayStatus() : null),
    },
    payments: {
      get: msgId => pays[msgId.replace(/^in-/, '')],
      send: (chatId, input) => {
        const chat = chats.find(c => c.id === chatId);
        if (!chat?.peer) throw new Error('Pedido de pagamento só em conversa com uma pessoa.');
        const address = wallet.lunesAddress;
        const r = newPayRequest({ address, amount: input.amount, desc: input.desc, now: now() });
        const snap = wallet.onchainSnap;
        const rec: PayRecord = { id: r.id, chatId, dir: 'out', address: r.address, planck: r.planck?.toString() ?? null, desc: r.desc, createdAt: r.createdAt, expiresAt: r.expiresAt,
          baseline: snap && snap.address === r.address ? snap.free : null };
        putPay(rec);
        receive(chatId, { id: r.id, from: 'me', text: payRequestSummary(r), time: nowHM(), status: 'criada', at: Date.now() });
        try { sendPay(rec, r, chat.peer); setMsgStatus(chatId, r.id, 'aguardando'); } catch { setMsgStatus(chatId, r.id, 'falha'); }
        if (rec.baseline == null) void readBaseline(r.id, r.address);
        return r.id;
      },
      resend: id => {
        const rec = pays[id];
        const chat = rec && chats.find(c => c.id === rec.chatId);
        if (!rec || rec.dir !== 'out' || !chat?.peer) return;
        if (rec.expiresAt <= now()) { setMsgStatus(rec.chatId, id, 'falha'); throw new Error('Este pedido venceu. Crie outro.'); }
        const r: PaymentRequest = { id: rec.id, address: rec.address, planck: rec.planck != null ? BigInt(rec.planck) : null, desc: rec.desc, createdAt: rec.createdAt, expiresAt: rec.expiresAt };
        try { sendPay(rec, r, chat.peer); setMsgStatus(rec.chatId, id, 'aguardando'); } catch { setMsgStatus(rec.chatId, id, 'falha'); }
      },
      markPaid: (id, proof) => {
        const rec = pays[id];
        const chat = rec && chats.find(c => c.id === rec.chatId);
        if (!rec || rec.dir !== 'in' || !chat?.peer || !messenger) throw new Error('Pedido não encontrado.');
        const n: PaidNotice = { id, ...(proof.txHash ? { txHash: proof.txHash.toLowerCase() } : {}), ...(proof.blockHash ? { blockHash: proof.blockHash.toLowerCase() } : {}) };
        messenger.sendPaid(chat.peer, n);
        putPay({ ...rec, paid: { ...(n.txHash ? { txHash: n.txHash } : {}), ...(n.blockHash ? { blockHash: n.blockHash } : {}), at: Date.now() } });
      },
      check: async id => {
        const rec = pays[id];
        if (!rec || rec.dir !== 'out') throw new Error('Pedido não encontrado.');
        const rpc = new LunesRpc();
        try {
          const b = await accountBalance(rpc, rec.address);
          // Com o hash do bloco (e da transação, se veio), confere a transação dentro dele: destino e valor
          // pelos bytes do extrínseco, execução pelo indexador (o hash sozinho não prova este pedido).
          const blockHash = rec.paid?.blockHash;
          let tx: PaymentTxCheck | undefined = blockHash ? await checkPaymentTx(rpc, { blockHash, ...(rec.paid?.txHash ? { txHash: rec.paid.txHash } : {}) }) : undefined;
          if (tx && blockHash && tx.extrinsic && tx.finalized && tx.blockNumber != null && tx.txIndex != null && tx.txIndex >= 0) {
            tx = { ...tx, executed: (await readBlockExecution({ number: tx.blockNumber, hash: blockHash, index: tx.txIndex })).ok };
          }
          const j = judgePayment({ planck: rec.planck != null ? BigInt(rec.planck) : null, baseline: rec.baseline != null ? BigInt(rec.baseline) : null, free: b.free, address: rec.address, tx });
          const check: PayCheck = { at: Date.now(), block: b.block, state: j.state, text: judgementText(j) };
          const cur = rt.getSnapshot().pays[id] ?? rec;
          // Sem base e sem prova: a leitura de agora vira a base, para a próxima conferência comparar.
          putPay({ ...cur, check, ...(cur.baseline == null && j.state === 'indeterminado' && j.reason === 'sem-base' ? { baseline: b.free.toString() } : {}) });
          return check;
        } catch (e) {
          if (e instanceof LunesOffline) throw new Error('Sem rede até a Lunes Mainnet: não deu para conferir agora.');
          throw e instanceof Error ? e : new Error('Falha na consulta.');
        } finally { rpc.close(); }
      },
      all: () => Object.values(pays),
      epoch: payEpoch,
    },
  }), [messenger, identities, profile.name, profile.photoSmall, setProfile, chats, addChat, testDevice, inviteEpoch, groupEpoch, nearEpoch, alertEpoch, patchChat, setIdentity, priv.temp, wallet, routes, removeChat, pays, payEpoch, putPay, receive, setMsgStatus, sendPay, readBaseline, sharedWallet, lora, confirmedWallets, setConfirmedWallets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ponte com o Piu Desktop (lib/desktopLinkSession.ts): snapshot, eventos e comandos pelo store.
  return (
    <Ctx.Provider value={value}>
      <CallServiceCtx.Provider value={phoneCall}><CallsProvider chats={chats} onlyLora={lora}>{children}</CallsProvider></CallServiceCtx.Provider>
      <DesktopLinkBridge /><DesktopPayment />
    </Ctx.Provider>
  );
}

export function useMessaging(): Messaging {
  const m = useContext(Ctx);
  if (!m) throw new Error('useMessaging fora de MessagingProvider');
  return m;
}

/**
 * Meu cartão (QR) para a identidade `kind`. Uso único: troca sozinho depois que alguém o usa.
 * Conferido a cada minuto (vale 24 h; troca quando faltar menos de 1 h). `bump` revoga e gera outro.
 */
export function useMyCard(kind: IdentityKind): [string, () => void] {
  const { myCard, ready, inviteEpoch } = useMessaging();
  const [tick, setTick] = useState(0);
  const fresh = useRef(false);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60_000); return () => clearInterval(t); }, []);
  const card = useMemo(() => {
    if (!ready) return '';
    const f = fresh.current; fresh.current = false;
    return myCard(kind, f);
  }, [ready, myCard, kind, tick, inviteEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
  return [card, () => { fresh.current = true; setTick(x => x + 1); }];
}

/** Métricas e créditos atualizados a cada `ms` (padrão 2 s), para as telas de diagnóstico e carteira. */
export function useStats(ms = 2000): Stats | null {
  const { stats } = useMessaging();
  const [v, setV] = useState<Stats | null>(() => stats());
  useEffect(() => {
    setV(stats());
    const t = setInterval(() => setV(stats()), ms);
    return () => clearInterval(t);
  }, [stats, ms]);
  return v;
}
