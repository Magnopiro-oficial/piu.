/**
 * Conversas (protótipo `isChatsNav`): lista 320px (busca ⌘K, filtros), conversa (cabeçalho 64px,
 * bolhas com estado, compositor 44px) e painel de detalhes 320px (rota da mensagem, código de
 * segurança, mensagens temporárias, remover). Sem dados de exemplo: estados vazios.
 */
import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary, MeInfo, Message, NetworkStatus, Prefs, TempMode } from '../../shared/types';
import { canSendToConversation, conversationKind, filterConversationKind } from '../../shared/conversations';
import { type DialogSpec, F, FM, Sym, fmtTime, initialsOf, shortId } from '../ui';
import { type Key, t as tNow, useT } from '../i18n';
import { CallBadge, CallButton, CallLayer, CallRecordCard, CallRequestCard, declineDraft, inCall, onStage, useCallHost, useCallKeys } from '../call';
import { useTr } from '../call/CallContext';
import { contactOf, recordCard, requestCard } from '../../../../mobile/src/calls/callView';

type Filter = 'all' | 'direct' | 'group' | 'channel';
const TEMP_LABEL: Record<TempMode, Key> = { off: 'chats.temp.off', '1h': 'chats.temp.1h', '24h': 'chats.temp.24h', '7d': 'chats.temp.7d' };

interface Props {
  me: MeInfo; prefs: Prefs; net: NetworkStatus | null;
  /** Espelhando o celular vinculado: as conversas são dele; chaves e contatos ficam lá. */
  linked?: boolean;
  toast: (text: string, icon?: string) => void;
  setDialog: Dispatch<SetStateAction<DialogSpec | null>>;
  onConversationOpen: (open: boolean) => void;
  /** Evento externo (⌘K) para focar a busca; ⌘I alterna detalhes. */
  bus: EventTarget;
  /** Botão "Enviar LUNES" da conversa: abre a Carteira em Enviar com este contato pré-selecionado. */
  onPay: (contactId: string) => void;
  /** Nome da conversa aberta (ou null), para o título da janela. */
  onTitle?: (name: string | null) => void;
  /** macOS (atalhos com ⌘) ou Linux/Windows (Ctrl), pela plataforma da sessão. */
  mac?: boolean;
  /** Avisos no fim da lista (atualização pronta, disco quase cheio). */
  footer?: ReactNode;
  /** Recusou uma chamada com "Mensagem": abrir a conversa de `peer` com o rascunho pronto; `onDraftDone` ao aplicar. */
  draftFor?: { peer: string; seq: number } | null;
  onDraftDone?: () => void;
}

const statusIcon: Record<Message['status'], string> = { criada: 'radio_button_unchecked', aguardando: 'schedule', encaminhada: 'check', entregue: 'done_all', expirada: 'error', recebida: '' };
const statusLabel: Record<Message['status'], Key | null> = { criada: 'chats.status.criada', aguardando: 'chats.status.aguardando', encaminhada: 'chats.status.encaminhada', entregue: 'chats.status.entregue', expirada: 'chats.status.expirada', recebida: null };

/** Ícone do tipo ao lado do nome na lista (protótipo `kindIcon`). */
const kindIcon: Record<string, string> = { group: 'group', channel: 'campaign', community: 'groups' };
/** Avatar: círculo para pessoas; quadrado arredondado para grupos e canais (13px pequeno, 24px grande). */
const avRadius = (c: ConversationSummary['contact'], large = false) => (conversationKind(c) === 'direct' ? '50%' : large ? 24 : 13);

const nameOf = (c: ConversationSummary['contact']) => c.name || tNow(c.via === 'anon' ? 'chats.contact.anon' : 'chats.contact.unnamed', { id: shortId(c.id) });

