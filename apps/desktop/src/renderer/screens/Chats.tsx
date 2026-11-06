/**
 * Conversas (protótipo `isChatsNav`): lista 320px (busca ⌘K, filtros), conversa (cabeçalho 64px,
 * bolhas com estado, compositor 44px) e painel de detalhes 320px (rota da mensagem, código de
 * segurança, mensagens temporárias, remover). Sem dados de exemplo: estados vazios.
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary, MeInfo, Message, NetworkStatus, Prefs } from '../../shared/types';
import { canSendToConversation, conversationKind, filterConversationKind } from '../../shared/conversations';
import { type DialogSpec, F, FM, Sym, fmtTime, initialsOf, shortId } from '../ui';

type Filter = 'all' | 'direct' | 'group' | 'channel';

interface Props {
  me: MeInfo; prefs: Prefs; net: NetworkStatus | null;
  /** Espelhando o celular vinculado: as conversas são dele; chaves e contatos ficam lá. */
  linked?: boolean;
  toast: (text: string, icon?: string) => void;
  setDialog: Dispatch<SetStateAction<DialogSpec | null>>;
  onConversationOpen: (open: boolean) => void;
  /** Evento externo (⌘K) para focar a busca; ⌘I alterna detalhes. */
  bus: EventTarget;
}

const statusIcon: Record<Message['status'], string> = { criada: 'radio_button_unchecked', aguardando: 'schedule', encaminhada: 'check', entregue: 'done_all', expirada: 'error', recebida: '' };
const statusLabel: Record<Message['status'], string> = { criada: 'criada', aguardando: 'na fila', encaminhada: 'encaminhada', entregue: 'entregue', expirada: 'expirada', recebida: '' };

const nameOf = (c: ConversationSummary['contact']) => c.name || (c.via === 'anon' ? `Contato anônimo · ${shortId(c.id)}` : `Contato · ${shortId(c.id)}`);

