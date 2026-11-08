/**
 * Raiz do renderer, com a estrutura do protótipo (Piu Desktop.dc.html): barra de janela (macOS),
 * abertura 2,2 s + saída .45 s → entrada → app (trilho 68px, conversas / carteira / ajustes),
 * toast e diálogo. Todo o estado real vem do processo principal pela ponte `window.piu`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppLockState, NetworkStatus, Prefs, SessionInfo, UpdateState } from '../shared/types';
import icon192 from './brand/icon-192.png';
import { CallContext, CallOverlay, CallTitlePill, callToastText, WindowTitle } from './call';
import { useTr } from './call/CallContext';
import { useDesktopCall } from './call/useDesktopCall';
import { contactOf } from '../../../mobile/src/calls/callView';
import { applyLangPref, useT } from './i18n';
import { Auth } from './screens/Auth';
import { Chats } from './screens/Chats';
import { Guardian } from './screens/Guardian';
import { Locked } from './screens/Locked';
import { LockScreen } from './screens/LockScreen';
import { DiskBanner, UpdateBanner, UpdateDialog } from './screens/Updates';
import { type Page, Settings } from './screens/Settings';
import { Splash } from './screens/Splash';
import { type PayIntent, Wallet } from './screens/Wallet';
import { Dialog, type DialogSpec, F, FM, initialsOf, Sym, Toast } from './ui';

type Phase = 'splash' | 'auth' | 'app';
type Nav = 'chats' | 'wallet' | 'guardian' | 'settings';

export function App() {
  const t = useT();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [net, setNet] = useState<NetworkStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('splash');
  const [splashOut, setSplashOut] = useState(false);
  const [nav, setNavRaw] = useState<Nav>('chats');
  const [navSeq, setNavSeq] = useState(0);
  const [page, setPage] = useState<Page>('profile');
  const [unread, setUnread] = useState(0);
  const [toast, setToastRaw] = useState<{ text: string; icon: string; seq: number } | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  /** "Enviar LUNES" numa conversa: abre a Carteira em Enviar com o contato pré-selecionado. */
  const [payIntent, setPayIntent] = useState<PayIntent | null>(null);
  /** Nome da conversa aberta: título da janela em Conversas, como no protótipo (`winTitle` = nome da conversa ativa). */
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  /** Bloqueio do app (D1): bloqueado, só a tela de bloqueio aparece (nada de nomes nem conversas). */
  const [lock, setLock] = useState<AppLockState | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' });
  /** D3: diálogo do pacote pronto. */
  const [updDialog, setUpdDialog] = useState(false);
  /** D4e na lista: livre no disco quando abaixo de 1 GB. */
  const [lowFree, setLowFree] = useState<number | null>(null);
  const toastSeq = useRef(0);
  const locked = !!lock?.locked;
  /** Nome de cada contato (palco e avisos da chamada mostram quem é). */
  const [names, setNames] = useState<Record<string, string>>({});
  /** Recusou uma chamada com "Mensagem": Conversas abre a conversa de quem ligou com o rascunho pronto. */
  const [draftFor, setDraftFor] = useState<{ peer: string; seq: number } | null>(null);
  const onDraftDone = useCallback(() => setDraftFor(null), []);
  const bus = useMemo(() => new EventTarget(), []);

  const showToast = useCallback((text: string, icon = 'check') => {
    const seq = ++toastSeq.current;
    setToastRaw({ text, icon, seq });
    setTimeout(() => setToastRaw(t => (t && t.seq === seq ? null : t)), 2600);
  }, []);
  const setNav = (k: Nav) => { setNavRaw(k); setNavSeq(s => s + 1); };
  // Disco quase cheio (D4e) também avisa no fim da lista: confere ao abrir e a cada 10 min.
  useEffect(() => {
    if (phase !== 'app' || locked) return;
    const look = () => { void window.piu.storageDetail().then(d => setLowFree(d.low ? d.free : null)).catch(() => {}); };
    look();
    const t = setInterval(look, 10 * 60_000);
    return () => clearInterval(t);
  }, [phase, locked]);

  useEffect(() => {
    void window.piu.getSession().then(setSession);
    void window.piu.getPrefs().then(setPrefs);
    void window.piu.networkStatus().then(setNet);
    const refreshUnread = () => { void window.piu.listConversations().then(l => { setUnread(l.reduce((a, c) => a + c.unread, 0)); setNames(Object.fromEntries(l.map(c => [c.contact.id, c.contact.name]))); }).catch(() => {}); };
    void window.piu.appLockState().then(setLock).catch(() => {});
    void window.piu.updateState().then(setUpdate).catch(() => {});
    refreshUnread();
    const offs = [
      window.piu.on('session', s => { setSession(s); if (s.state === 'none' || s.state === 'locked') { setPhase('auth'); setNavRaw('chats'); } }),
      // Vínculo com o celular caiu enquanto o app estava aberto: volta à entrada para ler o QR de novo.
      window.piu.on('link', l => { if (l.state === 'dropped') { showToast(l.reason, 'phonelink_off'); setPhase(p => (p === 'app' ? 'auth' : p)); setNavRaw('chats'); } }),
      window.piu.on('prefs', setPrefs),
      window.piu.on('network', setNet),
      window.piu.on('notice', n => showToast(n.text, n.kind === 'error' ? 'error' : 'info')),
      window.piu.on('conversations', refreshUnread),
      window.piu.on('appLock', l => { setLock(l); if (l.locked) { setDialog(null); setUpdDialog(false); setChatTitle(null); } }),
      // Acabou de baixar e conferir (a pedido da pessoa) → pergunta antes de reiniciar (D3).
      window.piu.on('update', u => { setUpdate(prev => { if (u.state === 'ready' && prev.state === 'downloading') setUpdDialog(true); return u; }); }),
    ];
    // Abertura: 2,2 s na tela, .45 s de saída (como no protótipo), depois a entrada ou o app.
    const t1 = setTimeout(() => setSplashOut(true), 2200);
    const t2 = setTimeout(() => setPhase(p => (p === 'splash' ? 'auth' : p)), 2650);
    return () => { offs.forEach(f => f()); clearTimeout(t1); clearTimeout(t2); };
  }, [showToast]);
  // Com identidade guardada, a abertura leva direto ao app.
  useEffect(() => { if (phase === 'auth' && session?.state === 'ready') setPhase('app'); }, [phase, session?.state]);
  useEffect(() => { if (phase === 'auth' && session?.state === 'linked') { setPhase('app'); setNavRaw('chats'); } }, [phase, session?.state]);
  // Sem identidade nem celular vinculado, o app nunca fica aberto (qualquer ordem de eventos converge para a entrada).
  useEffect(() => { if (phase === 'app' && (session?.state === 'none' || session?.state === 'locked')) { setPhase('auth'); setNavRaw('chats'); } }, [phase, session?.state]);

  // Idioma e região escolhidos em Ajustes (ou os do sistema, em `auto`).
  useEffect(() => applyLangPref(prefs?.lang, prefs?.region), [prefs?.lang, prefs?.region]);

  // Tema e animações como atributos na raiz (tokens do protótipo em styles.css).
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = prefs?.theme ?? 'system';
      root.dataset.piuTheme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      root.dataset.anim = prefs && !prefs.animations ? 'off' : 'on';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs]);

  // Atalhos (Ajustes → Atalhos): ⌘K busca, ⌘] / ⌘[ próxima / anterior, ⌘, ajustes, ⌘N nova conversa, ⌘I detalhes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || phase !== 'app' || locked) return;
      const toChats = (ev: string) => { e.preventDefault(); setNav('chats'); setTimeout(() => bus.dispatchEvent(new Event(ev)), 50); };
      if (e.key === 'k') toChats('search');
      if (e.key === ']') toChats('next');
      if (e.key === '[') toChats('prev');
      if (e.key === 'n' && !e.shiftKey) toChats('new');
      // ⌘⇧M silencia (ou devolve o som) a conversa aberta.
      if (e.key.toLowerCase() === 'm' && e.shiftKey) { e.preventDefault(); bus.dispatchEvent(new Event('mute')); }
      if (e.key === ',') { e.preventDefault(); setNav('settings'); }
      if (e.key === 'i') { e.preventDefault(); bus.dispatchEvent(new Event('info')); }
      // ⌘L / Ctrl L bloqueia (precisa da senha do Piu). O menu "Piu → Bloquear o Piu" tem o mesmo atalho.
      if (e.key.toLowerCase() === 'l' && !e.shiftKey) { e.preventDefault(); void window.piu.lockApp().then(setLock).catch(err => showToast((err as Error).message, 'lock')); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [phase, bus, showToast, locked]);

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    try { setPrefs(await window.piu.setPrefs(patch)); } catch (e) { showToast((e as Error).message, 'error'); }
  }, [showToast]);
  const onConversationOpen = useCallback((open: boolean) => { void window.piu.setConversationOpen(open); }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const onPay = useCallback((contactId: string) => { setPayIntent(p => ({ contactId, seq: (p?.seq ?? 0) + 1 })); setNav('wallet'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mac = session?.platform === 'darwin';
  const linked = session?.state === 'linked';
  // Chamada de voz: só com identidade própria, app aberto e desbloqueado (espelhando o celular, não há).
  const callHost = useDesktopCall(phase === 'app' && session?.state === 'ready' && !locked, peer => names[peer] ?? '', text => showToast(text, 'error'));
  const tr = useTr();
  const nameRef = useRef(names);
  nameRef.current = names;
  useEffect(() => {
    const offs = [
      window.piu.on('callToast', n => showToast(callToastText(tr, n.text, n.peer ? contactOf(nameRef.current[n.peer] ?? '') : undefined), 'check')),
      window.piu.on('callDraft', d => { setDraftFor(p => ({ peer: d.peer, seq: (p?.seq ?? 0) + 1 })); setNav('chats'); }),
    ];
    return () => offs.forEach(f => f());
  }, [showToast, tr]); // eslint-disable-line react-hooks/exhaustive-deps
  // O palco vive em Conversas: ligar ou atender estando em Carteira/Ajustes leva para lá.
  const callPhase = callHost?.scene?.state.phase;
  useEffect(() => { if ((callPhase === 'calling' || callPhase === 'active') && nav !== 'chats') setNav('chats'); }, [callPhase]); // eslint-disable-line react-hooks/exhaustive-deps
  // Vinculado ao celular, o "eu" é o do celular (chega com o snapshot); até lá, um espaço reservado.
  const me = session?.me ?? (linked ? { publicId: 'piu:', anonId: 'piu:', name: '', nodePk: '' } : null);
  const pub = (prefs?.identity ?? 'public') === 'public';
  const links = net?.lan.links ?? 0;
  const winTitle = phase !== 'app' || locked ? 'Piu' : nav === 'settings' ? t('app.nav.settings') : nav === 'wallet' ? t('app.nav.wallet') : nav === 'guardian' ? t('app.nav.guardian') : (chatTitle ?? 'Piu');
  // Linux e Windows usam a barra de título do sistema: o título dela acompanha o do protótipo
  // (<WindowTitle>, que em chamada vira "{nome} · mm:ss").

  const askLogout = () => setDialog(linked
    ? { icon: 'phonelink_off', title: t('app.logout.linked.title'), body: t('app.logout.linked.body'), primary: t('app.logout.disconnect'),
      act: async () => { try { await window.piu.linkCancel(); setDialog(null); setPhase('auth'); setNavRaw('chats'); showToast(t('app.logout.linked.done'), 'phonelink_off'); } catch (e) { showToast((e as Error).message, 'error'); } } }
    : { icon: 'logout', title: t('app.logout.local.title'), body: t('app.logout.local.body'), primary: t('app.logout.disconnect'),
      act: async () => { try { await window.piu.eraseAll(); setDialog(null); setPhase('auth'); setNavRaw('chats'); showToast(t('app.logout.local.done'), 'logout'); } catch (e) { showToast((e as Error).message, 'error'); } } });

  const enterApp = async () => {
    const s = await window.piu.getSession();
    setSession(s);
    if (s.state === 'ready') { setPhase('app'); setNav('chats'); showToast(t('app.enter.backupHint'), 'key'); }
    if (s.state === 'linked') { setPhase('app'); setNav('chats'); showToast(t('app.linked'), 'phonelink_ring'); }
  };

  const ready = !!session && !!prefs;
  return (
    <CallContext.Provider value={callHost}>
    <div data-piu-theme={document.documentElement.dataset.piuTheme} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', fontFamily: F, letterSpacing: '-0.005em', display: 'flex', flexDirection: 'column', transition: 'background-color .4s,color .4s' }}>
      {mac && (
        <div className="drag" style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 14px', background: 'var(--side)', borderBottom: '1px solid var(--line)', position: 'relative', zIndex: 3 }}>
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>{winTitle}<CallTitlePill /></div>
        </div>
      )}
      {(phase === 'splash' || !ready) && <Splash out={splashOut} />}
      {/* Cofre bloqueado (A-01): só "Tentar de novo"; nunca a entrada com "Criar identidade" por cima da frase. */}
      {phase === 'auth' && ready && session!.state === 'locked' && <Locked session={session!} onSession={setSession} toast={showToast} />}
      {phase === 'auth' && ready && session!.state !== 'ready' && session!.state !== 'locked' && <Auth session={session!} onEnter={() => void enterApp()} toast={showToast} />}
      {phase === 'app' && ready && me && locked && lock && <LockScreen state={lock} links={links} relay={prefs!.relay && !linked} onState={setLock} />}
      {phase === 'app' && ready && me && !locked && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div className="drag" style={{ width: 68, flex: 'none', background: 'var(--side)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0 16px', gap: 6, animation: 'piuRail .5s .05s cubic-bezier(.2,.85,.3,1) both' }}>
            <img src={icon192} alt="Piu" style={{ width: 36, height: 36, borderRadius: 10, display: 'block', marginBottom: 12, animation: 'piuPop .6s .1s cubic-bezier(.2,.9,.3,1.5) both' }} />
            {([['chats', 'forum', t('app.nav.chats')], ['wallet', 'account_balance_wallet', t('app.nav.wallet')], ['guardian', 'hub', t('app.nav.guardian')], ['settings', 'settings', t('app.nav.settings')]] as [Nav, string, string][]).map(([k, icon, label]) => (
              <button key={k} className="a-90 nodrag" onClick={() => setNav(k)} title={label} aria-label={label} aria-current={nav === k}
                style={{ position: 'relative', width: 44, height: 44, border: 'none', borderRadius: 13, background: nav === k ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s,transform .25s cubic-bezier(.2,.9,.3,1.5)' }}>
                <Sym name={icon} size={22} fill={nav === k ? 1 : 0} wght={350} style={{ transition: 'font-variation-settings .2s' }} />
                {k === 'settings' && (update.state === 'ready' || update.state === 'bad') && nav !== 'settings' && <div aria-label={t('app.rail.update')} style={{ position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: '50%', background: 'var(--ink)', boxShadow: '0 0 0 2px var(--side)', animation: 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' }} />}
                {k === 'chats' && unread > 0 && <div style={{ position: 'absolute', top: 3, right: 2, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--ink)', color: 'var(--invink)', font: `650 10.5px ${F}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--side)', animation: 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' }}>{unread > 99 ? '99+' : unread}</div>}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <div title={t('app.rail.nodesNear')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, font: `500 10px ${FM}`, color: 'var(--ink2)', marginBottom: 10 }}>
              <div style={{ position: 'relative', width: 8, height: 8 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: links > 0 ? 'var(--ink)' : 'var(--ink3)' }} />
                {links > 0 && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />}
              </div>{links === 0 ? t('app.rail.nodesZero') : t('app.rail.nodes', { count: links })}
            </div>
            <button className="h-scale108 nodrag" onClick={() => { if (linked) { showToast(t('app.identity.linkedHint'), 'phonelink_ring'); return; } const ni = pub ? 'anon' : 'public'; void updatePrefs({ identity: ni }); showToast(ni === 'anon' ? t('app.identity.anonOn') : t('app.identity.publicOn'), ni === 'anon' ? 'visibility_off' : 'public'); }} title={linked ? t('app.linked') : t('app.identity.switch')} aria-label={linked ? t('app.linked') : t('app.identity.switch')}
              style={{ width: 40, height: 40, border: 'none', borderRadius: pub ? '50%' : 13, background: pub ? 'var(--ink)' : 'var(--bg3)', color: pub ? 'var(--invink)' : 'var(--ink)', font: `600 13px ${F}`, cursor: 'pointer', transition: 'border-radius .4s cubic-bezier(.2,.9,.3,1.3),background .3s,transform .3s cubic-bezier(.2,.9,.3,1.5)' }}>
              {linked ? (me.name ? initialsOf(me.name, me.publicId) : <Sym name="smartphone" size={20} />) : pub ? initialsOf(prefs!.displayName, me.publicId) : initialsOf('', me.anonId)}
            </button>
          </div>
          {nav === 'chats' && <Chats me={me} prefs={prefs!} net={net} linked={linked} toast={showToast} setDialog={setDialog} onConversationOpen={onConversationOpen} bus={bus} onPay={onPay} onTitle={setChatTitle} mac={mac} draftFor={draftFor} onDraftDone={onDraftDone}
            footer={<>
              {lowFree !== null && <DiskBanner free={lowFree} onOpen={() => { setPage('storage'); setNav('settings'); }} />}
              {update.state === 'ready' && <UpdateBanner s={update} onOpen={() => setUpdDialog(true)} />}
              {/* E2f: com "Avisar quando sair versão nova" ligado; "Ver" abre Sistema → Atualizações (E2c). */}
              {update.state === 'available' && prefs!.updateNotify && <UpdateBanner s={update} onOpen={() => { setPage('system'); setNav('settings'); }} />}
            </>} />}
          {nav === 'wallet' && <Wallet prefs={prefs!} updatePrefs={updatePrefs} toast={showToast} setDialog={setDialog} seq={navSeq} linked={linked} payIntent={payIntent} />}
          {nav === 'guardian' && <Guardian hostname={session!.hostname} toast={showToast} setDialog={setDialog} onCancel={() => setNav('chats')} />}
          {nav === 'settings' && <Settings onGuardian={() => setNav('guardian')} page={page} setPage={setPage} me={me} session={session!} prefs={prefs!} net={net} updatePrefs={updatePrefs} toast={showToast} setDialog={setDialog} onLogout={askLogout} lock={lock} update={update} onUpdateDialog={() => setUpdDialog(true)} />}
        </div>
      )}
      <WindowTitle base={winTitle} />
      {phase === 'app' && ready && me && !locked && <CallOverlay mac={mac} top={mac ? 40 : 0} />}
      {toast && <Toast text={toast.text} icon={toast.icon} />}
      {dialog && !locked && <Dialog d={dialog} onClose={closeDialog} />}
      {updDialog && !locked && update.state === 'ready' && <UpdateDialog s={update} top={mac ? 40 : 0} onClose={() => setUpdDialog(false)} onInstall={() => void window.piu.installUpdate().catch(e => { setUpdDialog(false); showToast((e as Error).message, 'error'); })} />}
    </div>
    </CallContext.Provider>
  );
}
