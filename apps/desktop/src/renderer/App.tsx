/**
 * Raiz do renderer, com a estrutura do protótipo (Piu Desktop.dc.html): barra de janela (macOS),
 * abertura 2,2 s + saída .45 s → entrada → app (trilho 68px, conversas / carteira / ajustes),
 * toast e diálogo. Todo o estado real vem do processo principal pela ponte `window.piu`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkStatus, Prefs, SessionInfo } from '../shared/types';
import icon192 from './brand/icon-192.png';
import { Auth } from './screens/Auth';
import { Chats } from './screens/Chats';
import { type Page, Settings } from './screens/Settings';
import { Splash } from './screens/Splash';
import { Wallet } from './screens/Wallet';
import { Dialog, type DialogSpec, F, FM, initialsOf, Sym, Toast } from './ui';

type Phase = 'splash' | 'auth' | 'app';
type Nav = 'chats' | 'wallet' | 'settings';

export function App() {
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
  const toastSeq = useRef(0);
  const bus = useMemo(() => new EventTarget(), []);

  const showToast = useCallback((text: string, icon = 'check') => {
    const seq = ++toastSeq.current;
    setToastRaw({ text, icon, seq });
    setTimeout(() => setToastRaw(t => (t && t.seq === seq ? null : t)), 2600);
  }, []);
  const setNav = (k: Nav) => { setNavRaw(k); setNavSeq(s => s + 1); };

  useEffect(() => {
    void window.piu.getSession().then(setSession);
    void window.piu.getPrefs().then(setPrefs);
    void window.piu.networkStatus().then(setNet);
    const refreshUnread = () => { void window.piu.listConversations().then(l => setUnread(l.reduce((a, c) => a + c.unread, 0))); };
    refreshUnread();
    const offs = [
      window.piu.on('session', s => { setSession(s); if (s.state === 'none') { setPhase('auth'); setNavRaw('chats'); } }),
      // Vínculo com o celular caiu enquanto o app estava aberto: volta à entrada para ler o QR de novo.
      window.piu.on('link', l => { if (l.state === 'dropped') { showToast(l.reason, 'phonelink_off'); setPhase(p => (p === 'app' ? 'auth' : p)); setNavRaw('chats'); } }),
      window.piu.on('prefs', setPrefs),
      window.piu.on('network', setNet),
      window.piu.on('notice', n => showToast(n.text, n.kind === 'error' ? 'error' : 'info')),
      window.piu.on('conversations', refreshUnread),
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
  useEffect(() => { if (phase === 'app' && session?.state === 'none') { setPhase('auth'); setNavRaw('chats'); } }, [phase, session?.state]);

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

  // Atalhos: ⌘K busca, ⌘, ajustes, ⌘I detalhes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || phase !== 'app') return;
      if (e.key === 'k') { e.preventDefault(); setNav('chats'); setTimeout(() => bus.dispatchEvent(new Event('search')), 50); }
      if (e.key === ',') { e.preventDefault(); setNav('settings'); }
      if (e.key === 'i') { e.preventDefault(); bus.dispatchEvent(new Event('info')); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [phase, bus]);

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    try { setPrefs(await window.piu.setPrefs(patch)); } catch (e) { showToast((e as Error).message, 'error'); }
  }, [showToast]);
  const onConversationOpen = useCallback((open: boolean) => { void window.piu.setConversationOpen(open); }, []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const mac = session?.platform === 'darwin';
  const linked = session?.state === 'linked';
  // Vinculado ao celular, o "eu" é o do celular (chega com o snapshot); até lá, um espaço reservado.
  const me = session?.me ?? (linked ? { publicId: 'piu:', anonId: 'piu:', name: '', nodePk: '' } : null);
  const pub = (prefs?.identity ?? 'public') === 'public';
  const links = net?.lan.links ?? 0;
  const winTitle = phase !== 'app' ? 'Piu' : nav === 'settings' ? 'Ajustes' : nav === 'wallet' ? 'Carteira' : 'Conversas';

  const askLogout = () => setDialog(linked
    ? { icon: 'phonelink_off', title: 'Desconectar do celular?', body: 'O computador deixa de espelhar as conversas. Nada fica guardado aqui; para voltar, leia o QR de novo.', primary: 'Desconectar',
      act: async () => { try { await window.piu.linkCancel(); setDialog(null); setPhase('auth'); setNavRaw('chats'); showToast('Desconectado do celular', 'phonelink_off'); } catch (e) { showToast((e as Error).message, 'error'); } } }
    : { icon: 'logout', title: 'Desconectar este computador?', body: 'A frase, as chaves, os contatos e as conversas são apagados daqui. Sem a frase anotada, a identidade se perde para sempre.', primary: 'Desconectar',
      act: async () => { try { await window.piu.eraseAll(); setDialog(null); setPhase('auth'); setNavRaw('chats'); showToast('Tudo apagado deste computador', 'logout'); } catch (e) { showToast((e as Error).message, 'error'); } } });

  const enterApp = async () => {
    const s = await window.piu.getSession();
    setSession(s);
    if (s.state === 'ready') { setPhase('app'); setNav('chats'); showToast('Anote a frase em Ajustes → Backup', 'key'); }
    if (s.state === 'linked') { setPhase('app'); setNav('chats'); showToast('Conectado ao celular', 'phonelink_ring'); }
  };

  const ready = !!session && !!prefs;
  return (
    <div data-piu-theme={document.documentElement.dataset.piuTheme} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', fontFamily: F, letterSpacing: '-0.005em', display: 'flex', flexDirection: 'column', transition: 'background-color .4s,color .4s' }}>
      {mac && (
        <div className="drag" style={{ height: 40, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 14px', background: 'var(--side)', borderBottom: '1px solid var(--line)', position: 'relative', zIndex: 3 }}>
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{winTitle}</div>
        </div>
      )}
      {(phase === 'splash' || !ready) && <Splash out={splashOut} />}
      {phase === 'auth' && ready && session!.state !== 'ready' && <Auth session={session!} onEnter={() => void enterApp()} toast={showToast} />}
      {phase === 'app' && ready && me && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div className="drag" style={{ width: 68, flex: 'none', background: 'var(--side)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0 16px', gap: 6, animation: 'piuRail .5s .05s cubic-bezier(.2,.85,.3,1) both' }}>
            <img src={icon192} alt="Piu" style={{ width: 36, height: 36, borderRadius: 10, display: 'block', marginBottom: 12, animation: 'piuPop .6s .1s cubic-bezier(.2,.9,.3,1.5) both' }} />
            {([['chats', 'forum', 'Conversas'], ['wallet', 'account_balance_wallet', 'Carteira'], ['settings', 'settings', 'Ajustes']] as [Nav, string, string][]).map(([k, icon, label]) => (
              <button key={k} className="a-90 nodrag" onClick={() => setNav(k)} title={label} aria-label={label} aria-current={nav === k}
                style={{ position: 'relative', width: 44, height: 44, border: 'none', borderRadius: 13, background: nav === k ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s,transform .25s cubic-bezier(.2,.9,.3,1.5)' }}>
                <Sym name={icon} size={22} fill={nav === k ? 1 : 0} wght={350} style={{ transition: 'font-variation-settings .2s' }} />
                {k === 'chats' && unread > 0 && <div style={{ position: 'absolute', top: 3, right: 2, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--ink)', color: 'var(--invink)', font: `650 10.5px ${F}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--side)', animation: 'piuPop .4s cubic-bezier(.2,.9,.3,1.5) both' }}>{unread > 99 ? '99+' : unread}</div>}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <div title="Nós por perto" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, font: `500 10px ${FM}`, color: 'var(--ink2)', marginBottom: 10 }}>
              <div style={{ position: 'relative', width: 8, height: 8 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: links > 0 ? 'var(--ink)' : 'var(--ink3)' }} />
                {links > 0 && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--ink)', animation: 'piuRingS 2s ease-out infinite' }} />}
              </div>{links} {links === 1 ? 'nó' : 'nós'}
            </div>
            <button className="h-scale108 nodrag" onClick={() => { if (linked) { showToast('Vinculado ao celular: a identidade é a dele', 'phonelink_ring'); return; } const ni = pub ? 'anon' : 'public'; void updatePrefs({ identity: ni }); showToast(ni === 'anon' ? 'Identidade anônima ativa' : 'Identidade pública ativa', ni === 'anon' ? 'visibility_off' : 'public'); }} title={linked ? 'Conectado ao celular' : 'Trocar identidade'} aria-label={linked ? 'Conectado ao celular' : 'Trocar identidade'}
              style={{ width: 40, height: 40, border: 'none', borderRadius: pub ? '50%' : 13, background: pub ? 'var(--ink)' : 'var(--bg3)', color: pub ? 'var(--invink)' : 'var(--ink)', font: `600 13px ${F}`, cursor: 'pointer', transition: 'border-radius .4s cubic-bezier(.2,.9,.3,1.3),background .3s,transform .3s cubic-bezier(.2,.9,.3,1.5)' }}>
              {linked ? (me.name ? initialsOf(me.name, me.publicId) : <Sym name="smartphone" size={20} />) : pub ? initialsOf(prefs!.displayName, me.publicId) : initialsOf('', me.anonId)}
            </button>
          </div>
          {nav === 'chats' && <Chats me={me} prefs={prefs!} net={net} linked={linked} toast={showToast} setDialog={setDialog} onConversationOpen={onConversationOpen} bus={bus} />}
          {nav === 'wallet' && <Wallet prefs={prefs!} updatePrefs={updatePrefs} toast={showToast} setDialog={setDialog} seq={navSeq} />}
          {nav === 'settings' && <Settings page={page} setPage={setPage} me={me} session={session!} prefs={prefs!} net={net} updatePrefs={updatePrefs} toast={showToast} setDialog={setDialog} onLogout={askLogout} />}
        </div>
      )}
      {toast && <Toast text={toast.text} icon={toast.icon} />}
      {dialog && <Dialog d={dialog} onClose={closeDialog} />}
    </div>
  );
}
