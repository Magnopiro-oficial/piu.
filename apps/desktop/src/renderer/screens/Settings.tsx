/**
 * Ajustes (protótipo `isSettingsNav`): menu 248px com as páginas e "Desconectar este computador";
 * página com título 30px, descrição e seções em cartões bg2 (linhas de 56px: interruptor, segmentado,
 * valor, botão, teclas). O que não existe no computador diz por quê, com o estado real (nada "em breve").
 */
import { type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { screenSecurityDesc, screenSecurityFor } from '../../shared/screenSecurity';
import type { AppLockState, BlockedContact, GuardianState, MeInfo, NetworkStatus, PeerInfo, Prefs, SessionInfo, StorageUsage, UpdateState } from '../../shared/types';
import { fmtBytes } from '../format';
import { fmtDate, type Key, type Lang, type LangPref, LANGS, localeOf, matchLang, regionSample, resolveLang, systemLangs, tIn, useT } from '../i18n';
import { Btn, type DialogSpec, F, FM, handleOf, initialsOf, Seg, Sym, Toggle, useSecretScreen } from '../ui';
import { Kbd, Row, Section, Val } from './settingsUi';
import { BlockedPage } from './Blocked';
import { GuardianCard } from './Guardian';
import { StoragePage } from './Storage';
import { Line, Switch46, UpdateProgress, UpdateRejected, UpdateResult, whenShort } from './Updates';

export type Page = 'profile' | 'devices' | 'notifs' | 'privacy' | 'look' | 'chats' | 'network' | 'system' | 'backup' | 'lang' | 'keys' | 'blocked' | 'storage';
/** Subpáginas (D2, D4): abrem de uma linha e destacam a página de origem no menu. */
const PARENT: Partial<Record<Page, Page>> = { blocked: 'privacy', storage: 'chats' };

interface Props {
  page: Page; setPage: (p: Page) => void;
  me: MeInfo; session: SessionInfo; prefs: Prefs; net: NetworkStatus | null;
  updatePrefs: (p: Partial<Prefs>) => Promise<void>;
  toast: (text: string, icon?: string) => void;
  setDialog: Dispatch<SetStateAction<DialogSpec | null>>;
  onLogout: () => void;
  /** Bloqueio do app (senha do Piu, Touch ID). */
  lock: AppLockState | null;
  update: UpdateState;
  /** Abre o diálogo D3 (pacote pronto). */
  onUpdateDialog: () => void;
  /** Abre a tela do ponto Piu (guardião). */
  onGuardian?: () => void;
}

/** Rótulo guardado como chave do dicionário; traduzido no render. */
const PAGES: [Page, string, Key][] = [
  ['profile', 'account_circle', 'settings.page.profile'], ['devices', 'devices', 'settings.page.devices'], ['notifs', 'notifications', 'settings.page.notifs'], ['privacy', 'shield_lock', 'settings.page.privacy'],
  ['look', 'palette', 'settings.page.look'], ['chats', 'chat', 'settings.page.chats'], ['network', 'hub', 'settings.page.network'], ['system', 'laptop_mac', 'settings.page.system'], ['backup', 'key', 'settings.page.backup'], ['lang', 'translate', 'settings.page.lang'], ['keys', 'keyboard', 'settings.page.keys'],
];

/** Nome do idioma no idioma da interface (ex.: "Inglês" em português, "English" em inglês). */
function langName(code: Lang, ui: Lang): string {
  try { return new Intl.DisplayNames([localeOf(ui)], { type: 'language' }).of(code === 'zh' ? 'zh-Hans' : code) ?? code; } catch { return code; }
}



/** O estado da senha é limpo ao fechar o formulário; a frase nunca passa por ele. */
function BackupExport({ toast }: { toast: Props['toast'] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const clear = () => { setPassword(''); setConfirmation(''); setOpen(false); };
  const error = password.length < 10 ? t('settings.backup.min') : new Set(password).size < 5 ? t('settings.pw.repetitive') : password !== confirmation ? t('settings.pw.mismatch') : null;
  const submit = async () => {
    if (busy || error) return;
    setBusy(true);
    try {
      const result = await window.piu.exportIdentityBackup(password);
      clear();
      if (result === 'saved') toast(t('settings.backup.saved'), 'check');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('settings.backup.saveFailed'), 'error');
    } finally { setPassword(''); setConfirmation(''); setBusy(false); }
  };
  const input: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 44, borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 12px', font: `400 14px ${F}` };
  return <>
    <Row name={t('settings.backup.export')} desc={t('settings.backup.exportDesc')} icon="download" first>
      <Btn onClick={() => { if (!busy) { if (open) clear(); else setOpen(true); } }}>{open ? t('common.cancel') : t('settings.backup.exportBtn')}</Btn>
    </Row>
    {open && <form onSubmit={e => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{t('settings.backup.intro')}</div>
      <label style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.backup.password')}<input style={input} type="password" autoComplete="off" spellCheck={false} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.pw.confirm')}<input style={input} type="password" autoComplete="off" spellCheck={false} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
      {(password || confirmation) && error && <div role="status" style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{error}</div>}
      <button type="submit" disabled={busy || !!error} style={{ height: 44, border: 'none', borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer', opacity: busy || error ? .5 : 1 }}>{busy ? t('settings.backup.saving') : t('settings.backup.choose')}</button>
    </form>}
  </>;
}


/**
 * Senha do Piu (Bloqueio): criar, trocar ou remover. O Electron não confere a senha do sistema, então o
 * bloqueio usa esta, guardada só como scrypt com sal (main/lockPassword.ts). Os campos são limpos ao fechar.
 */
function LockPassword({ lock, toast }: { lock: AppLockState; toast: Props['toast'] }) {
  const t = useT();
  const [mode, setMode] = useState<null | 'set' | 'remove'>(null);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setMode(null); setCur(''); setNext(''); setConf(''); };
  const has = lock.hasPassword;
  const problem = mode === 'remove' ? (cur ? null : t('settings.lockpw.needCurrent')) : [...next].length < 6 ? t('settings.lockpw.min') : new Set(next).size < 3 ? t('settings.pw.repetitive') : next !== conf ? t('settings.pw.mismatch') : has && !cur ? t('settings.lockpw.needCurrent') : null;
  const submit = async () => {
    if (busy || problem) return;
    setBusy(true);
    try {
      if (mode === 'remove') { await window.piu.removeLockPassword(cur); toast(t('settings.lockpw.removed'), 'lock_open'); }
      else { await window.piu.setLockPassword(has ? cur : null, next); toast(has ? t('settings.lockpw.changed') : t('settings.lockpw.created'), 'lock'); }
      close();
    } catch (e) { toast((e as Error).message, 'error'); setCur(''); }
    finally { setBusy(false); }
  };
  const input: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 44, borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)', padding: '0 12px', font: `400 14px ${F}`, marginTop: 4 };
  return <>
    <Row name={t('settings.lockpw.name')} first icon="key"
      desc={!lock.storable ? t('settings.lockpw.noVault') : has ? (lock.touchId ? t('settings.lockpw.asksTouch') : t('settings.lockpw.asks')) : t('settings.lockpw.createHint')}>
      {lock.storable && (mode ? <Btn onClick={close}>{t('common.cancel')}</Btn> : <>
        {has && <Btn onClick={() => setMode('remove')}>{t('common.remove')}</Btn>}
        <Btn primary={!has} onClick={() => setMode('set')}>{has ? t('settings.lockpw.change') : t('settings.lockpw.create')}</Btn>
      </>)}
    </Row>
    {mode && <form onSubmit={e => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.45 }}>{mode === 'remove' ? t('settings.lockpw.removeInfo') : t('settings.lockpw.setInfo')}</div>
      {(has || mode === 'remove') && <label style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.lockpw.current')}<input style={input} type="password" autoComplete="off" spellCheck={false} value={cur} onChange={e => setCur(e.target.value)} disabled={busy} autoFocus /></label>}
      {mode === 'set' && <>
        <label style={{ fontSize: 13, fontWeight: 600 }}>{has ? t('settings.lockpw.new') : t('settings.lockpw.name')}<input style={input} type="password" autoComplete="off" spellCheck={false} value={next} onChange={e => setNext(e.target.value)} disabled={busy} autoFocus={!has} /></label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.pw.confirm')}<input style={input} type="password" autoComplete="off" spellCheck={false} value={conf} onChange={e => setConf(e.target.value)} disabled={busy} /></label>
      </>}
      {(cur || next || conf) && problem && <div role="status" style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{problem}</div>}
      <button type="submit" disabled={busy || !!problem} style={{ height: 44, border: 'none', borderRadius: 22, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer', opacity: busy || problem ? .5 : 1 }}>{busy ? t('settings.lockpw.checking') : mode === 'remove' ? t('settings.lockpw.removeBtn') : has ? t('settings.lockpw.changeBtn') : t('settings.lockpw.createBtn')}</button>
    </form>}
  </>;
}

export function Settings(p: Props) {
  const { page, setPage, me, session, prefs, net, updatePrefs, toast, setDialog } = p;
  const t = useT();
  const mac = session.platform === 'darwin', win = session.platform === 'win32';
  const mod = mac ? '⌘' : 'Ctrl';
  const [seq, setSeq] = useState(0);
  const go = (k: Page) => { if (k !== page) { setPage(k); setSeq(s => s + 1); } };
  const { lock, update } = p;
  /** E2: o resultado de "Verificar agora" fica até "Fechar"; a última verificação vale para a linha. */
  const [resultHidden, setResultHidden] = useState(update.state === 'idle');
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  useEffect(() => {
    const at = update.state === 'latest' ? update.at : update.state === 'available' || update.state === 'error' ? update.at ?? null : null;
    if (at) setLastCheck(at);
    // Resultado novo (verificação a pedido ou a do "Avisar" ao abrir): aparece; "Fechar" esconde até o próximo.
    if (update.state !== 'idle') setResultHidden(false);
  }, [update]);
  const hasPw = !!lock?.hasPassword;
  const pub = prefs.identity === 'public';
  const myId = pub ? me.publicId : me.anonId;
  const fp = me.nodePk.slice(0, 32).match(/.{4}/g) ?? [];
  const [name, setName] = useState(prefs.displayName);
  useEffect(() => setName(prefs.displayName), [prefs.displayName]);
  const [bkWords, setBkWords] = useState<string[] | null>(null);
  const [bkShown, setBkShown] = useState(false);
  const hidePhrase = () => { setBkShown(false); setBkWords(null); };
  // Backup (frase e senha do arquivo) sem captura de tela (M-02); a frase some sozinha em 60 s, ao sair
  // da página ou quando a janela perde o foco (M-01).
  useSecretScreen('phrase', page === 'backup');
  useEffect(() => {
    if (!bkShown) return;
    const t = setTimeout(hidePhrase, 60_000);
    window.addEventListener('blur', hidePhrase);
    return () => { clearTimeout(t); window.removeEventListener('blur', hidePhrase); };
  }, [bkShown]);
  useEffect(() => { if (page !== 'backup') hidePhrase(); }, [page]);
  const [peerInput, setPeerInput] = useState('');
  const linked = session.state === 'linked';
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  useEffect(() => { if ((page === 'privacy' || page === 'blocked') && !linked) void window.piu.listBlocked().then(setBlocked).catch(() => setBlocked([])); }, [page, linked]);
  const [point, setPoint] = useState<GuardianState | null>(null);
  useEffect(() => {
    if (page !== 'network') return;
    void window.piu.guardianState().then(setPoint).catch(() => setPoint(null));
    return window.piu.on('guardian', setPoint);
  }, [page]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  useEffect(() => { if (page === 'chats') void window.piu.storageUsage().then(setUsage).catch(() => setUsage(null)); }, [page]);
  const askUnblock = (b: BlockedContact) => setDialog({ icon: 'lock_open', title: b.name ? t('settings.unblock.title', { name: b.name }) : t('settings.unblock.titleNoName'), body: t('settings.unblock.body'), primary: t('settings.unblock.action'),
    act: async () => { try { setBlocked(await window.piu.unblockContact(b.id)); setDialog(null); toast(b.name ? t('settings.unblock.done', { name: b.name }) : t('settings.unblock.doneNoName'), 'lock_open'); } catch (e) { toast((e as Error).message, 'error'); } } });
  /** Vinculado ao celular, os ajustes do mensageiro são os do celular. */
  const phoneDesc = t('settings.phoneDesc');
  const sec = screenSecurityFor(session.platform, prefs.screenSecurity, { conversation: true, secret: false });
  const osName = mac ? 'macOS' : win ? 'Windows' : 'Linux';

  const titles: Record<Page, [string, string]> = {
    profile: [t('settings.profile.title'), t('settings.profile.desc')],
    devices: [t('settings.devices.title'), t('settings.devices.desc')],
    notifs: [t('settings.notifs.title'), t('settings.notifs.desc', { os: osName })],
    privacy: [t('settings.privacy.title'), t('settings.privacy.desc')],
    look: [t('settings.look.title'), t('settings.look.desc')],
    chats: [t('settings.chats.title'), t('settings.chats.desc')],
    network: [t('settings.network.title'), t('settings.network.desc')],
    // E2 (Piu 12): "Sistema" e logo as atualizações, sem a linha de descrição.
    system: [t('settings.system.title'), ''],
    backup: [t('settings.backup.title'), t('settings.backup.desc')],
    lang: [t('settings.lang.title'), t('settings.lang.desc')],
    keys: [t('settings.keys.title'), t('settings.keys.desc')],
    blocked: ['', ''], storage: ['', ''],
  };
  const sub = !!PARENT[page];

  // QR do perfil (protótipo `profileQr`): o mesmo cartão `piu1:` do código, como QR legível — o celular lê em "Meu código" → escanear.
  const showQr = async () => {
    try { const card = await window.piu.myCard(prefs.identity); setDialog({ title: t('settings.qr.title'), body: t('settings.qr.body'), primary: t('common.done'), hasSecond: false, qr: card.card, act: () => setDialog(null) }); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const showCode = async () => {
    try { const card = await window.piu.myCard(prefs.identity); setDialog({ title: t('settings.qr.title'), body: t('settings.code.body'), primary: t('common.copy'), code: card.card, act: () => { void window.piu.copy(card.card); setDialog(null); toast(t('settings.code.copied'), 'content_copy'); } }); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const addPeer = async () => { try { await window.piu.addPeer(peerInput); setPeerInput(''); toast(t('settings.network.added'), 'hub'); } catch (e) { toast((e as Error).message, 'error'); } };
  const peerState = (x: PeerInfo) => (x.state === 'connected' ? t('settings.network.connected') : x.state === 'connecting' ? t('settings.network.connecting') : t('settings.network.failed'));

  const body = (() => {
    switch (page) {
      case 'profile': return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: 18, borderRadius: 20, background: 'var(--bg2)', marginBottom: 6, animation: 'piuUp .45s .05s both' }}>
            <div style={{ width: 72, height: 72, borderRadius: pub ? '50%' : 24, background: pub ? 'var(--ink)' : 'var(--bg3)', color: pub ? 'var(--invink)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 24px ${F}`, flex: 'none', transition: 'border-radius .4s cubic-bezier(.2,.9,.3,1.3),background .3s', animation: 'piuPop .55s .1s cubic-bezier(.2,.9,.3,1.4) both' }}>{pub ? initialsOf(prefs.displayName, me.publicId) : initialsOf('', me.anonId)}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pub ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={t('settings.profile.namePh')} aria-label={t('settings.profile.namePh')} onBlur={() => { if (name.trim() !== prefs.displayName) void updatePrefs({ displayName: name }).then(() => toast(t('settings.profile.nameSaved'), 'check')); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    style={{ height: 40, maxWidth: 320, flex: 1, borderRadius: 11, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 12px', font: `600 16px ${F}`, color: 'var(--ink)', outline: 'none' }} />
                </div>
              ) : <div style={{ fontSize: 18, fontWeight: 650 }}>{t('settings.profile.anon', { id: me.anonId.replace(/^piu:/, '').slice(0, 4).toUpperCase() })}</div>}
              <div className="sel" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', font: `500 12px ${FM}`, color: 'var(--ink2)' }}>
                {fp.map((g, i) => <span key={i} style={{ animation: `piuUp .35s ${0.15 + i * 0.03}s both` }}>{g.toUpperCase()}</span>)}
              </div>
            </div>
          </div>
          <Section title={t('settings.profile.identity')} i={0}>
            <Row name={t('settings.profile.active')} desc={t('settings.profile.activeDesc')} first><Seg value={prefs.identity} opts={[['public', t('settings.profile.public')], ['anon', t('settings.profile.anonOpt')]]} onChange={v => void updatePrefs({ identity: v })} /></Row>
            <Row name={t('settings.profile.code')} desc={t('settings.profile.codeDesc')} onClick={showCode}><Val>{handleOf(myId)}</Val></Row>
            <Row name={t('settings.profile.qr')} desc={t('settings.profile.qrDesc')} icon="qr_code_2"><Btn onClick={() => void showQr()}>{t('common.show')}</Btn></Row>
          </Section>
          <Section title={t('settings.profile.nodeKey')} i={1}>
            <Row name={t('settings.profile.lnnp')} desc={t('settings.profile.lnnpDesc')} first><Val>{me.nodePk.slice(0, 16)}</Val></Row>
          </Section>
        </>
      );
      case 'devices': return (
        <>
          <Section title={t('settings.devices.connected')} i={0}>
            <Row name={t('settings.devices.this')} desc={t('settings.devices.thisDesc', { host: session.hostname })} icon={mac ? 'laptop_mac' : 'computer'} first><Val>{osName}</Val></Row>
            {/* Vinculado: o celular é o aparelho principal; desconectar é o mesmo "Desconectar do celular" do menu. */}
            {session.state === 'linked' && <Row name={t('settings.devices.phone')} desc={t('settings.devices.phoneDesc')} icon="smartphone"><Btn onClick={p.onLogout}>{t('settings.devices.disconnect')}</Btn></Row>}
          </Section>
          <Section title={t('settings.devices.new')} i={1}>
            {/* Decisão de segurança (docs/auditoria-final-2026-11-06/desktop.md): sem chave por aparelho, vincular um
                computador a outro seria copiar as chaves. O caminho seguro existe: o celular vincula cada computador. */}
            <Row name={t('settings.devices.connectOther')} desc={t('settings.devices.connectOtherDesc')} icon="qr_code_2" first><Val>{t('settings.devices.viaPhone')}</Val></Row>
          </Section>
        </>
      );
      case 'notifs': return (
        <>
          <Section title={t('settings.notifs.about')} i={0}>
            <Row name={t('settings.notifs.direct')} first><Toggle on={prefs.notifications} onChange={v => void updatePrefs({ notifications: v })} label={t('settings.notifs.direct')} /></Row>
            <Row name={t('settings.notifs.groups')}><Toggle on={prefs.notifGroups} onChange={v => void updatePrefs({ notifGroups: v })} label={t('settings.notifs.groups')} /></Row>
            {/* O computador não tem "marcar canal como importante": o interruptor vale para todos os canais que você segue. */}
            <Row name={t('settings.notifs.channels')} desc={t('settings.notifs.channelsDesc')}><Toggle on={prefs.notifChannels} onChange={v => void updatePrefs({ notifChannels: v })} label={t('settings.notifs.channels')} /></Row>
            <Row name={t('settings.notifs.nearby')} desc={t('settings.notifs.nearbyDesc')}><Val>{t('settings.notifs.phoneOnly')}</Val></Row>
            <Row name={t('settings.notifs.wallet')} desc={t('settings.notifs.walletDesc')}><Toggle on={prefs.notifWallet} onChange={v => void updatePrefs({ notifWallet: v })} label={t('settings.notifs.wallet')} /></Row>
            {/* Alertas da comunidade (main/mesh.ts → `communityAlert`; política em shared/notifyPolicy.ts). */}
            <Row name={t('settings.notifs.emergency')} desc={t('settings.notifs.emergencyDesc')}><Toggle on={prefs.notifAlerts} onChange={v => void updatePrefs({ notifAlerts: v })} label={t('settings.notifs.emergency')} /></Row>
          </Section>
          <Section title={t('settings.notifs.how')} i={1}>
            <Row name={t('settings.notifs.preview')} first><Seg value={prefs.notifPreview} opts={[['always', t('settings.notifs.previewAll')], ['name', t('settings.notifs.previewName')], ['never', t('settings.notifs.previewNone')]]} onChange={v => void updatePrefs({ notifPreview: v })} /></Row>
            <Row name={t('settings.notifs.sound')}><Toggle on={prefs.notifSound} onChange={v => void updatePrefs({ notifSound: v })} label={t('settings.notifs.sound')} /></Row>
            <Row name={mac ? t('settings.notifs.badgeDock') : t('settings.notifs.badge')} desc={win ? t('settings.notifs.badgeWin') : mac ? t('settings.notifs.badgeMac') : t('settings.notifs.badgeLinux')}>
              <Toggle on={!win && prefs.badge} disabled={win} onChange={v => void updatePrefs({ badge: v })} label={t('settings.notifs.badge')} />
            </Row>
            <Row name={t('settings.notifs.dnd')} desc={t('settings.notifs.dndDesc')}><Toggle on={prefs.dnd} onChange={v => void updatePrefs({ dnd: v })} label={t('settings.notifs.dnd')} /></Row>
            <Row name={t('settings.notifs.test')} desc={t('settings.notifs.testDesc')} icon="notifications_active"><Btn onClick={() => void window.piu.testNotification().then(() => toast(t('settings.notifs.testSent'), 'notifications_active'))}>{t('settings.notifs.testBtn')}</Btn></Row>
          </Section>
        </>
      );
      case 'privacy': return (
        <>
          <Section title={t('settings.privacy.visibility')} i={0}>
            <Row name={t('settings.privacy.receipts')} desc={linked ? phoneDesc : t('settings.privacy.receiptsDesc')} first><Toggle on={prefs.readReceipts} disabled={linked} onChange={v => void updatePrefs({ readReceipts: v })} label={t('settings.privacy.receipts')} /></Row>
            <Row name={t('settings.privacy.typing')} desc={linked ? phoneDesc : undefined}><Toggle on={prefs.typing} disabled={linked} onChange={v => void updatePrefs({ typing: v })} label={t('settings.privacy.typing')} /></Row>
            {/* Mesmo efeito do celular (`Messenger.setDiscovery`). Sem Por perto no computador, Todos e Contatos aceitam igual. */}
            <Row name={t('settings.privacy.find')} desc={linked ? phoneDesc : prefs.find === 'none' ? t('settings.privacy.findNone') : t('settings.privacy.findAny')}>
              {linked ? <Val>{t('settings.onPhone')}</Val> : <Seg value={prefs.find} opts={[['all', t('settings.privacy.findAll')], ['contacts', t('settings.privacy.findContacts')], ['none', t('settings.privacy.findNobody')]]} onChange={v => void updatePrefs({ find: v })} />}
            </Row>
            {/* Como no celular: o endereço derivado da frase vai só aos contatos públicos aceitos. Vinculado ao celular, é o ajuste de lá que vale. */}
            <Row name={t('settings.privacy.shareWallet')} desc={session.state === 'linked' ? t('settings.phoneDesc') : t('settings.privacy.shareWalletDesc')}>
              <Toggle on={prefs.shareWalletAddress} disabled={session.state === 'linked'} onChange={v => void updatePrefs({ shareWalletAddress: v })} label={t('settings.privacy.shareWallet')} />
            </Row>
          </Section>
          <Section title={t('settings.privacy.metadata')} i={1}>
            <Row name={t('settings.privacy.delay')} desc={linked ? phoneDesc : t('settings.privacy.delayDesc')} first><Toggle on={prefs.randomDelay} disabled={linked} onChange={v => void updatePrefs({ randomDelay: v })} label={t('settings.privacy.delay')} /></Row>
            <Row name={t('settings.privacy.pad')} desc={linked ? phoneDesc : t('settings.privacy.padDesc')}><Toggle on={prefs.pad} disabled={linked} onChange={v => void updatePrefs({ pad: v })} label={t('settings.privacy.pad')} /></Row>
          </Section>
          <Section title={t('settings.privacy.lock')} i={2}>
            {lock && <LockPassword lock={lock} toast={toast} />}
            <Row name={t('settings.privacy.lockSuspend')} desc={!hasPw ? t('settings.needPw') : lock?.touchId ? t('settings.privacy.lockSuspendTouch') : t('settings.privacy.lockSuspendPw')}>
              <Toggle on={hasPw && prefs.lockOnSuspend} disabled={!hasPw} onChange={v => void updatePrefs({ lockOnSuspend: v })} label={t('settings.privacy.lockSuspend')} />
            </Row>
            <Row name={t('settings.privacy.lockIdle')} desc={!hasPw ? t('settings.needPw') : t('settings.privacy.lockIdleDesc')}>
              {hasPw ? <Seg value={prefs.lockAfter} opts={[['5', t('settings.privacy.min5')], ['15', t('settings.privacy.min15')], ['60', t('settings.privacy.h1')], ['never', t('common.never')]]} onChange={v => void updatePrefs({ lockAfter: v })} /> : <Val>{t('common.never')}</Val>}
            </Row>
            <Row name={t('settings.privacy.lockNow')} desc={hasPw ? t('settings.privacy.lockNowDesc') : t('settings.needPw')}>
              <Kbd keys={[mod, 'L']} />{hasPw && <Btn onClick={() => void window.piu.lockApp().catch(e => toast((e as Error).message, 'error'))}>{t('settings.privacy.lockBtn')}</Btn>}
            </Row>
            <Row name={t('settings.privacy.screen')} desc={sec.supported ? screenSecurityDesc() : sec.note ?? ''}>
              <Toggle on={sec.supported && prefs.screenSecurity} disabled={!sec.supported} onChange={v => void updatePrefs({ screenSecurity: v })} label={t('settings.privacy.screen')} />
            </Row>
          </Section>
          <Section title={t('settings.privacy.contacts')} i={3}>
            {/* D2: a lista abre numa subpágina. Bloqueie pela conversa (Detalhes → Bloquear). */}
            <Row name={t('settings.privacy.blocked')} desc={linked ? t('settings.privacy.blockedLinked') : blocked.length ? t('settings.privacy.blockedCount', { count: blocked.length }) : t('settings.privacy.blockedNone')} icon="block" first onClick={() => go('blocked')}>
              <Sym name="chevron_right" size={20} style={{ color: 'var(--ink2)' }} />
            </Row>
          </Section>
        </>
      );
      case 'look': return (
        <Section title={t('settings.look.section')} i={0}>
          <Row name={t('settings.look.theme')} first><Seg value={prefs.theme} opts={[['system', t('common.system')], ['light', t('settings.look.light')], ['dark', t('settings.look.dark')]]} onChange={v => void updatePrefs({ theme: v })} /></Row>
          <Row name={t('settings.look.fontSize')}><Seg value={prefs.fontSize} opts={[['s', t('settings.look.small')], ['m', t('settings.look.medium')], ['l', t('settings.look.large')]]} onChange={v => void updatePrefs({ fontSize: v })} /></Row>
          <Row name={t('settings.look.density')}><Seg value={prefs.density} opts={[['comfort', t('settings.look.comfort')], ['compact', t('settings.look.compact')]]} onChange={v => void updatePrefs({ density: v })} /></Row>
          <Row name={t('settings.look.animations')} desc={t('settings.look.animationsDesc')}><Toggle on={prefs.animations} onChange={v => void updatePrefs({ animations: v })} label={t('settings.look.animations')} /></Row>
        </Section>
      );
      case 'chats': return (
        <>
          {/* Cartão de espaço do protótipo, medido na pasta de dados (main/storageUsage.ts). O total inclui os caches do próprio Electron; mídia ainda não existe no computador. */}
          <div role="button" tabIndex={0} className="a-98" onClick={() => go('storage')} onKeyDown={e => { if (e.key === 'Enter') go('storage'); }} aria-label={t('settings.chats.storageAria')} style={{ padding: 18, borderRadius: 20, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 6, cursor: 'pointer', animation: 'piuUp .45s .05s both' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: usage ? 'var(--ink)' : 'var(--ink3)' }}>{usage ? fmtBytes(usage.total) : '—'}</div><div style={{ display: 'flex', alignItems: 'center', gap: 4, font: `500 12px ${FM}`, color: 'var(--ink2)' }}>{t('settings.chats.used')}<Sym name="chevron_right" size={18} /></div></div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--bg3)', display: 'flex', overflow: 'hidden' }}>
              {usage && usage.total > 0 && ([[usage.messages, 'var(--ink)'], [usage.media, 'var(--ink2)'], [usage.relay ?? 0, 'var(--ink3)']] as const).map(([v, bg], i) => <div key={i} style={{ width: `${Math.min(100, (v / usage.total) * 100)}%`, background: bg, animation: `piuGrowX .7s ${0.2 + i * 0.12}s cubic-bezier(.2,.85,.3,1) both`, transformOrigin: 'left' }} />)}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: 'var(--ink2)' }}>
              {([['settings.chats.messages', 'var(--ink)', usage ? usage.messages : null], ['settings.chats.media', 'var(--ink2)', usage ? usage.media : null], ['settings.chats.relay', 'var(--ink3)', usage ? usage.relay : null]] as const).map(([l, bg, v]) => <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: bg }} />{t(l)} · {fmtBytes(v)}</div>)}
            </div>
          </div>
          <Section title={t('settings.chats.write')} i={0}>
            <Row name={t('settings.chats.enterSends')} desc={prefs.enterSends ? t('settings.chats.shiftEnter') : t('settings.chats.modEnter', { mod })} first><Toggle on={prefs.enterSends} onChange={v => void updatePrefs({ enterSends: v })} label={t('settings.chats.enterSends')} /></Row>
            <Row name={t('settings.chats.temp')} desc={linked ? phoneDesc : t('settings.chats.tempDesc')}>
              {linked ? <Val>{t('settings.onPhone')}</Val> : <Seg value={prefs.tempDefault} opts={[['off', t('common.no')], ['24h', t('settings.h24')], ['7d', t('settings.d7')]]} onChange={v => void updatePrefs({ tempDefault: v })} />}
            </Row>
          </Section>
          <Section title={t('settings.chats.mediaSection')} i={1}>
            <Row name={t('settings.chats.files')} desc={t('settings.chats.filesDesc')} first><Val>{t('settings.chats.textOnly')}</Val></Row>
            <Row name={t('settings.chats.keepOthers')} desc={linked ? t('settings.noRelayLinked') : t('settings.chats.keepOthersDesc')}>
              {linked ? <Val>—</Val> : <Seg value={prefs.relayRetention} opts={[['24', t('settings.h24')], ['48', t('settings.h48')], ['168', t('settings.d7')]]} onChange={v => void updatePrefs({ relayRetention: v })} />}
            </Row>
          </Section>
        </>
      );
      case 'network': {
        const lan = net?.lan;
        return (
          <>
            <Section title={t('settings.network.transports')} i={0}>
              <Row name={t('settings.network.lan')} desc={lan?.state === 'running' ? t('settings.network.lanRunning', { port: String(lan.port), disc: lan.discoveryPort ?? t('settings.network.discOff') }) : lan?.state === 'unavailable' ? lan.reason ?? t('settings.network.unavailable') : t('settings.network.lanDesc')} first><Toggle on={prefs.lan} onChange={v => void updatePrefs({ lan: v })} label={t('settings.network.lanLabel')} /></Row>
              <Row name="Bluetooth" desc={net?.ble.reason ?? t('settings.network.bleDesc')}><Val>{t('settings.notifs.phoneOnly')}</Val></Row>
            </Section>
            <Section title={t('settings.network.help')} i={1}>
              <Row name={t('settings.network.relay')} desc={t('settings.network.relayDesc')} first><Toggle on={prefs.relay} onChange={v => void updatePrefs({ relay: v })} label={t('settings.network.relay')} /></Row>
              <Row name={t('settings.network.bandwidth')} desc={t('settings.network.bandwidthDesc')}><Seg value={prefs.relayBandwidth} opts={[['1', '1 Mbps'], ['5', '5 Mbps'], ['20', '20 Mbps']]} onChange={v => void updatePrefs({ relayBandwidth: v })} /></Row>
              <Row name={t('settings.network.seen')}><Val>{lan ? (lan.links === 0 ? t('settings.network.links0') : t('settings.network.links', { count: lan.links })) : '—'}</Val></Row>
            </Section>
            <Section title={t('settings.network.point')} i={2}>
              {point?.point
                ? <div style={{ padding: 12 }}><GuardianCard s={point} toast={toast} onOpen={() => p.onGuardian?.()} /></div>
                : <Row name={t('settings.network.usePoint')} desc={t('settings.network.usePointDesc')} icon="hub" first><Btn primary onClick={() => p.onGuardian?.()}>{t('settings.network.start')}</Btn></Row>}
            </Section>
            <Section title={t('settings.network.peers')} i={3}>
              <div style={{ display: 'flex', gap: 8, padding: '13px 16px' }}>
                <input value={peerInput} onChange={e => setPeerInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addPeer(); }} placeholder={t('settings.network.peerPh')} aria-label={t('settings.network.peerAria')}
                  style={{ flex: 1, height: 36, borderRadius: 11, border: 'none', background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line2) inset', padding: '0 12px', font: `500 13px ${FM}`, color: 'var(--ink)', outline: 'none' }} />
                <Btn primary onClick={() => void addPeer()}>{t('settings.network.add')}</Btn>
              </div>
              {(lan?.peers ?? []).map(x => (
                <Row key={x.address + x.source} name={x.address} icon={x.state === 'connected' ? 'hub' : x.state === 'failed' ? 'error' : 'sync'} desc={[x.source === 'discovered' ? t('settings.network.discovered') : x.source === 'config' ? t('settings.network.fromConfig') : t('settings.network.fixed'), x.nodeId ? t('settings.network.node', { id: x.nodeId }) : null, x.error].filter(Boolean).join(' · ')}>
                  <Val>{peerState(x)}</Val>
                  {x.source === 'manual' && <button className="h-bg3" onClick={() => void window.piu.removePeer(x.address)} aria-label={t('settings.network.removePeer')} style={{ width: 30, height: 30, border: 'none', borderRadius: 15, background: 'var(--bg)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sym name="close" size={16} /></button>}
                </Row>
              ))}
              {(lan?.peers ?? []).length === 0 && <Row name={t('settings.network.noPeers')} desc={t('settings.network.noPeersDesc')} />}
            </Section>
          </>
        );
      }
      case 'system': {
        // E2 (Piu 12): "Avisar quando sair versão nova" + "Verificar agora"; o resultado aparece logo abaixo.
        const openPage = (url: string) => void window.piu.openReleasePage(url).catch(e => toast((e as Error).message, 'error'));
        const checkNow = () => { setResultHidden(false); void window.piu.checkUpdate().catch(e => toast((e as Error).message, 'error')); };
        const lastAt = update.state === 'latest' ? update.at : (update.state === 'available' || update.state === 'error') ? update.at ?? lastCheck : lastCheck;
        const busy = update.state === 'checking' || update.state === 'downloading';
        return (
          <>
            <div style={{ padding: '4px 0 2px', font: `500 12px ${FM}`, letterSpacing: '.04em', color: 'var(--ink2)', animation: 'piuUp .45s .08s cubic-bezier(.2,.85,.3,1) both' }}>{t('settings.system.updates')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'piuUp .45s .1s cubic-bezier(.2,.85,.3,1) both' }}>
              <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>
                <Line icon="deployed_code" name={t('settings.system.installed')} first><span style={{ font: `500 13px ${FM}`, color: 'var(--ink)' }}>{session.version}</span></Line>
                <Line icon="notifications_active" name={t('settings.system.notify')} desc={t('settings.system.notifyDesc')}>
                  <Switch46 on={prefs.updateNotify} onChange={v => void updatePrefs({ updateNotify: v })} label={t('settings.system.notify')} />
                </Line>
                <Line icon="refresh" name={t('settings.system.checkNow')} desc={lastAt ? t('settings.system.lastCheck', { when: whenShort(lastAt) }) : t('settings.system.notChecked')}>
                  <button className="a-97" onClick={checkNow} disabled={busy} style={{ height: 32, padding: '0 13px', border: 'none', borderRadius: 16, background: 'var(--ink)', color: 'var(--invink)', font: `600 13px ${F}`, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 'none', whiteSpace: 'nowrap', opacity: busy ? .5 : 1 }}>{t('settings.system.checkNow')}</button>
                </Line>
              </div>
              {!resultHidden && <UpdateResult u={update} version={session.version} onClose={() => setResultHidden(true)} onCheck={checkNow} onPage={openPage} onDownload={() => void window.piu.downloadUpdate()} />}
              {update.state === 'downloading' && <UpdateProgress s={update} />}
              {update.state === 'ready' && (
                <div style={{ padding: '18px 20px', borderRadius: 20, boxShadow: '0 0 0 1.5px var(--ink) inset', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}><div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('settings.system.ready', { version: update.info.version })}</div><div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{t('settings.system.verified', { signer: update.signer })}</div></div>
                  <button className="a-97" onClick={p.onUpdateDialog} style={{ height: 40, padding: '0 16px', border: 'none', borderRadius: 20, background: 'var(--ink)', color: 'var(--invink)', font: `600 14px ${F}`, cursor: 'pointer' }}>{update.install === 'appimage' ? t('settings.system.restart') : update.install === 'dev' ? t('settings.system.view') : t('settings.system.install')}</button>
                </div>
              )}
              {update.state === 'bad' && <UpdateRejected s={update} onClose={() => void window.piu.dismissUpdate()} onPage={() => openPage(update.info.url)} />}
              <div style={{ padding: '13px 15px', borderRadius: 18, boxShadow: '0 0 0 1px var(--line2) inset', display: 'flex', gap: 12 }}>
                <Sym name="info" size={20} wght={300} />
                <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.4, textWrap: 'pretty' }}>{t('settings.system.noAuto')}</div>
              </div>
              <div style={{ font: `500 12px ${FM}`, color: 'var(--ink2)', letterSpacing: '.04em' }}>{t('settings.system.startup')}</div>
              <div style={{ borderRadius: 20, background: 'var(--bg2)', overflow: 'hidden' }}>
                <Line icon="login" name={t('settings.system.openAtLogin')} first><Switch46 on={prefs.openAtLogin} onChange={v => void updatePrefs({ openAtLogin: v })} label={t('settings.system.openAtLogin')} /></Line>
                <Line icon={mac ? 'menu' : 'select_window'} name={mac ? t('settings.system.menuBar') : t('settings.system.tray')} desc={!mac && !win ? t('settings.system.trayLinux') : t('settings.system.trayDesc')}>
                  <Switch46 on={prefs.tray} onChange={v => void updatePrefs({ tray: v })} label={mac ? t('settings.system.menuBar') : t('settings.system.tray')} />
                </Line>
              </div>
            </div>
          </>
        );
      }
      case 'backup': return (
        <>
          <Section title={t('settings.backup.keep')} i={0}>
            <BackupExport toast={toast} />
            <Row name={t('settings.backup.phrase')} desc={mac ? t('settings.backup.phraseMac') : win ? t('settings.backup.phraseWin') : t('settings.backup.phraseLinux')} icon="visibility">
              <Btn primary={!bkShown} onClick={() => { if (bkShown) { hidePhrase(); return; } void window.piu.revealPhrase().then(w => { if (!w) { toast(t('settings.backup.noPhrase'), 'error'); return; } setBkWords(w); setBkShown(true); }, () => toast(t('settings.backup.refused'), 'lock')); }}>{bkShown ? t('common.hide') : t('common.show')}</Btn>
            </Row>
          </Section>
          <div style={{ marginTop: 14, padding: 16, borderRadius: 20, background: 'var(--bg2)', display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, filter: bkShown ? 'none' : 'blur(7px)', transition: 'filter .5s', animation: 'piuUp .45s .2s both' }} aria-hidden={!bkShown}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className={bkShown ? 'sel' : ''} style={{ height: 40, borderRadius: 11, background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontSize: 14 }}>
                <span style={{ font: `500 11px ${FM}`, color: 'var(--ink3)' }}>{i + 1}</span>{bkShown && bkWords ? bkWords[i] : '••••••'}
              </div>
            ))}
          </div>
          <Section title={t('settings.backup.erase')} i={2}>
            <Row name={t('settings.backup.eraseAll')} desc={t('settings.backup.eraseDesc')} icon="delete_forever" first><Btn onClick={p.onLogout}>{t('settings.backup.eraseBtn')}</Btn></Row>
          </Section>
        </>
      );
      case 'lang': {
        // Os 11 idiomas do celular (shared/i18n/core.ts `LANGS`, conferidos contra apps/mobile no teste). O idioma
        // vale só neste computador; "Do sistema" segue o computador quando ele é um dos suportados.
        const sys = matchLang(systemLangs());
        const inUse = resolveLang(prefs.lang, systemLangs());
        const sysName = LANGS.find(l => l.code === sys)?.native ?? LANGS[0]!.native;
        const pick = (code: LangPref) => {
          if (prefs.lang === code) return;
          void updatePrefs({ lang: code }).then(() => { if (code !== 'auto') toast(tIn(code, 'settings.lang.toast', { name: LANGS.find(l => l.code === code)!.native }), 'translate'); });
        };
        const sample = t('settings.lang.sample', { date: fmtDate(Date.now(), { dateStyle: 'medium' }), number: regionSample(inUse, prefs.region) });
        const langRow = (code: LangPref, name: string, desc: string, first?: boolean) => {
          const on = prefs.lang === code;
          return (
            <div key={code} role="radio" aria-checked={on} aria-label={name} tabIndex={0} onClick={() => pick(code)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(code); } }} className="h-x3"
              style={{ cursor: 'pointer' }}>
              <Row name={name} desc={desc} icon={on ? 'check_circle' : 'radio_button_unchecked'} first={first}>{on && <Val>{t('settings.lang.inUse')}</Val>}</Row>
            </div>
          );
        };
        return (
          <>
            <Section title={t('settings.lang.app')} i={0}>
              {langRow('auto', t('settings.lang.system'), t('settings.lang.systemDesc', { name: sysName }), true)}
              {LANGS.map(l => langRow(l.code, l.native, langName(l.code, inUse)))}
            </Section>
            <Section title={t('settings.lang.region')} i={1}>
              <Row name={t('settings.lang.format')} desc={sample} first>
                <Seg value={prefs.region} opts={[['auto', t('settings.lang.regionAuto')], ['br', '1.234,56'], ['us', '1,234.56']]} onChange={v => void updatePrefs({ region: v })} />
              </Row>
              {/* Exige um modelo de tradução local (sem internet), que o Piu não traz; tradução por servidor está fora de questão. */}
              <Row name={t('settings.lang.translate')} desc={t('settings.lang.translateDesc')}><Val>{t('settings.lang.unavailable')}</Val></Row>
              {/* Linux: o Chromium baixaria dicionários Hunspell da CDN do Google; o processo principal bloqueia o download. */}
              <Row name={t('settings.lang.spell')} desc={session.platform === 'linux' ? t('settings.lang.spellLinux') : t('settings.lang.spellOn', { os: osName })}>
                {session.platform === 'linux' ? <Val>{t('settings.lang.unavailable')}</Val> : <Toggle on={prefs.spellcheck} onChange={v => void updatePrefs({ spellcheck: v })} label={t('settings.lang.spell')} />}
              </Row>
            </Section>
          </>
        );
      }
      case 'blocked': return <BlockedPage blocked={blocked} linked={linked} prefs={prefs} mod={mod} onBack={() => go('privacy')} onUnblock={askUnblock} updatePrefs={updatePrefs} />;
      case 'storage': return <StoragePage prefs={prefs} linked={linked} onBack={() => go('chats')} setDialog={setDialog} toast={toast} updatePrefs={updatePrefs} />;
      case 'keys': return (
        <>
          <Section title={t('settings.keys.navigate')} i={0}>
            <Row name={t('settings.keys.search')} first><Kbd keys={[mod, 'K']} /></Row>
            <Row name={t('settings.keys.next')}><Kbd keys={[mod, ']']} /></Row>
            <Row name={t('settings.keys.prev')}><Kbd keys={[mod, '[']} /></Row>
            <Row name={t('settings.keys.settings')}><Kbd keys={[mod, ',']} /></Row>
          </Section>
          <Section title={t('settings.keys.chat')} i={1}>
            <Row name={t('settings.keys.newChat')} first><Kbd keys={[mod, 'N']} /></Row>
            <Row name={t('settings.keys.details')}><Kbd keys={[mod, 'I']} /></Row>
            <Row name={t('settings.keys.mute')}><Kbd keys={[mod, '⇧', 'M']} /></Row>
            <Row name={t('settings.keys.lock')} desc={hasPw ? undefined : t('settings.keys.lockNeedsPw')}><Kbd keys={[mod, 'L']} /></Row>
            <Row name={t('settings.keys.send')}><Kbd keys={prefs.enterSends ? ['Enter'] : [mod, 'Enter']} /></Row>
            <Row name={t('settings.keys.newline')}><Kbd keys={prefs.enterSends ? ['⇧', 'Enter'] : ['Enter']} /></Row>
          </Section>
        </>
      );
    }
  })();

  const cur = PARENT[page] ?? page;
  return (
    <>
      <div style={{ width: 248, flex: 'none', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '18px 12px 14px', gap: 14, animation: 'piuUp .4s cubic-bezier(.2,.85,.3,1) both' }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em', padding: '0 8px' }}>{t('settings.title')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', scrollbarWidth: 'none' }}>
          {PAGES.map(([k, icon, label]) => (
            <button key={k} className="h-x3" onClick={() => go(k)} aria-current={cur === k} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 38, padding: '0 10px', border: 'none', borderRadius: 11, background: cur === k ? 'var(--bg3)' : 'transparent', color: 'var(--ink)', font: `${cur === k ? 600 : 450} 14px ${F}`, cursor: 'pointer', textAlign: 'left', transition: 'background .2s,transform .2s', flex: 'none' }}>
              <Sym name={k === 'system' && !mac ? 'computer' : icon} size={19} fill={cur === k ? 1 : 0} wght={350} /><span style={{ flex: 1 }}>{t(label)}</span>
              {k === 'system' && (update.state === 'ready' || update.state === 'bad') && <div aria-label={t('settings.updateDot')} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ink)' }} />}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="h-bg2" onClick={p.onLogout} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40, padding: '0 10px', border: '1px solid var(--line2)', borderRadius: 12, background: 'transparent', color: 'var(--ink)', font: `550 13.5px ${F}`, cursor: 'pointer' }}>
          <Sym name="logout" size={19} />{t('settings.logout')}
        </button>
      </div>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div key={seq} style={{ maxWidth: 720, margin: '0 auto', padding: sub ? '26px 40px 48px' : '32px 40px 48px', display: 'flex', flexDirection: 'column', gap: 6, animation: `piuPg${seq % 2 ? 'A' : 'B'} .45s cubic-bezier(.2,.85,.3,1) both` }}>
          {!sub && <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' }}>{titles[page][0]}</div>}
          {!sub && titles[page][1] && <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.45, marginBottom: 12, maxWidth: 560, textWrap: 'pretty' }}>{titles[page][1]}</div>}
          {body}
        </div>
      </div>
    </>
  );
}