export function Chats({ me, prefs, net, linked = false, toast, setDialog, onConversationOpen, bus, onPay, onTitle, mac = false, footer, draftFor = null, onDraftDone }: Props) {
  const t = useT();
  const [all, setAll] = useState<ConversationSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [routeMsg, setRouteMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [safety, setSafety] = useState<string[]>([]);
  /** Quem está digitando agora (id → até quando, ms); o sinal vale poucos segundos. */
  const [typingUntil, setTypingUntil] = useState<Record<string, number>>({});
  const lastTyping = useRef(0);
  const [pasteCode, setPasteCode] = useState('');
  /** Busca dentro da conversa aberta (Detalhes → Buscar): `null` fechada; só filtra o que já está neste computador. */
  const [find, setFind] = useState<string | null>(null);
  useEffect(() => setFind(null), [active]);
  const fresh = useRef(new Set<string>());
  const mounted = useRef(Date.now() / 1000);
  const scrollEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const composeEl = useRef<HTMLInputElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const reload = useCallback(() => { void window.piu.listConversations().then(setAll); }, []);
  useEffect(() => {
    reload();
    const off = window.piu.on('conversations', reload);
    const offM = window.piu.on('message', ({ contactId, message }) => {
      if (contactId !== activeRef.current) return;
      if (message.dir === 'in' && message.at >= mounted.current) fresh.current.add(message.id);
      setMsgs(ms => { const i = ms.findIndex(m => m.id === message.id); if (i < 0) return [...ms, message]; const c = [...ms]; c[i] = message; return c; });
      // Só conta como lida (e só sai recibo de leitura) com a janela em foco; senão, ao voltar o foco.
      if (message.dir === 'in') setTypingUntil(t => { if (!t[contactId]) return t; const n = { ...t }; delete n[contactId]; return n; });
      if (document.hasFocus()) void window.piu.markRead(contactId);
    });
    const offT = window.piu.on('typing', ({ contactId }) => setTypingUntil(t => ({ ...t, [contactId]: Date.now() + 6000 })));
    const onFocus = () => { if (activeRef.current) void window.piu.markRead(activeRef.current); };
    window.addEventListener('focus', onFocus);
    return () => { off(); offM(); offT(); window.removeEventListener('focus', onFocus); };
  }, [reload]);
  // "digitando…" some sozinho.
  useEffect(() => {
    const ids = Object.keys(typingUntil);
    if (!ids.length) return;
    const t = setTimeout(() => setTypingUntil(cur => Object.fromEntries(Object.entries(cur).filter(([, until]) => until > Date.now()))), Math.max(200, Math.min(...Object.values(typingUntil)) - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  useEffect(() => {
    onConversationOpen(!!active);
    setRouteMsg(null); setDraft('');
    if (!active) { setMsgs([]); setSafety([]); return; }
    void window.piu.getMessages(active).then(setMsgs);
    if (document.hasFocus()) void window.piu.markRead(active);
    if (linked || active.startsWith('group:')) setSafety([]); else void window.piu.safetyCode(active).then(setSafety).catch(() => setSafety([]));
  }, [active, onConversationOpen, linked]);
  useEffect(() => () => onConversationOpen(false), [onConversationOpen]);
  useEffect(() => { const el = scrollEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, active]);

  // Atalhos vindos do App: ⌘K foca a busca, ⌘I alterna os detalhes.
  useEffect(() => {
    const onK = () => searchEl.current?.focus();
    const onI = () => { if (activeRef.current) setInfoOpen(o => !o); };
    const step = (d: number) => () => {
      const ids = listRef.current.map(c => c.contact.id);
      if (!ids.length) return;
      const i = activeRef.current ? ids.indexOf(activeRef.current) : -1;
      setActive(ids[i < 0 ? (d > 0 ? 0 : ids.length - 1) : (i + d + ids.length) % ids.length]!);
    };
    const onNext = step(1), onPrev = step(-1), onNew = () => newRef.current();
    const onMute = () => muteRef.current();
    const evs: [string, () => void][] = [['search', onK], ['info', onI], ['next', onNext], ['prev', onPrev], ['new', onNew], ['mute', onMute]];
    evs.forEach(([n, f]) => bus.addEventListener(n, f));
    return () => evs.forEach(([n, f]) => bus.removeEventListener(n, f));
  }, [bus]);

  // Vinculado ao celular, as conversas são as dele (todas); com identidade própria, a lista da identidade ativa.
  const mine = useMemo(() => (linked ? all : all.filter(c => c.contact.via === prefs.identity)), [all, prefs.identity, linked]);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byKind = filterConversationKind(mine, filter);
    return byKind.filter(c => !qq || nameOf(c.contact).toLowerCase().includes(qq) || c.contact.id.includes(qq));
  }, [mine, filter, q]);
  useEffect(() => { if (active && !mine.some(c => c.contact.id === active)) setActive(null); }, [mine, active]);

  const listRef = useRef(list); listRef.current = list;
  const conv = mine.find(c => c.contact.id === active) ?? null;
  const convName = conv ? nameOf(conv.contact) : null;
  useEffect(() => { onTitle?.(convName); }, [convName, onTitle]);
  useEffect(() => () => onTitle?.(null), [onTitle]);
  const collective = !!conv && conversationKind(conv.contact) !== 'direct';
  // Chamada de voz (só com provedor de chamada): o palco mostra a conversa de quem está na chamada;
  // abrir outra conversa minimiza a chamada, voltar à dela restaura (como no protótipo).
  const call = useCallHost();
  const tr = useTr();
  const callSt = call?.scene?.state;
  const callPeer = callSt && onStage(callSt.phase) ? callSt.peer ?? null : null;
  const callMini = !!callSt?.mini;
  useEffect(() => { if (callPeer && !callMini && mine.some(c => c.contact.id === callPeer)) setActive(callPeer); }, [callPeer, callMini, mine]);
  const pick = (id: string) => {
    if (call && callSt?.phase === 'active' && callPeer) call.controller.dispatch({ type: id === callPeer ? 'restore' : 'minimize' });
    if (draftFor) onDraftDone?.();
    setActive(id);
  };
  // Recusou com "Mensagem" (`callDraft`): abre a conversa de quem ligou assim que ela estiver na lista, com o
  // rascunho do celular no campo e o foco nele. Depois do efeito de `active` (que limpa o campo ao trocar de conversa).
  useEffect(() => {
    if (!draftFor || !mine.some(c => c.contact.id === draftFor.peer)) return;
    if (active !== draftFor.peer) { setActive(draftFor.peer); return; }
    setDraft(d => declineDraft(tr, d));
    onDraftDone?.();
    requestAnimationFrame(() => composeEl.current?.focus());
  }, [draftFor, mine, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const callable = !!call && !!conv && !collective;
  const startCall = () => { if (call && conv) call.controller.open(conv.contact.id, call.routeTo(conv.contact.id)); };
  useCallKeys(call, mac, ['open'], callable && conv && !(callSt && inCall(callSt.phase)) ? conv.contact.id : null);
  const canWrite = !!conv && canSendToConversation(conv.contact);
  const links = net?.lan.links ?? 0;
  const lanOn = net?.lan.state === 'running';
  const totalUnread = all.reduce((a, c) => a + c.unread, 0);
  void totalUnread;

  const send = async () => {
    const text = draft.trim();
    if (!conv || !text || !canSendToConversation(conv.contact)) return;
    try {
      const m = await window.piu.sendText(conv.contact.id, text);
      fresh.current.add(m.id);
      setMsgs(ms => (ms.some(x => x.id === m.id) ? ms : [...ms, m]));
      setDraft('');
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const addByCode = () => {
    let value = '';
    setDialog({
      icon: 'person_add', title: t('chats.addCode.title'), body: t('chats.addCode.body'), primary: t('chats.addCode.primary'),
      content: <input autoFocus placeholder="piu1:…" spellCheck={false} onChange={e => { value = e.target.value; setPasteCode(value); }}
        style={{ width: '100%', height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `500 12.5px ${FM}`, color: 'var(--ink)', outline: 'none' }} />,
      act: async () => {
        try {
          const c = await window.piu.addContactByCard(value || pasteCode);
          const l = await window.piu.listConversations(); setAll(l);
          if (c.via !== prefs.identity) await window.piu.setPrefs({ identity: c.via });
          setActive(c.id); setDialog(null); toast(t('chats.addCode.added', { name: c.name || t('chats.contact.fallback') }), 'person_add');
        } catch (e) { toast((e as Error).message, 'error'); }
      },
    });
  };

  // ⌘N (Ajustes → Atalhos → Nova conversa): adicionar pelo código; vinculado ao celular, contatos novos entram por lá.
  const newRef = useRef<() => void>(() => {});
  newRef.current = () => { if (linked) toast(t('chats.addCode.linked'), 'smartphone'); else addByCode(); };

  const createCollective = async () => {
    try {
      const candidates = (await window.piu.listGroupCandidates()).filter(c => c.via === prefs.identity && !c.request);
      if (!candidates.length) { toast(t('chats.group.needContacts'), 'error'); return; }
      let name = '';
      let kind: 'group' | 'channel' = filter === 'channel' ? 'channel' : 'group';
      const selected = new Set<string>();
      setDialog({ icon: 'group_add', title: t('chats.group.title'), body: t('chats.group.body'), primary: t('chats.group.primary'),
        content: <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input autoFocus aria-label={t('chats.group.nameLabel')} placeholder={t('chats.group.namePlaceholder')} maxLength={60} onChange={e => { name = e.target.value; }} style={{ height: 42, borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--bg2)', padding: '0 12px', color: 'var(--ink)' }} />
          <select aria-label={t('chats.group.kindLabel')} defaultValue={kind} onChange={e => { kind = e.target.value as 'group' | 'channel'; }} style={{ height: 40, borderRadius: 10, background: 'var(--bg2)', color: 'var(--ink)' }}><option value="group">{t('chats.group.kindGroup')}</option><option value="channel">{t('chats.group.kindChannel')}</option></select>
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map(c => <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" onChange={e => { if (e.target.checked) selected.add(c.id); else selected.delete(c.id); }} />{nameOf(c)}</label>)}
          </div>
        </div>,
        act: async () => {
          if (!name.trim() || !selected.size) { toast(t('chats.group.missing'), 'error'); return; }
          try {
            const group = await window.piu.createGroup({ kind, name: name.trim(), via: prefs.identity, memberIds: [...selected] });
            const rows = await window.piu.listConversations(); setAll(rows); setFilter('all'); setActive(group.id); setDialog(null); toast(t('chats.group.created'), 'group_add');
          } catch (e) { toast((e as Error).message, 'error'); }
        },
      });
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const showMyCode = async () => {
    try {
      const card = await window.piu.myCard(prefs.identity);
      setDialog({ title: t('chats.myCode.title'), body: t('chats.myCode.body'), primary: t('common.copy'), hasSecond: true, code: card.card,
        act: () => { void window.piu.copy(card.card); setDialog(null); toast(t('chats.myCode.copied'), 'content_copy'); } });
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  /** Detalhes → Convidar: contatos aceitos da mesma identidade que ainda não estão no grupo. */
  const invite = async () => {
    if (!conv) return;
    if (linked) { toast(t('chats.act.inviteLinked'), 'person_add'); return; }
    try {
      const candidates = await window.piu.groupInviteCandidates(conv.contact.id);
      if (!candidates.length) { toast(t('chats.invite.none'), 'person_add'); return; }
      const selected = new Set<string>();
      const gid = conv.contact.id;
      setDialog({ icon: 'person_add', title: t('chats.invite.title', { name: nameOf(conv.contact) }), body: t('chats.invite.body'), primary: t('chats.act.invite'),
        content: <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          {candidates.map(c => <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" onChange={e => { if (e.target.checked) selected.add(c.id); else selected.delete(c.id); }} />{nameOf(c)}</label>)}
        </div>,
        act: async () => {
          if (!selected.size) { toast(t('chats.invite.pick'), 'error'); return; }
          try { await window.piu.addGroupMembers(gid, [...selected]); setDialog(null); toast(t('chats.invite.done', { count: selected.size }), 'person_add'); }
          catch (e) { toast((e as Error).message, 'error'); }
        } });
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  /** Sair do grupo/canal: avisa os admins e apaga a conversa deste computador. */
  const leave = () => {
    if (!conv) return;
    if (linked) { toast(t('chats.leave.linked'), 'logout'); return; }
    const channel = conversationKind(conv.contact) === 'channel';
    const gid = conv.contact.id, name = nameOf(conv.contact);
    setDialog({ icon: 'logout', title: t(channel ? 'chats.leave.channelTitle' : 'chats.leave.groupTitle', { name }), body: t('chats.leave.body'), primary: t(channel ? 'chats.leave.channel' : 'chats.leave.group'), danger: true,
      act: async () => { try { await window.piu.leaveGroup(gid); setActive(null); setInfoOpen(false); setDialog(null); toast(t('chats.leave.done', { name }), 'logout'); } catch (e) { toast((e as Error).message, 'error'); } } });
  };

  const remove = () => {
    if (!conv) return;
    const first = nameOf(conv.contact).split(' ')[0]!;
    setDialog({ icon: 'person_remove', title: t('chats.remove.title', { name: first }), body: t('chats.remove.body'), primary: t('common.remove'),
      act: async () => { try { await window.piu.removeContact(conv.contact.id); setActive(null); setInfoOpen(false); setDialog(null); toast(t('chats.remove.done', { name: first }), 'person_remove'); } catch (e) { toast((e as Error).message, 'error'); } } });
  };

  const needle = (find ?? '').trim().toLocaleLowerCase();
  const shown = needle ? msgs.filter(m => m.text.toLocaleLowerCase().includes(needle)) : msgs;
  const dens = prefs.density === 'compact';
  const msgSize = { s: '14px', m: '15px', l: '16.5px' }[prefs.fontSize];
  const mod = mac ? '⌘' : 'Ctrl';
  const identityPill = prefs.identity === 'public' ? ['public', t('chats.identity.public')] : ['visibility_off', t('chats.identity.anon')];

  // Conversa aberta: subtítulo, via e rota com dados reais.
  const first = conv ? nameOf(conv.contact).split(' ')[0]! : '';
  const offline = !linked && !!conv && conv.pending > 0 && links === 0;
  const muted = !!conv?.muted;
  const blocked = !!conv?.blocked;
  const toggleMute = () => {
    if (!conv) return;
    const name = nameOf(conv.contact);
    void window.piu.setMuted(conv.contact.id, !muted).then(() => toast(t(muted ? 'chats.mute.off' : 'chats.mute.on', { name }), muted ? 'notifications' : 'notifications_off'), e => toast((e as Error).message, 'error'));
  };
  const muteRef = useRef(toggleMute); muteRef.current = toggleMute;
  const toggleBlock = () => {
    if (!conv) return;
    const id = conv.contact.id;
    void (blocked ? window.piu.unblockContact(id) : window.piu.blockContact(id))
      .then(() => toast(t(blocked ? 'chats.block.off' : 'chats.block.on', { name: first }), blocked ? 'lock_open' : 'block'), e => toast((e as Error).message, 'error'));
  };
  const tempV = conv?.temp ?? 'off';
  const pickTemp = (k: TempMode) => {
    if (!conv || k === tempV) return;
    if (linked) { toast(t('chats.temp.linked'), 'timer'); return; }
    if (collective) { toast(t('chats.temp.directOnly'), 'timer'); return; }
    void window.piu.setTemp(conv.contact.id, k).then(() => toast(k === 'off' ? t('chats.temp.disabled') : t('chats.temp.enabled', { time: t(TEMP_LABEL[k]) }), k === 'off' ? 'timer_off' : 'timer'), e => toast((e as Error).message, 'error'));
  };
  const typingNow = !!conv && (typingUntil[conv.contact.id] ?? 0) > Date.now();
  const sub = !conv ? '' : typingNow ? t('chats.sub.typing') : conv.contact.subtitle ? conv.contact.subtitle : linked ? t('chats.sub.linked') : conv.contact.request ? t('chats.sub.request') : offline ? t('chats.sub.offline', { count: conv.pending }) : links > 0 ? t('chats.sub.lan', { count: links }) : t('chats.sub.noPeers');
  const via = linked ? t('chats.via.linked') : links > 0 ? t('chats.via.wifi', { count: links }) : lanOn ? t('chats.via.queued') : t('chats.via.lanOff');
  const viaIcon = linked ? 'smartphone' : links > 0 ? 'hub' : 'schedule';
  const sel = msgs.find(m => m.id === routeMsg) ?? null;
  const routeNodes = !sel || !conv || (linked && collective) ? [] : sel.dir === 'out'
    ? [{ n: t('chats.route.you'), k: t('chats.route.thisComputer') }, sel.route ? { n: t('chats.route.peer', { id: sel.route.peer.slice(0, 4).toUpperCase() }), k: t('chats.route.lnnpLan') } : { n: t('chats.route.waiting'), k: t('chats.route.queued') }, { n: nameOf(conv.contact), k: sel.status === 'entregue' ? t('chats.route.destReceipt') : sel.status === 'expirada' ? t('chats.route.expired') : t('chats.route.dest') }]
    : [{ n: nameOf(conv.contact), k: t('chats.route.origin') }, { n: sel.route ? t('chats.route.peer', { id: sel.route.peer.slice(0, 4).toUpperCase() }) : t('chats.route.mesh'), k: sel.route?.hops ? t('chats.route.hops', { count: sel.route.hops }) : t('chats.route.lnnp') }, { n: t('chats.route.you'), k: t('chats.route.decrypted') }];
  const routeVias = !sel ? [] : sel.dir === 'out' ? [sel.route ? t('chats.route.wifiBytes', { bytes: sel.route.bytes }) : t('chats.route.waitingLower'), sel.status === 'entregue' ? t('chats.route.receiptInSession') : t('chats.route.meshLower')] : [sel.route ? t('chats.route.wifiBytes', { bytes: sel.route.bytes }) : t('chats.route.meshLower'), 'Double Ratchet'];

  return (
    <>
      <div style={{ width: 320, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'piuUp .55s .12s cubic-bezier(.2,.85,.3,1) both' }}>
        <div style={{ padding: '18px 16px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em' }}>{t('chats.title')}</div>
            {linked ? (
              <div title={t('chats.linked.title')}style={{ height: 24, padding: '0 9px', borderRadius: 12, border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', gap: 5, font: `500 11px ${FM}`, color: 'var(--ink2)' }}>
                <Sym name="smartphone" size={13} />{t('chats.linked.pill')}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="h-bg2" onClick={createCollective} title={t('chats.newCollective')} aria-label={t('chats.newCollective')} style={{ width: 28, height: 28, border: '1px solid var(--line2)', borderRadius: 14, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="group_add" size={15} /></button>
                <button className="h-bg2" onClick={addByCode} title={t('chats.addCode.title')} aria-label={t('chats.addCode.title')} style={{ width: 28, height: 28, border: '1px solid var(--line2)', borderRadius: 14, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="person_add" size={15} /></button>
                <button className="h-bg2" onClick={showMyCode} title={t('chats.myCode')} aria-label={t('chats.myCode')} style={{ height: 24, padding: '0 9px', borderRadius: 12, border: '1px solid var(--line2)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 5, font: `500 11px ${FM}`, color: 'var(--ink2)', cursor: 'pointer' }}>
                  <Sym name={identityPill[0]!} size={13} />{identityPill[1]}
                </button>
              </div>
            )}
          </div>
          <div style={{ height: 36, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
            <Sym name="search" size={18} style={{ color: 'var(--ink2)' }} />
            <input ref={searchEl} value={q} onChange={e => setQ(e.target.value)} placeholder={t('chats.search')} aria-label={t('chats.search')} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
            <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)', padding: '2px 6px', borderRadius: 5, border: '1px solid var(--line2)' }}>{mod} K</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['all', 'chats.filter.all'], ['direct', 'chats.filter.direct'], ['group', 'chats.filter.group'], ['channel', 'chats.filter.channel']] as [Filter, Key][]).map(([k, label]) => (
              <button key={k} className="a-94" onClick={() => setFilter(k)} aria-pressed={filter === k} style={{ height: 28, padding: '0 11px', border: 'none', borderRadius: 14, background: filter === k ? 'var(--ink)' : 'var(--bg2)', color: filter === k ? 'var(--invink)' : 'var(--ink)', font: `550 12.5px ${F}`, cursor: 'pointer', transition: 'background .25s,color .25s,transform .2s' }}>{t(label)}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((c, i) => {
            const last = c.last; const anon = c.contact.via === 'anon';
            const preview = last?.call ? recordCard(tr, last.call, contactOf(c.contact.name), { desktop: true }).title
              : last?.callRequest ? requestCard(tr, last.callRequest.step, contactOf(c.contact.name)).title
              : last ? (last.dir === 'out' ? t('chats.preview.you', { text: last.text }) : last.sender ? t('chats.preview.sender', { sender: last.sender, text: last.text }) : last.text) : c.contact.request ? t('chats.preview.request') : t('chats.preview.empty');
            const kIcon = kindIcon[conversationKind(c.contact)];
            return (
              <div key={c.contact.id} className="h-x3 a-98 conv" role="button" tabIndex={0} aria-current={c.contact.id === active} onClick={() => pick(c.contact.id)} onKeyDown={e => { if (e.key === 'Enter') pick(c.contact.id); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${dens ? 8 : 11}px 10px`, borderRadius: 14, background: c.contact.id === active ? 'var(--bg2)' : 'transparent', cursor: 'pointer', transition: 'background .2s,transform .2s', animation: `piuUp .45s ${0.18 + i * 0.045}s cubic-bezier(.2,.85,.3,1) both` }}>
                <div style={{ position: 'relative', width: dens ? 38 : 46, height: dens ? 38 : 46, borderRadius: avRadius(c.contact), background: anon ? 'var(--bg3)' : 'var(--ink)', color: anon ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 14px ${F}`, flex: 'none', transition: 'width .25s,height .25s' }}>{initialsOf(c.contact.name, c.contact.id)}<CallBadge peer={c.contact.id} /></div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(c.contact)}</div>
                      {kIcon && <Sym name={kIcon} size={14} style={{ color: 'var(--ink2)' }} />}
                      {c.contact.request && <Sym name="mark_chat_unread" size={14} style={{ color: 'var(--ink2)' }} />}
                      {c.muted && <Sym name="notifications_off" size={14} style={{ color: 'var(--ink3)', animation: 'piuPop .35s both' }} />}
                      {c.blocked && <Sym name="block" size={14} style={{ color: 'var(--ink3)' }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{last ? fmtTime(last.at) : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>
                    {c.unread > 0 && <div style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: 'var(--ink)', color: 'var(--invink)', font: `650 11px ${F}`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' }}>{c.unread}</div>}
                  </div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--ink2)', animation: 'piuFade .3s both', lineHeight: 1.5 }}>
              {t('chats.empty.title')}
              {mine.length === 0 && filter === 'all' && !q && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink3)' }}>{linked ? t('chats.empty.linked') : t('chats.empty.hint', { identity: identityPill[1]! })}</div>}
            </div>
          )}
        </div>
        {footer}
      </div>

      <div style={{ position: 'relative', overflow: 'clip', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', animation: 'piuUp .6s .2s cubic-bezier(.2,.85,.3,1) both' }}>
        <div className="drag" style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px 0 20px', borderBottom: '1px solid var(--line)' }}>
          {conv ? (
            <>
              <div style={{ width: 38, height: 38, borderRadius: avRadius(conv.contact), background: conv.contact.via === 'anon' ? 'var(--bg3)' : 'var(--ink)', color: conv.contact.via === 'anon' ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${F}`, flex: 'none' }}>{initialsOf(conv.contact.name, conv.contact.id)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(conv.contact)}</div>
                  {verified[conv.contact.id] && <Sym name="verified" size={16} fill={1} style={{ animation: 'piuPop .45s cubic-bezier(.2,.9,.3,1.5) both' }} />}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
              </div>
              {callable && <CallButton onClick={startCall} mac={mac} />}
              <button className="a-88 nodrag" onClick={toggleMute} title={muted ? t('chats.unmute') : t('chats.mute')} aria-pressed={muted} style={{ width: 38, height: 38, border: 'none', borderRadius: 11, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .2s' }}><Sym name={muted ? 'notifications_off' : 'notifications'} size={21} /></button>
              <button className="a-88 nodrag" onClick={() => { setInfoOpen(o => !o); if (infoOpen) setRouteMsg(null); }} title={t('chats.details')} aria-pressed={infoOpen} style={{ width: 38, height: 38, border: 'none', borderRadius: 11, background: infoOpen ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s,transform .2s' }}><Sym name="side_navigation" size={21} /></button>
            </>
          ) : (
            <>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg3)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${F}`, flex: 'none' }}>·</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: '-0.015em' }}>{t('chats.header.none')}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{lanOn ? t('chats.header.lanOn', { node: me.nodePk.slice(0, 4).toUpperCase() }) : t('chats.via.lanOff')}</div>
            </div>
            </>
          )}
        </div>
        <div ref={scrollEl} onClick={() => setRouteMsg(null)} style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollBehavior: 'smooth', backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 28px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, color: 'var(--ink2)', marginBottom: 6 }}>
              <Sym name="lock" size={14} style={{ color: 'var(--ink)' }} />{conv ? t('chats.e2e') : t('chats.pick')}
            </div>
            {conv?.contact.request && (
              <div style={{ alignSelf: 'center', maxWidth: 360, margin: '8px 0 4px', padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, lineHeight: 1.4, color: 'var(--ink2)', textAlign: 'center', animation: 'piuUp .4s both' }}>
                {t('chats.request', { name: first })}
              </div>
            )}
            {find !== null && (
              <div style={{ position: 'sticky', top: 0, zIndex: 2, alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', margin: '0 0 6px', borderRadius: 14, background: 'var(--bg2)', boxShadow: '0 0 0 1px var(--line2) inset' }}>
                <Sym name="search" size={18} style={{ color: 'var(--ink2)' }} />
                <input autoFocus value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setFind(null); }} placeholder={t('chats.find.placeholder')} aria-label={t('chats.find.placeholder')}
                  style={{ flex: 1, minWidth: 0, height: 30, border: 'none', background: 'transparent', color: 'var(--ink)', font: `450 14px ${F}`, outline: 'none' }} />
                {find.trim() && <span style={{ font: `500 12px ${FM}`, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{t('chats.find.count', { count: shown.length })}</span>}
                <button onClick={() => setFind(null)} aria-label={t('common.close')} className="h-bg3" style={{ width: 28, height: 28, border: 'none', borderRadius: 14, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={16} /></button>
              </div>
            )}
            {shown.map((m, i, a) => {
              const gap = i && a[i - 1]!.dir !== m.dir ? 10 : 0;
              const anim = fresh.current.has(m.id) ? (m.dir === 'out' ? 'piuMsgIn .38s cubic-bezier(.2,.9,.3,1.3) both' : 'piuMsgIn .4s cubic-bezier(.2,.9,.3,1.3) both') : 'none';
              const ring = routeMsg === m.id ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ink)' : '0 0 0 0 transparent';
              const open = (e: React.MouseEvent) => { e.stopPropagation(); setRouteMsg(m.id); setInfoOpen(true); };
              // Chamada de voz: registro e pedido viram cartão no lugar do balão.
              if (m.call || m.callRequest) {
                const who = contactOf(conv?.contact.name ?? '');
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', marginTop: gap, animation: anim }}>
                    {m.call
                      ? <CallRecordCard record={m.call} contact={who} time={fmtTime(m.at)} onCallBack={call && conv ? () => call.controller.open(conv.contact.id, call.routeTo(conv.contact.id)) : undefined} />
                      : <CallRequestCard step={m.callRequest!.step} contact={who} time={fmtTime(m.at)} />}
                  </div>
                );
              }
              return m.dir === 'out' ? (
                <div key={m.id} className="h-up1 sel" onClick={open} style={{ alignSelf: 'flex-end', maxWidth: '68%', padding: '8px 12px 6px 14px', borderRadius: '20px 20px 6px 20px', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, marginTop: gap, animation: anim, transformOrigin: 'bottom right', boxShadow: ring, transition: 'box-shadow .25s,transform .2s' }}>
                  <div style={{ fontSize: msgSize, lineHeight: 1.4, textWrap: 'pretty', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
                  <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: .72 }}>
                    <span>{statusLabel[m.status] ? t(statusLabel[m.status]!) : ''}</span><span>·</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(m.at)}</span><Sym name={statusIcon[m.status]} size={15} />
                  </div>
                </div>
              ) : (
                <div key={m.id} className="h-up1 sel" onClick={open} style={{ alignSelf: 'flex-start', maxWidth: '68%', padding: '8px 14px 6px 12px', borderRadius: '20px 20px 20px 6px', background: 'var(--bub)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, marginTop: gap, boxShadow: `0 0 0 1px var(--line) inset, ${ring}`, animation: anim, transformOrigin: 'bottom left', transition: 'box-shadow .25s,transform .2s' }}>
                  {collective && m.sender && <div style={{ fontSize: 12.5, fontWeight: 650 }}>{m.sender}</div>}
                  <div style={{ fontSize: msgSize, lineHeight: 1.4, textWrap: 'pretty', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
                  <div style={{ alignSelf: 'flex-end', fontSize: 11, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(m.at)}</div>
                </div>
              );
            })}
            {offline && (
              <div style={{ alignSelf: 'center', marginTop: 12, maxWidth: 360, padding: '14px 16px', borderRadius: 18, border: '1px dashed var(--line2)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 6, animation: 'piuUp .4s both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Sym name="schedule_send" size={18} style={{ animation: 'piuBreath 2s infinite' }} />{t('chats.offline.title', { name: first })}</div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--ink2)', textWrap: 'pretty' }}>{t('chats.offline.body')}</div>
              </div>
            )}
            {conv && msgs.length === 0 && !conv.contact.request && <div style={{ alignSelf: 'center', marginTop: 40, fontSize: 13.5, color: 'var(--ink2)' }}>{canWrite ? t('chats.noMessages.write') : t('chats.noMessages')}</div>}
          </div>
        </div>
        {conv && (!canWrite ? (
          <div role="status" style={{ flex: 'none', borderTop: '1px solid var(--line)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 13.5, fontWeight: 550 }}>{conversationKind(conv.contact) === 'channel' ? t('chats.readOnly.channel') : t('chats.readOnly.other')}</div>
              <div style={{ font: `400 11px ${FM}`, color: 'var(--ink2)' }}>{linked ? t('chats.readOnly.linked') : via}</div>
            </div>
            <button onClick={toggleMute} style={{ height: 36, padding: '0 16px', borderRadius: 18, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: `550 13.5px ${F}`, cursor: 'pointer' }}>{t('chats.mute')}</button>
          </div>
        ) : (
          <div style={{ flex: 'none', borderTop: '1px solid var(--line)', padding: '10px 20px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="h-rot" onClick={() => toast(t('chats.compose.textOnly'), 'attach_file')} title={t('chats.compose.attach')} style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name="attach_file" size={23} wght={300} /></button>
              <button className="h-flip" onClick={() => onPay(conv.contact.id)} title={t('chats.compose.pay')} style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'transform .35s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name="toll" size={22} wght={300} /></button>
              <input ref={composeEl} className="f-ring" value={draft} onChange={e => { setDraft(e.target.value); if (conv && !collective && !linked && e.target.value && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); void window.piu.typing(conv.contact.id); } }} maxLength={4000} placeholder={t('chats.compose.placeholder', { name: first })} aria-label={t('chats.compose.label')}
                onKeyDown={e => { if (e.key !== 'Enter') return; const ok = prefs.enterSends ? !e.shiftKey : (e.metaKey || e.ctrlKey); if (ok) { e.preventDefault(); void send(); } }}
                style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 22, border: 'none', background: 'var(--bg2)', padding: '0 18px', fontSize: 15, color: 'var(--ink)', outline: 'none', transition: 'box-shadow .2s' }} />
              <button className="a-85" onClick={() => void send()} title={t('chats.compose.send')} aria-label={t('chats.compose.send')} disabled={!draft.trim()} style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: draft.trim() ? 1 : .35, transform: draft.trim() ? 'scale(1)' : 'scale(.85)', transition: 'opacity .2s,transform .3s cubic-bezier(.2,.9,.3,1.6)' }}><Sym name="arrow_upward" size={22} wght={500} /></button>
            </div>
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', justifyContent: 'space-between', gap: 12, font: `400 11px ${FM}`, color: 'var(--ink2)', padding: '0 4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Sym name={viaIcon} size={13} />{via}</span>
              <span>{prefs.enterSends ? t('chats.compose.enterSends') : t('chats.compose.modEnterSends', { mod })}</span>
            </div>
          </div>
        ))}
        <CallLayer mac={mac} />
      </div>

      {conv && infoOpen && (
        <div style={{ width: 320, flex: 'none', borderLeft: '1px solid var(--line)', overflowY: 'auto', animation: 'piuSide .4s cubic-bezier(.2,.85,.3,1) both' }}>
          <div style={{ padding: '14px 14px 0', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="h-bg2" onClick={() => { setInfoOpen(false); setRouteMsg(null); }} aria-label={t('chats.closeDetails')} style={{ width: 32, height: 32, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={20} /></button>
          </div>
          {sel && routeNodes.length > 0 && (
            <div style={{ margin: '0 16px 18px', padding: 16, borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 12, animation: 'piuDialog .4s cubic-bezier(.2,.9,.3,1.2) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ font: `500 11px ${FM}`, letterSpacing: '.06em', opacity: .7 }}>{t('chats.route.title')}</div>
                <button onClick={() => setRouteMsg(null)} aria-label={t('chats.route.close')} style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}><Sym name="close" size={18} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {routeNodes.map((n, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', animation: `piuUp .4s ${0.1 + i * 0.14}s cubic-bezier(.2,.85,.3,1) both` }}>
                    {i > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 30 }}>
                        <div style={{ position: 'relative', width: 12, height: 30, display: 'flex', justifyContent: 'center' }}>
                          <div style={{ width: 1.5, height: '100%', background: 'currentColor', opacity: .3 }} />
                          <div style={{ position: 'absolute', left: 3, width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: `piuTravelY 1.1s ${i * 0.25}s ease-in-out infinite` }} />
                        </div>
                        <div style={{ font: `400 11px ${FM}`, opacity: .7 }}>{routeVias[i - 1]}</div>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', background: i === 0 || i === routeNodes.length - 1 ? 'currentColor' : 'transparent', flex: 'none' }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.n}</div><div style={{ fontSize: 11.5, opacity: .7 }}>{n.k}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ padding: '4px 20px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <div style={{ width: 76, height: 76, borderRadius: avRadius(conv.contact, true), background: conv.contact.via === 'anon' ? 'var(--bg3)' : 'var(--ink)', color: conv.contact.via === 'anon' ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 24px ${F}`, animation: 'piuPop .5s .1s cubic-bezier(.2,.9,.3,1.4) both' }}>{initialsOf(conv.contact.name, conv.contact.id)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, animation: 'piuUp .4s .15s both' }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{nameOf(conv.contact)}</div>
              {collective ? <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{sub}</div> : <div className="sel" style={{ color: 'var(--ink2)', font: `500 11.5px ${FM}` }}>{conv.contact.id}</div>}
            </div>
          </div>
          <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, animation: 'piuUp .4s .2s both' }}>
            {[{ icon: muted ? 'notifications_off' : 'notifications', label: muted ? t('chats.act.withSound') : t('chats.mute'), fill: 0 as const, act: toggleMute },
              { icon: 'search', label: t('chats.act.search'), fill: 0 as const, act: () => setFind(f => (f === null ? '' : null)) },
              collective ? { icon: 'person_add', label: t('chats.act.invite'), fill: 0 as const, act: () => void invite() }
                : { icon: 'verified', label: verified[conv.contact.id] ? t('chats.act.verified') : t('chats.act.verify'), fill: (verified[conv.contact.id] ? 1 : 0) as 0 | 1, act: () => { const v = !verified[conv.contact.id]; setVerified(x => ({ ...x, [conv.contact.id]: v })); if (v) toast(t('chats.act.verifiedToast', { name: first }), 'verified'); } }].map(a => (
              <button key={a.label} className="h-bg3 a-94" onClick={a.act} style={{ height: 62, border: 'none', borderRadius: 16, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, font: `550 12px ${F}`, transition: 'background .15s,transform .2s' }}>
                <Sym name={a.icon} size={21} fill={a.fill} />{a.label}
              </button>
            ))}
          </div>
          {!collective && <>
          <div style={{ padding: '22px 20px 8px', font: `500 11px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{t('chats.safety.title')}</div>
          <div style={{ margin: '0 16px', padding: 14, borderRadius: 18, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {linked ? (
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('chats.safety.linked')}</div>
            ) : (
              <>
                <div className="sel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, font: `500 13.5px ${FM}`, textAlign: 'center' }}>
                  {safety.map((g, i) => <div key={i} style={{ animation: `piuUp .3s ${i * 0.04}s both` }}>{g}</div>)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{t('chats.safety.compare', { name: first })}</div>
              </>
            )}
          </div>
          </>}
          <div style={{ padding: '22px 20px 8px', font: `500 11px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>{t('chats.temp.section')}</div>
          <div style={{ margin: '0 16px', display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--bg2)' }}>
            {(Object.entries(TEMP_LABEL) as [TempMode, Key][]).map(([k, label]) => (
              <button key={k} onClick={() => pickTemp(k)} aria-pressed={tempV === k}
                style={{ flex: 1, height: 30, border: 'none', borderRadius: 8, background: tempV === k ? 'var(--bg)' : 'transparent', color: 'var(--ink)', font: `${tempV === k ? 600 : 450} 12.5px ${F}`, cursor: 'pointer', boxShadow: tempV === k ? '0 1px 3px rgba(0,0,0,.14)' : 'none', transition: 'background .2s,box-shadow .2s' }}>{t(label)}</button>
            ))}
          </div>
          <div style={{ padding: '22px 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {collective ? (
              <button className="h-bg2" onClick={leave} style={{ height: 44, borderRadius: 22, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Sym name="logout" size={18} />{conversationKind(conv.contact) === 'channel' ? t('chats.leave.channel') : t('chats.leave.group')}
              </button>
            ) : linked ? (
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4, textAlign: 'center' }}>{t('chats.linkedRemove')}</div>
            ) : (
              <>
              {/* Protótipo: "Bloquear {nome}" (leaveLabel). Como no celular, a conversa fica; o que a pessoa manda é descartado. */}
              <button className="h-bg2" onClick={toggleBlock} style={{ height: 44, borderRadius: 22, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Sym name={blocked ? 'lock_open' : 'block'} size={18} />{t(blocked ? 'chats.block.unblockButton' : 'chats.block.blockButton', { name: first })}
              </button>
              <button className="h-bg2" onClick={remove} style={{ height: 44, borderRadius: 22, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Sym name="person_remove" size={18} />{t('chats.remove.button', { name: first })}
              </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