export function Chats({ me, prefs, net, linked = false, toast, setDialog, onConversationOpen, bus }: Props) {
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
  const [tempV, setTempV] = useState('off');
  const [pasteCode, setPasteCode] = useState('');
  const fresh = useRef(new Set<string>());
  const mounted = useRef(Date.now() / 1000);
  const scrollEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
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
      void window.piu.markRead(contactId);
    });
    return () => { off(); offM(); };
  }, [reload]);

  useEffect(() => {
    onConversationOpen(!!active);
    setRouteMsg(null); setDraft('');
    if (!active) { setMsgs([]); setSafety([]); return; }
    void window.piu.getMessages(active).then(setMsgs);
    void window.piu.markRead(active);
    if (linked || active.startsWith('group:')) setSafety([]); else void window.piu.safetyCode(active).then(setSafety).catch(() => setSafety([]));
  }, [active, onConversationOpen, linked]);
  useEffect(() => () => onConversationOpen(false), [onConversationOpen]);
  useEffect(() => { const el = scrollEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, active]);

  // Atalhos vindos do App: ⌘K foca a busca, ⌘I alterna os detalhes.
  useEffect(() => {
    const onK = () => searchEl.current?.focus();
    const onI = () => { if (activeRef.current) setInfoOpen(o => !o); };
    bus.addEventListener('search', onK); bus.addEventListener('info', onI);
    return () => { bus.removeEventListener('search', onK); bus.removeEventListener('info', onI); };
  }, [bus]);

  // Vinculado ao celular, as conversas são as dele (todas); com identidade própria, a lista da identidade ativa.
  const mine = useMemo(() => (linked ? all : all.filter(c => c.contact.via === prefs.identity)), [all, prefs.identity, linked]);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byKind = filterConversationKind(mine, filter);
    return byKind.filter(c => !qq || nameOf(c.contact).toLowerCase().includes(qq) || c.contact.id.includes(qq));
  }, [mine, filter, q]);
  useEffect(() => { if (active && !mine.some(c => c.contact.id === active)) setActive(null); }, [mine, active]);

  const conv = mine.find(c => c.contact.id === active) ?? null;
  const collective = !!conv && conversationKind(conv.contact) !== 'direct';
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
      icon: 'person_add', title: 'Adicionar pelo código', body: 'Cole o código piu1:… que a pessoa mostrou ou enviou. A primeira mensagem leva o convite e abre a sessão cifrada.', primary: 'Adicionar',
      content: <input autoFocus placeholder="piu1:…" spellCheck={false} onChange={e => { value = e.target.value; setPasteCode(value); }}
        style={{ width: '100%', height: 44, borderRadius: 12, border: 'none', background: 'var(--bg2)', padding: '0 14px', font: `500 12.5px ${FM}`, color: 'var(--ink)', outline: 'none' }} />,
      act: async () => {
        try {
          const c = await window.piu.addContactByCard(value || pasteCode);
          const l = await window.piu.listConversations(); setAll(l);
          if (c.via !== prefs.identity) await window.piu.setPrefs({ identity: c.via });
          setActive(c.id); setDialog(null); toast(`${c.name || 'Contato'} adicionado`, 'person_add');
        } catch (e) { toast((e as Error).message, 'error'); }
      },
    });
  };

  const createCollective = async () => {
    try {
      const candidates = (await window.piu.listGroupCandidates()).filter(c => c.via === prefs.identity && !c.request);
      if (!candidates.length) { toast('Adicione e aceite contatos desta identidade para criar um grupo ou canal.', 'error'); return; }
      let name = '';
      let kind: 'group' | 'channel' = filter === 'channel' ? 'channel' : 'group';
      const selected = new Set<string>();
      setDialog({ icon: 'group_add', title: 'Novo grupo ou canal', body: 'Selecione contatos aceitos desta identidade. A participação é enviada pela conversa cifrada de cada pessoa.', primary: 'Criar',
        content: <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input autoFocus aria-label="Nome" placeholder="Nome do grupo ou canal" maxLength={60} onChange={e => { name = e.target.value; }} style={{ height: 42, borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--bg2)', padding: '0 12px', color: 'var(--ink)' }} />
          <select aria-label="Tipo" defaultValue={kind} onChange={e => { kind = e.target.value as 'group' | 'channel'; }} style={{ height: 40, borderRadius: 10, background: 'var(--bg2)', color: 'var(--ink)' }}><option value="group">Grupo · membros podem publicar</option><option value="channel">Canal · só administradores publicam</option></select>
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map(c => <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" onChange={e => { if (e.target.checked) selected.add(c.id); else selected.delete(c.id); }} />{nameOf(c)}</label>)}
          </div>
        </div>,
        act: async () => {
          if (!name.trim() || !selected.size) { toast('Informe o nome e selecione pelo menos um contato.', 'error'); return; }
          try {
            const group = await window.piu.createGroup({ kind, name: name.trim(), via: prefs.identity, memberIds: [...selected] });
            const rows = await window.piu.listConversations(); setAll(rows); setFilter('all'); setActive(group.id); setDialog(null); toast('Conversa criada', 'group_add');
          } catch (e) { toast((e as Error).message, 'error'); }
        },
      });
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const showMyCode = async () => {
    try {
      const card = await window.piu.myCard(prefs.identity);
      setDialog({ title: 'Seu código de perfil', body: 'Quem colar (ou escanear, no celular) este código pode iniciar uma conversa com você. Uso único, vale 24 h.', primary: 'Copiar', hasSecond: true, code: card.card,
        act: () => { void window.piu.copy(card.card); setDialog(null); toast('Código copiado', 'content_copy'); } });
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const remove = () => {
    if (!conv) return;
    const first = nameOf(conv.contact).split(' ')[0]!;
    setDialog({ icon: 'person_remove', title: `Remover ${first}?`, body: 'O contato e a conversa saem deste computador. Uma mensagem dessa pessoa só volta a entrar com um convite novo.', primary: 'Remover',
      act: async () => { try { await window.piu.removeContact(conv.contact.id); setActive(null); setInfoOpen(false); setDialog(null); toast(`${first} removido`, 'person_remove'); } catch (e) { toast((e as Error).message, 'error'); } } });
  };

  const dens = prefs.density === 'compact';
  const msgSize = { s: '14px', m: '15px', l: '16.5px' }[prefs.fontSize];
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';
  const identityPill = prefs.identity === 'public' ? ['public', 'Pública'] : ['visibility_off', 'Anônima'];

  // Conversa aberta: subtítulo, via e rota com dados reais.
  const first = conv ? nameOf(conv.contact).split(' ')[0]! : '';
  const offline = !linked && !!conv && conv.pending > 0 && links === 0;
  const sub = !conv ? '' : linked ? (conv.contact.subtitle ?? 'conectado ao celular · ele cifra e envia') : conv.contact.request ? 'pedido de conversa · confira o código' : offline ? `fora de alcance · ${conv.pending} na fila` : links > 0 ? `rede local · ${links} vizinho${links > 1 ? 's' : ''}` : 'sem vizinhos agora';
  const via = linked ? 'pelo celular vinculado · rede local' : links > 0 ? `Wi-Fi local · ${links} vizinho${links > 1 ? 's' : ''}` : lanOn ? 'sem vizinhos · fila guardada' : 'rede local desligada';
  const viaIcon = linked ? 'smartphone' : links > 0 ? 'hub' : 'schedule';
  const sel = msgs.find(m => m.id === routeMsg) ?? null;
  const routeNodes = !sel || !conv || (linked && collective) ? [] : sel.dir === 'out'
    ? [{ n: 'Você', k: 'Este computador' }, sel.route ? { n: `Vizinho · ${sel.route.peer.slice(0, 4).toUpperCase()}`, k: 'Nó LNNP · rede local' } : { n: 'Aguardando rota', k: 'na fila (vale 48 h)' }, { n: nameOf(conv.contact), k: sel.status === 'entregue' ? 'Destino · recibo cifrado' : sel.status === 'expirada' ? 'Expirada sem recibo' : 'Destino' }]
    : [{ n: nameOf(conv.contact), k: 'Origem' }, { n: sel.route ? `Vizinho · ${sel.route.peer.slice(0, 4).toUpperCase()}` : 'Malha', k: sel.route?.hops ? `${sel.route.hops} salto${sel.route.hops > 1 ? 's' : ''}` : 'Nó LNNP' }, { n: 'Você', k: 'Este computador · decifrada' }];
  const routeVias = !sel ? [] : sel.dir === 'out' ? [sel.route ? `Wi-Fi local · ${sel.route.bytes} B` : 'aguardando rota', sel.status === 'entregue' ? 'recibo dentro da sessão' : 'malha'] : [sel.route ? `Wi-Fi local · ${sel.route.bytes} B` : 'malha', 'Double Ratchet'];

  return (
    <>
      <div style={{ width: 320, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'piuUp .55s .12s cubic-bezier(.2,.85,.3,1) both' }}>
        <div style={{ padding: '18px 16px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em' }}>Conversas</div>
            {linked ? (
              <div title="Conectado ao celular" style={{ height: 24, padding: '0 9px', borderRadius: 12, border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', gap: 5, font: `500 11px ${FM}`, color: 'var(--ink2)' }}>
                <Sym name="smartphone" size={13} />celular
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="h-bg2" onClick={createCollective} title="Criar grupo ou canal" aria-label="Criar grupo ou canal" style={{ width: 28, height: 28, border: '1px solid var(--line2)', borderRadius: 14, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="group_add" size={15} /></button>
                <button className="h-bg2" onClick={addByCode} title="Adicionar pelo código" aria-label="Adicionar pelo código" style={{ width: 28, height: 28, border: '1px solid var(--line2)', borderRadius: 14, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="person_add" size={15} /></button>
                <button className="h-bg2" onClick={showMyCode} title="Meu código" aria-label="Meu código" style={{ height: 24, padding: '0 9px', borderRadius: 12, border: '1px solid var(--line2)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 5, font: `500 11px ${FM}`, color: 'var(--ink2)', cursor: 'pointer' }}>
                  <Sym name={identityPill[0]!} size={13} />{identityPill[1]}
                </button>
              </div>
            )}
          </div>
          <div style={{ height: 36, borderRadius: 11, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
            <Sym name="search" size={18} style={{ color: 'var(--ink2)' }} />
            <input ref={searchEl} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas" style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)' }} />
            <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)', padding: '2px 6px', borderRadius: 5, border: '1px solid var(--line2)' }}>{mod} K</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['all', 'Todas'], ['direct', 'Pessoas'], ['group', 'Grupos'], ['channel', 'Canais']] as [Filter, string][]).map(([k, label]) => (
              <button key={k} className="a-94" onClick={() => setFilter(k)} aria-pressed={filter === k} style={{ height: 28, padding: '0 11px', border: 'none', borderRadius: 14, background: filter === k ? 'var(--ink)' : 'var(--bg2)', color: filter === k ? 'var(--invink)' : 'var(--ink)', font: `550 12.5px ${F}`, cursor: 'pointer', transition: 'background .25s,color .25s,transform .2s' }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((c, i) => {
            const last = c.last; const anon = c.contact.via === 'anon';
            const preview = last ? (last.dir === 'out' ? 'Você: ' : '') + last.text : c.contact.request ? 'pedido de conversa' : 'Sem mensagens ainda';
            return (
              <div key={c.contact.id} className="h-x3 a-98 conv" role="button" tabIndex={0} aria-current={c.contact.id === active} onClick={() => setActive(c.contact.id)} onKeyDown={e => { if (e.key === 'Enter') setActive(c.contact.id); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${dens ? 8 : 11}px 10px`, borderRadius: 14, background: c.contact.id === active ? 'var(--bg2)' : 'transparent', cursor: 'pointer', transition: 'background .2s,transform .2s', animation: `piuUp .45s ${0.18 + i * 0.045}s cubic-bezier(.2,.85,.3,1) both` }}>
                <div style={{ width: dens ? 38 : 46, height: dens ? 38 : 46, borderRadius: conversationKind(c.contact) === 'direct' ? '50%' : 14, background: anon ? 'var(--bg3)' : 'var(--ink)', color: anon ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 14px ${F}`, flex: 'none', transition: 'width .25s,height .25s' }}>{initialsOf(c.contact.name, c.contact.id)}</div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(c.contact)}</div>
                      {c.contact.request && <Sym name="mark_chat_unread" size={14} style={{ color: 'var(--ink2)' }} />}
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
              Nenhuma conversa aqui ainda
              {mine.length === 0 && filter === 'all' && !q && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink3)' }}>{linked ? 'Aguardando as conversas do celular.' : `Mostre seu código (${identityPill[1]}) ou adicione alguém pelo código dela.`}</div>}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', animation: 'piuUp .6s .2s cubic-bezier(.2,.85,.3,1) both' }}>
        <div className="drag" style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px 0 20px', borderBottom: '1px solid var(--line)' }}>
          {conv ? (
            <>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: conv.contact.via === 'anon' ? 'var(--bg3)' : 'var(--ink)', color: conv.contact.via === 'anon' ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${F}`, flex: 'none' }}>{initialsOf(conv.contact.name, conv.contact.id)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(conv.contact)}</div>
                  {verified[conv.contact.id] && <Sym name="verified" size={16} fill={1} style={{ animation: 'piuPop .45s cubic-bezier(.2,.9,.3,1.5) both' }} />}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
              </div>
              <button className="a-88 nodrag" onClick={() => toast('Silenciar conversa chega numa próxima versão', 'notifications_off')} title="Silenciar" style={{ width: 38, height: 38, border: 'none', borderRadius: 11, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .2s' }}><Sym name="notifications" size={21} /></button>
              <button className="a-88 nodrag" disabled={collective} onClick={() => { setInfoOpen(o => !o); if (infoOpen) setRouteMsg(null); }} title="Detalhes" aria-pressed={infoOpen} style={{ width: 38, height: 38, border: 'none', borderRadius: 11, background: infoOpen ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s,transform .2s' }}><Sym name="side_navigation" size={21} /></button>
            </>
          ) : (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: '-0.015em' }}>Nenhuma conversa</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{lanOn ? `rede local ligada · nó ${me.nodePk.slice(0, 4).toUpperCase()}` : 'rede local desligada'}</div>
            </div>
          )}
        </div>
        <div ref={scrollEl} onClick={() => setRouteMsg(null)} style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin', scrollBehavior: 'smooth', backgroundColor: 'var(--bg)', backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 28px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, color: 'var(--ink2)', marginBottom: 6 }}>
              <Sym name="lock" size={14} style={{ color: 'var(--ink)' }} />{conv ? 'Cifrado de ponta a ponta. Clique numa mensagem para ver a rota.' : 'Escolha uma conversa ou mostre seu código para começar.'}
            </div>
            {conv?.contact.request && (
              <div style={{ alignSelf: 'center', maxWidth: 360, margin: '8px 0 4px', padding: '7px 12px', borderRadius: 12, background: 'var(--bg2)', fontSize: 12, lineHeight: 1.4, color: 'var(--ink2)', textAlign: 'center', animation: 'piuUp .4s both' }}>
                {first} usou o seu código antes de você ter o dela. Confira o código de segurança nos detalhes; responder aceita a conversa.
              </div>
            )}
            {msgs.map((m, i, a) => {
              const gap = i && a[i - 1]!.dir !== m.dir ? 10 : 0;
              const anim = fresh.current.has(m.id) ? (m.dir === 'out' ? 'piuMsgIn .38s cubic-bezier(.2,.9,.3,1.3) both' : 'piuMsgIn .4s cubic-bezier(.2,.9,.3,1.3) both') : 'none';
              const ring = routeMsg === m.id ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ink)' : '0 0 0 0 transparent';
              const open = (e: React.MouseEvent) => { e.stopPropagation(); if (collective) return; setRouteMsg(m.id); setInfoOpen(true); };
              return m.dir === 'out' ? (
                <div key={m.id} className="h-up1 sel" onClick={open} style={{ alignSelf: 'flex-end', maxWidth: '68%', padding: '8px 12px 6px 14px', borderRadius: '20px 20px 6px 20px', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, marginTop: gap, animation: anim, transformOrigin: 'bottom right', boxShadow: ring, transition: 'box-shadow .25s,transform .2s' }}>
                  <div style={{ fontSize: msgSize, lineHeight: 1.4, textWrap: 'pretty', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
                  <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: .72 }}>
                    <span>{statusLabel[m.status]}</span><span>·</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(m.at)}</span><Sym name={statusIcon[m.status]} size={15} />
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><Sym name="schedule_send" size={18} style={{ animation: 'piuBreath 2s infinite' }} />{first} está fora de alcance</div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--ink2)', textWrap: 'pretty' }}>A mensagem fica guardada neste computador e é entregue quando surgir uma rota pela rede local. Expira em 48 h.</div>
              </div>
            )}
            {conv && msgs.length === 0 && !conv.contact.request && <div style={{ alignSelf: 'center', marginTop: 40, fontSize: 13.5, color: 'var(--ink2)' }}>{canWrite ? 'Nenhuma mensagem ainda. Escreva a primeira.' : 'Nenhuma mensagem ainda.'}</div>}
          </div>
        </div>
        {conv && (!canWrite ? (
          <div role="status" style={{ borderTop: '1px solid var(--line)', padding: '18px 24px', fontSize: 13, color: 'var(--ink2)' }}>Somente leitura · permissões definidas no celular</div>
        ) : (
          <div style={{ flex: 'none', borderTop: '1px solid var(--line)', padding: '10px 20px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="h-rot" onClick={() => toast(`Arquivos chegam numa próxima versão`, 'attach_file')} title="Anexar" style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'transform .3s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name="attach_file" size={23} wght={300} /></button>
              <button className="h-flip" onClick={() => toast('Enviar LUNES pela conversa chega numa próxima versão', 'toll')} title="Enviar LUNES" style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transition: 'transform .35s cubic-bezier(.2,.9,.3,1.5)' }}><Sym name="toll" size={22} wght={300} /></button>
              <input className="f-ring" value={draft} onChange={e => setDraft(e.target.value)} maxLength={4000} placeholder={`Mensagem para ${first}`} aria-label="Mensagem"
                onKeyDown={e => { if (e.key !== 'Enter') return; const ok = prefs.enterSends ? !e.shiftKey : (e.metaKey || e.ctrlKey); if (ok) { e.preventDefault(); void send(); } }}
                style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 22, border: 'none', background: 'var(--bg2)', padding: '0 18px', fontSize: 15, color: 'var(--ink)', outline: 'none', transition: 'box-shadow .2s' }} />
              <button className="a-85" onClick={() => void send()} title="Enviar" aria-label="Enviar" disabled={!draft.trim()} style={{ width: 42, height: 42, borderRadius: 21, border: 'none', background: 'var(--ink)', color: 'var(--invink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: draft.trim() ? 1 : .35, transform: draft.trim() ? 'scale(1)' : 'scale(.85)', transition: 'opacity .2s,transform .3s cubic-bezier(.2,.9,.3,1.6)' }}><Sym name="arrow_upward" size={22} wght={500} /></button>
            </div>
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', justifyContent: 'space-between', gap: 12, font: `400 11px ${FM}`, color: 'var(--ink2)', padding: '0 4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Sym name={viaIcon} size={13} />{via}</span>
              <span>{prefs.enterSends ? 'Enter envia · Shift+Enter quebra linha' : `${mod}+Enter envia`}</span>
            </div>
          </div>
        ))}
      </div>

      {conv && infoOpen && !collective && (
        <div style={{ width: 320, flex: 'none', borderLeft: '1px solid var(--line)', overflowY: 'auto', scrollbarWidth: 'thin', animation: 'piuSide .4s cubic-bezier(.2,.85,.3,1) both' }}>
          <div style={{ padding: '14px 14px 0', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="h-bg2" onClick={() => { setInfoOpen(false); setRouteMsg(null); }} aria-label="Fechar detalhes" style={{ width: 32, height: 32, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={20} /></button>
          </div>
          {sel && routeNodes.length > 0 && (
            <div style={{ margin: '0 16px 18px', padding: 16, borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', display: 'flex', flexDirection: 'column', gap: 12, animation: 'piuDialog .4s cubic-bezier(.2,.9,.3,1.2) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ font: `500 11px ${FM}`, letterSpacing: '.06em', opacity: .7 }}>ROTA DA MENSAGEM</div>
                <button onClick={() => setRouteMsg(null)} aria-label="Fechar rota" style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}><Sym name="close" size={18} /></button>
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
            <div style={{ width: 76, height: 76, borderRadius: '50%', background: conv.contact.via === 'anon' ? 'var(--bg3)' : 'var(--ink)', color: conv.contact.via === 'anon' ? 'var(--ink)' : 'var(--invink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 24px ${F}`, animation: 'piuPop .5s .1s cubic-bezier(.2,.9,.3,1.4) both' }}>{initialsOf(conv.contact.name, conv.contact.id)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, animation: 'piuUp .4s .15s both' }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{nameOf(conv.contact)}</div>
              <div className="sel" style={{ fontSize: 12.5, color: 'var(--ink2)', font: `500 11.5px ${FM}` }}>{conv.contact.id}</div>
            </div>
          </div>
          <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, animation: 'piuUp .4s .2s both' }}>
            {[{ icon: 'notifications', label: 'Silenciar', fill: 0 as const, act: () => toast('Silenciar conversa chega numa próxima versão', 'notifications_off') },
              { icon: 'search', label: 'Buscar', fill: 0 as const, act: () => toast('Busca dentro da conversa chega numa próxima versão', 'search') },
              { icon: 'verified', label: verified[conv.contact.id] ? 'Verificado' : 'Verificar', fill: (verified[conv.contact.id] ? 1 : 0) as 0 | 1, act: () => { const v = !verified[conv.contact.id]; setVerified(x => ({ ...x, [conv.contact.id]: v })); if (v) toast(`${first} verificado`, 'verified'); } }].map(a => (
              <button key={a.label} className="h-bg3 a-94" onClick={a.act} style={{ height: 62, border: 'none', borderRadius: 16, background: 'var(--bg2)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, font: `550 12px ${F}`, transition: 'background .15s,transform .2s' }}>
                <Sym name={a.icon} size={21} fill={a.fill} />{a.label}
              </button>
            ))}
          </div>
          <div style={{ padding: '22px 20px 8px', font: `500 11px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>CÓDIGO DE SEGURANÇA</div>
          <div style={{ margin: '0 16px', padding: 14, borderRadius: 18, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {linked ? (
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>As chaves ficam no celular: confira o código de segurança por lá (Conversa → Detalhes).</div>
            ) : (
              <>
                <div className="sel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, font: `500 13.5px ${FM}`, textAlign: 'center' }}>
                  {safety.map((g, i) => <div key={i} style={{ animation: `piuUp .3s ${i * 0.04}s both` }}>{g}</div>)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>Compare com o aparelho de {first}, pessoalmente ou por outra via.</div>
              </>
            )}
          </div>
          <div style={{ padding: '22px 20px 8px', font: `500 11px ${FM}`, letterSpacing: '.05em', color: 'var(--ink2)' }}>MENSAGENS TEMPORÁRIAS</div>
          <div style={{ margin: '0 16px', display: 'flex', gap: 3, padding: 3, borderRadius: 11, background: 'var(--bg2)' }}>
            {[['off', 'Não'], ['1h', '1 h'], ['24h', '24 h'], ['7d', '7 dias']].map(([k, label]) => (
              <button key={k} onClick={() => { if (k !== 'off') { toast('Mensagens temporárias chegam numa próxima versão', 'timer'); return; } setTempV('off'); }} aria-pressed={tempV === k}
                style={{ flex: 1, height: 30, border: 'none', borderRadius: 8, background: tempV === k ? 'var(--bg)' : 'transparent', color: 'var(--ink)', font: `${tempV === k ? 600 : 450} 12.5px ${F}`, cursor: 'pointer', boxShadow: tempV === k ? '0 1px 3px rgba(0,0,0,.14)' : 'none', transition: 'background .2s,box-shadow .2s' }}>{label}</button>
            ))}
          </div>
          <div style={{ padding: '22px 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {linked ? (
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4, textAlign: 'center' }}>Remover ou bloquear: no celular, dono dos contatos.</div>
            ) : (
              <button className="h-bg2" onClick={remove} style={{ height: 44, borderRadius: 22, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--ink)', font: `600 14px ${F}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Sym name="person_remove" size={18} />Remover {first}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
