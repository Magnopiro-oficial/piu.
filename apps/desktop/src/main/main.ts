/**
 * Piu Desktop: processo principal.
 * - Janela única com renderer React (Vite) carregado por piu-app://app/ (não file://), em sandbox, com contextIsolation,
 *   sem nodeIntegration e CSP estrita (só recursos do próprio app; nada de rede no renderer).
 * - O núcleo (core.ts) roda aqui: frase no cofre do sistema, estado cifrado, nó LNNP na rede local.
 * - IPC: um canal `piu` (invoke) com os métodos de `PiuApi`; eventos em `piu:<evento>`. Só o quadro
 *   principal da janela do Piu, com URL do próprio renderer, pode chamar (security.ts).
 */
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, type MenuItemConstructorOptions, type MessageBoxOptions, nativeImage, nativeTheme, Notification, powerMonitor, protocol, safeStorage, session, shell, systemPreferences, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PiuCore } from './core';
import { eventAllowed, methodAllowed } from './lockGate';
import { sanitizePrefsPatch } from './prefs';
import { externalUrlAllowed, forbiddenDebugSwitches, isRendererUrl, mediaAllowed, isTrustedSender, profileFromEnv, reauthForPhrase, RENDERER_ORIGIN, RENDERER_SCHEME, rendererFileFor, rendererMime } from './security';
import { isSecretScreen, screenSecurityFor, type SecretScreen } from '../shared/screenSecurity';
import { alertText, type AlertNoticeLevel, type AlertSummary, badgeCount, notifKindOf, shouldNotify, shouldNotifyAlert } from '../shared/notifyPolicy';
import { callNoticeText, missedCallsText, ringingCall, shouldNotifyCall } from '../shared/callNotify';
import type { CallSnapshot } from '../shared/callBridge';
import type { CallRecord } from '../../../mobile/src/calls/callMachine';
import type { AppLockState, ContactInfo, PiuEventName, Prefs, TempMode } from '../shared/types';
import { fmtLunes, planckToNumber } from '../renderer/walletSend';
import { AppLock, type LockEvent, lockTrigger, reasonOf } from './appLock';
import { checkForUpdates, linuxAutostartDir, RELEASES_REPO, setLinuxAutostart } from './system';
import { replaceAppImage, Updater } from './updater';
import { RELEASE_KEY_ARMORED, RELEASE_KEY_FPR } from './releaseKey';
import { GuardianService } from './guardian/guardian';
import { applyMainLang, tm } from './i18n';

const isMac = process.platform === 'darwin';
// Nome do app antes do `ready`: vale para o menu, as notificações, o painel "Sobre" e a pasta de dados.
// PIU_PROFILE (security.ts `profileFromEnv`): perfil separado para testes do app instalado, com outra pasta de
// dados e outro nome (logo outro item no cofre do sistema). Sem a variável, o perfil normal.
const profile = profileFromEnv(process.env);
app.setName(profile ? `Piu-${profile}` : 'Piu');
if (profile) app.setPath('userData', join(app.getPath('appData'), `Piu-${profile}`));
const applyAboutPanel = () => app.setAboutPanelOptions({ applicationName: 'Piu', applicationVersion: app.getVersion(), copyright: 'Lunes Network · AGPL-3.0-only', credits: tm('main.about.credits') });
applyAboutPanel();
app.enableSandbox();

// M-05: no app empacotado, switches de depuração (CDP, inspector, js-flags) fecham o Piu antes de qualquer
// janela: com eles, outro programa do mesmo usuário falaria com o renderer sem passar pelo Keychain.
// Em desenvolvimento (`!app.isPackaged`) continuam valendo, para os testes automatizados.
const debugSwitches = app.isPackaged ? forbiddenDebugSwitches(process.argv, process.platform, s => app.commandLine.hasSwitch(s)) : [];
if (debugSwitches.length) {
  try { dialog.showErrorBox(tm('main.debug.title'), tm('main.debug.body', { switches: debugSwitches.map(s => `--${s}`).join(', ') })); } catch { /* sem interface */ }
  app.exit(1);
}

let core: PiuCore;
/** Ponto Piu deste computador (guardião, E4/E5): nó próprio, separado do núcleo e das identidades. */
let guardian: GuardianService | null = null;
let win: BrowserWindow | null = null;
let quitting = false;

const rendererDir = () => join(__dirname, 'renderer');
// Com a barra final (B-06): `.../renderer-qualquer/` não passa por `.../renderer`.
const rendererOrigin = () => RENDERER_ORIGIN;
const asset = (name: string) => join(app.isPackaged ? process.resourcesPath : join(__dirname, '..'), 'assets', name);

// ── segurança da janela ───────────────────────────────────
const RENDERER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// Antes do app ficar pronto: piu-app é padrão (URLs relativas, origem própria) e seguro (módulos ES, fontes).
protocol.registerSchemesAsPrivileged([{ scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true } }]);
/**
 * Chamada aberta agora (caixa "pre" até o fim): só então o microfone pode abrir. Tocando (ainda não
 * atendida) não: quem decide abrir o microfone é a pessoa, ao atender.
 */
const inCall = () => { const p = core?.callSnapshot()?.state.phase; return p === 'pre' || p === 'calling' || p === 'active'; };
/** macOS: o sistema pergunta uma vez ("Piu quer usar o microfone"); recusado, a chamada segue sem voz minha. */
async function micAccess() {
  if (!isMac || systemPreferences.getMediaAccessStatus('microphone') === 'granted') return;
  if (!(await systemPreferences.askForMediaAccess('microphone'))) send('notice', { text: tm('main.call.micDenied'), kind: 'error' });
}
function hardenSession() {
  const ses = session.defaultSession;
  // Nenhuma permissão do navegador, exceto copiar texto, notificações e o microfone durante a chamada.
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media') return cb(mediaAllowed({ types: (details as { mediaTypes?: string[] }).mediaTypes ?? [], url: details.requestingUrl, origin: rendererOrigin(), inCall: inCall() }));
    cb(permission === 'clipboard-sanitized-write' || permission === 'notifications');
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (permission === 'media') return mediaAllowed({ types: [details.mediaType ?? 'unknown'], url: requestingOrigin, origin: rendererOrigin(), inCall: inCall(), check: true });
    return permission === 'clipboard-sanitized-write' || permission === 'notifications';
  });
  // Interface por piu-app://app/ (B-04): só arquivos de dentro de dist/renderer, com a CSP no próprio cabeçalho.
  protocol.handle(RENDERER_SCHEME, async req => {
    const file = rendererFileFor(req.url, rendererDir());
    if (!file) return new Response(null, { status: 404 });
    let body: Buffer;
    try { body = await readFile(file); } catch { return new Response(null, { status: 404 }); }
    return new Response(new Uint8Array(body), { status: 200, headers: { 'Content-Type': rendererMime(file), 'Content-Security-Policy': RENDERER_CSP, 'X-Content-Type-Options': 'nosniff' } });
  });
  // O renderer só carrega o próprio app (piu-app://app/). Nada de internet nele.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    cb({ cancel: !(isRendererUrl(u, rendererOrigin()) || u.startsWith('devtools://') || u.startsWith('blob:') || u.startsWith('data:')) });
  });
  // Corretor ortográfico: no Linux (e em idiomas que o corretor nativo do Windows não cobre) o Chromium baixaria
  // dicionários Hunspell da CDN do Google, revelando o uso do Piu e o idioma. Aponta o download para uma pasta
  // local que não existe (nada sai do computador); macOS e Windows usam o corretor do sistema.
  try { ses.setSpellCheckerDictionaryDownloadURL(pathToFileURL(join(app.getPath('temp'), 'piu-sem-dicionarios')).href + '/'); } catch { /* versão sem a API */ }
  // CSP estrita, também no modo de desenvolvimento (o Vite gera scripts e CSS em arquivos).
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [RENDERER_CSP] } });
  });
}

app.on('web-contents-created', (_e, contents) => {
  // Links externos só para a allowlist (B-02); nenhuma janela nova dentro do app.
  contents.setWindowOpenHandler(({ url }) => {
    if (externalUrlAllowed(url)) void shell.openExternal(new URL(url).href);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => { if (!isRendererUrl(url, rendererOrigin())) e.preventDefault(); });
  contents.on('will-redirect', e => e.preventDefault());
  contents.on('will-attach-webview', e => e.preventDefault());
});

// ── janela ────────────────────────────────────────────────
function createWindow() {
  // PIU_HIDE_WINDOW=1 (só para testes automatizados): a janela não aparece na tela, mas continua
  // pintando (paintWhenInitiallyHidden) para capturas pelo DevTools remoto.
  const hidden = process.env.PIU_HIDE_WINDOW === '1';
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'Piu', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    icon: asset('icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    // Semáforos centrados na barra de 40px do protótipo (círculos de 12px em x=14/34/54, centro y=20): medido na tela com o Electron 45.
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  applyScreenSecurity();
  // Recarregou a página: zera antes do documento novo; o renderer volta a avisar o que está na tela.
  win.webContents.on('did-start-loading', () => { conversationOpen = false; secretScreens.clear(); applyScreenSecurity(); });
  win.once('ready-to-show', () => { if (!hidden) win?.show(); });
  // Com o ícone na barra de menus/bandeja, fechar a janela só a esconde: o nó continua recebendo.
  win.on('close', e => { if (!quitting && tray && core?.prefs().tray) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  void win.loadURL(`${RENDERER_ORIGIN}index.html`);
}

/**
 * Segurança da tela (Ajustes → Privacidade, padrão ligado): bloqueia captura e gravação das janelas
 * do app no macOS e no Windows ENQUANTO uma conversa estiver aberta. Telas com segredo (frase em Backup,
 * QR/palavras do vínculo, Carteira) ficam protegidas sempre, mesmo com o ajuste desligado (M-02).
 * O renderer avisa por `setConversationOpen` e `setSecretVisible`.
 * No Linux não há suporte (decisão pura em shared/screenSecurity.ts; o interruptor fica desabilitado).
 */
let conversationOpen = false;
const secretScreens = new Set<SecretScreen>();
function applyScreenSecurity() {
  const { protect } = screenSecurityFor(process.platform, core ? core.prefs().screenSecurity : true, { conversation: conversationOpen, secret: secretScreens.size > 0 });
  for (const w of BrowserWindow.getAllWindows()) { try { w.setContentProtection(protect); } catch { /* sem suporte nesta janela */ } }
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

/** Bloqueado, a janela não recebe nada com nome ou conteúdo; ao desbloquear, recarrega a lista. */
const send = (event: PiuEventName, payload: unknown) => {
  if (!eventAllowed(!!appLock?.locked, event)) return;
  if (win && !win.isDestroyed()) win.webContents.send(`piu:${event}`, payload);
};

/**
 * Notificação nativa do sistema para mensagem recebida com a janela fora de foco. Cada tipo segue o
 * próprio interruptor; conversa silenciada e Não perturbe calam (shared/notifyPolicy.ts).
 */
function notifyIncoming(contact: ContactInfo, text: string, isNew: boolean, force = false) {
  const p = core.prefs();
  if (!Notification.isSupported()) return;
  const focused = !!win && win.isVisible() && win.isFocused();
  if (!shouldNotify(p, force ? { kind: 'test' } : { kind: notifKindOf(contact), muted: core.isMuted(contact.id), focused })) return;
  // Bloqueado: o aviso não diz de quem nem o quê, só quantas chegaram desde o bloqueio.
  if (appLock.locked && !force) {
    const n = appLock.newMessages;
    const ln = new Notification({ title: 'Piu', body: tm('main.notif.lockedCount', { count: n }), silent: !p.notifSound });
    ln.on('click', showWindow);
    ln.show();
    return;
  }
  const who = whoOf(contact);
  // "Mostrar no aviso": nome e texto, só o nome, ou nada (Ajustes → Notificações).
  const title = p.notifPreview === 'never' ? 'Piu' : isNew ? tm('main.notif.wantsChat', { name: who }) : who;
  const body = p.notifPreview === 'always' ? text.slice(0, 140) : tm('main.notif.newMessage');
  const n = new Notification({ title, body, silent: !p.notifSound });
  n.on('click', () => { showWindow(); send('notice', { text: tm('main.notif.chatWith', { name: who }), kind: 'info' }); });
  n.show();
}

/** Nome no aviso: o do contato; anônimo sem nome, "Contato anônimo · ABCD"; senão, o começo do id. */
function whoOf(contact: Pick<ContactInfo, 'id' | 'name' | 'via'>) {
  return contact.name || (contact.via === 'anon' ? tm('main.notif.anon', { code: contact.id.replace(/^piu:/, '').slice(0, 4).toUpperCase() }) : contact.id.replace(/^piu:/, '').slice(0, 8));
}
const whoOfPeer = (peer: string) => whoOf(core.listConversations().find(c => c.contact.id === peer)?.contact ?? { id: peer, name: '', via: 'public' });

/**
 * Chamada de voz tocando com a janela fora de foco: aviso nativo "Chamada de {nome}" (clicar traz a janela, com o
 * aviso de atender/recusar na frente). Some quando a chamada é atendida, recusada ou termina, e ao bloquear.
 * Regras e textos em shared/callNotify.ts (as das mensagens diretas); com o Piu bloqueado, nenhum aviso.
 */
let callNotif: { callId: string; n: Notification } | null = null;
function closeCallNotif() {
  const c = callNotif; callNotif = null;
  try { c?.n.close(); } catch { /* já fechado */ }
}
function syncCallNotif(snap: CallSnapshot | null) {
  const r = ringingCall(snap?.state);
  if (callNotif && callNotif.callId !== r?.callId) closeCallNotif();
  if (!r || callNotif || !Notification.isSupported()) return;
  const p = core.prefs();
  const focused = !!win && win.isVisible() && win.isFocused();
  if (!shouldNotifyCall(p, { muted: core.isMuted(r.peer), focused, locked: appLock.locked })) return;
  const txt = callNoticeText(p.notifPreview, whoOfPeer(r.peer), r.route);
  // Com a janela aberta, o toque sai dela (renderer): o aviso fica mudo para não somar dois sons.
  const n = new Notification({ title: txt.title, body: txt.body, silent: !!win || !p.notifSound, urgency: 'critical' });
  n.on('click', () => { if (win?.isMinimized()) win.restore(); showWindow(); });
  n.show();
  // Guardado também para o clique continuar valendo (sem referência, o aviso pode ser coletado).
  callNotif = { callId: r.callId, n };
}

/** Ajustes → Idioma → Corretor ortográfico. No Linux fica desligado (precisaria baixar dicionários). */
function applySpellcheck(p: Prefs) {
  try { session.defaultSession.setSpellCheckerEnabled(process.platform !== 'linux' && p.spellcheck); } catch { /* sem corretor */ }
}

/**
 * Alerta da comunidade (Graves passam pelo Não perturbe; shared/notifyPolicy.ts). Com o Piu bloqueado, o aviso
 * não diz qual alerta nem de onde; com a janela em foco, vira aviso dentro do Piu.
 */
function notifyAlert(p: { alert: AlertSummary; notice: AlertNoticeLevel; muted: boolean }) {
  const prefs = core.prefs();
  const focused = !!win && win.isVisible() && win.isFocused() && !appLock.locked;
  const how = shouldNotifyAlert(prefs, { level: p.notice.level, muted: p.muted, focused });
  if (!how) return;
  const txt = alertText(p.alert, p.notice, { locked: appLock.locked, preview: prefs.notifPreview });
  if (how === 'toast') { send('notice', { text: `${txt.title} — ${txt.body}`, kind: 'info' }); return; }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: txt.title, body: txt.body, silent: p.notice.level === 'critical' ? false : !prefs.notifSound, urgency: p.notice.level === 'critical' ? 'critical' : 'normal' });
  n.on('click', showWindow);
  n.show();
}

/** Carteira LUNES: o saldo lido na Mainnet subiu (recebimento ou distribuição). */
function notifyWallet(planck: string) {
  const p = core.prefs();
  if (!Notification.isSupported() || !shouldNotify(p, { kind: 'wallet', focused: !!win && win.isVisible() && win.isFocused() })) return;
  const amount = fmtLunes(planckToNumber(planck));
  const hide = p.notifPreview === 'never' || appLock.locked;
  const n = new Notification({ title: hide ? 'Piu' : tm('main.notif.lunesTitle'), body: p.notifPreview === 'always' && !appLock.locked ? tm('main.notif.lunesBody', { amount }) : tm('main.notif.walletUpdated'), silent: !p.notifSound });
  n.on('click', showWindow);
  n.show();
}

/** Contador no ícone (Dock no macOS; Unity/KDE no Linux). O Windows não tem contador por esta API. */
function applyBadge() {
  if (!core || process.platform === 'win32') return;
  try { app.setBadgeCount(badgeCount(core.prefs(), core.listConversations())); } catch { /* sem suporte */ }
}

// ── barra de menus / bandeja ─────────────────────────────
let tray: Tray | null = null;
function applyTray(p: Prefs) {
  if (p.tray && !tray) {
    let img = nativeImage.createFromPath(asset('icon.png'));
    if (!img.isEmpty()) img = img.resize({ width: isMac ? 18 : 22, height: isMac ? 18 : 22 });
    tray = new Tray(img);
    tray.setToolTip('Piu');
    tray.setContextMenu(trayMenu());
    if (!isMac) tray.on('click', showWindow);
  } else if (!p.tray && tray) { tray.destroy(); tray = null; }
}
const trayMenu = () => Menu.buildFromTemplate([
  { label: tm('main.menu.openPiu'), click: showWindow },
  { type: 'separator' },
  { label: tm('main.menu.quit'), click: () => { quitting = true; app.quit(); } },
]);
/** Idioma das preferências (ou do sistema); quando muda, refaz menu, bandeja e painel "Sobre". */
function applyLang(p: Pick<Prefs, 'lang' | 'region'> | null) {
  if (!applyMainLang(p?.lang, p?.region, app.getPreferredSystemLanguages())) return;
  applyAboutPanel();
  buildMenu();
  tray?.setContextMenu(trayMenu());
}

// ── abrir ao iniciar sessão ──────────────────────────────
/** Só no app instalado: em desenvolvimento o executável é o Electron puro. */
function applyLoginItem(open: boolean) {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') setLinuxAutostart(open, { dir: linuxAutostartDir(process.env, homedir()), exec: process.env.APPIMAGE || process.execPath });
  else app.setLoginItemSettings({ openAtLogin: open });
  return true;
}

// ── bloqueio do app (D1/D1e/D1x) ─────────────────────────
// Desbloqueia com a senha do Piu (lockPassword.ts) ou Touch ID. Sem a senha criada, nada bloqueia.
const appLock: AppLock = new AppLock(locked => {
  send('appLock', lockState());
  // Bloqueou com uma chamada tocando: o aviso "Chamada de {nome}" sai da tela (bloqueado, nada diz de quem).
  if (locked) closeCallNotif();
  // Ao desbloquear, a janela recarrega o que ficou escondido.
  if (!locked) { send('conversations', undefined); if (core) { send('wallet', core.wallet()); send('walletPayment', core.walletPayment()); } }
  // Chamada que tocou com o Piu bloqueado (o evento `call` não passa: lockGate.ts) terminou como perdida sem
  // aviso nenhum; ao desbloquear, a pessoa vê "Chamada perdida de X". Tocar bloqueado: decisão do dono do produto.
  const missed = appLock.takeMissedCalls();
  const text = !locked && core ? missedCallsText(missed.map(whoOfPeer)) : null;
  if (text) send('notice', { text, kind: 'info' });
});
let idleLockMin: number | null = null;
const canTouchId = () => { try { return isMac && systemPreferences.canPromptTouchID(); } catch { return false; } };
function lockState(last?: AppLockState['last']): AppLockState {
  const cfg = core ? core.lockConfig() : { hasPassword: false, storable: false };
  const att = core ? core.lockAttempts() : { triesLeft: 5, wait: null };
  return { locked: appLock.locked, reason: appLock.reason, at: appLock.at, newMessages: appLock.newMessages, ...cfg, touchId: canTouchId(), ...att,
    idleMin: appLock.reason === 'idle' ? idleLockMin : null, ...(last ? { last } : {}) };
}
function lockIf(ev: LockEvent) {
  if (!core || appLock.locked || !core.lockConfig().hasPassword || !lockTrigger(core.prefs(), ev)) return;
  if (ev.kind === 'idle') idleLockMin = Number(core.prefs().lockAfter);
  appLock.lock(reasonOf(ev));
  // Conversa aberta some da janela: a proteção de captura da conversa também cai.
  conversationOpen = false; applyScreenSecurity();
}
function lockNow() {
  if (!core.lockConfig().hasPassword) throw new Error(tm('main.lock.needPassword'));
  lockIf({ kind: 'manual' });
  return lockState();
}
async function unlockWith(password: unknown): Promise<AppLockState> {
  if (!appLock.locked) return lockState();
  if (core.lockAttempts().wait) return lockState('wait'); // na espera, nem senha nem Touch ID
  if (typeof password === 'string') {
    let r: Awaited<ReturnType<PiuCore['checkLockPassword']>> | null = null;
    await appLock.unlock(async () => { r = await core.checkLockPassword(password); return r.ok; });
    const res = r as Awaited<ReturnType<PiuCore['checkLockPassword']>> | null;
    return lockState(appLock.locked ? (res?.wait ? 'wait' : 'wrong') : undefined);
  }
  if (!canTouchId()) return lockState('cancel');
  const ok = await appLock.unlock(async () => { await systemPreferences.promptTouchID(tm('main.lock.touchId')); return true; });
  return lockState(ok ? undefined : 'cancel');
}
/** Bloqueado, a janela só chama isto (nada que traga nome ou conteúdo). */

// ── atualização (D3/D3b/D3e) ─────────────────────────────
let updater: Updater;
function setupUpdater() {
  updater = new Updater({
    current: app.getVersion(), dir: join(app.getPath('userData'), 'updates'), platform: process.platform, arch: process.arch, env: process.env,
    packaged: app.isPackaged, key: { armored: RELEASE_KEY_ARMORED, fpr: RELEASE_KEY_FPR }, onState: st => send('update', st),
  });
  // Abriu de novo (depois de instalar ou não): downloads velhos saem.
  updater.cleanup();
  // "Avisar quando sair versão nova": confere uma vez, uns segundos depois de abrir, e avisa na lista de
  // conversas. Só procura: baixar e conferir é pedido pela pessoa, e reiniciar também.
  setTimeout(() => { if (core?.prefs().updateNotify) void updater.check(); }, 8000).unref();
}
/** "Reiniciar e atualizar": só o pacote que passou na assinatura e no SHA-256. */
async function installUpdate() {
  const file = updater.readyFile();
  const st = updater.state;
  if (!file || st.state !== 'ready') throw new Error(tm('main.update.noneReady'));
  if (st.install === 'dev') throw new Error(tm('main.update.devNoInstall'));
  quitting = true;
  if (st.install === 'appimage') {
    // Linux AppImage: troca o arquivo e reabre a versão nova.
    const target = process.env.APPIMAGE!;
    replaceAppImage(target, file);
    updater.cleanup();
    app.relaunch({ execPath: target });
    app.quit();
    return;
  }
  if (st.install === 'nsis') {
    // Windows: o instalador conferido roda sozinho depois que o Piu fecha.
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return;
  }
  // macOS (.dmg) e Linux .deb: abre no instalador do sistema (Finder / Central de Programas) e fecha o Piu.
  // Não troca o app sozinho: o .app não é assinado com Developer ID, e um ajudante que apaga e copia
  // pacotes por conta própria é mais arriscado que o arrastar do Finder.
  const err = await shell.openPath(file);
  if (err) { quitting = false; throw new Error(tm('main.update.installerFailed', { error: err })); }
  app.quit();
}

// ── IPC ───────────────────────────────────────────────────
function registerIpc() {
  const methods: Record<string, (...args: never[]) => unknown> = {
    getSession: () => core.session(),
    createIdentity: (o: { kind: 'public' | 'anon'; name: string }) => core.createIdentity(o),
    restoreIdentity: (o: { phrase: string[]; name: string }) => core.restoreIdentity(o),
    // M-01: só depois de Touch ID (ou, sem ele, de uma confirmação nativa que o renderer não clica sozinho).
    revealPhrase: async () => {
      const ok = await reauthForPhrase({
        platform: process.platform,
        canPromptTouchID: () => systemPreferences.canPromptTouchID(),
        promptTouchID: reason => systemPreferences.promptTouchID(reason),
        confirm: async () => {
          const o: MessageBoxOptions = { type: 'warning', buttons: [tm('common.cancel'), tm('main.phrase.show')], defaultId: 0, cancelId: 0, noLink: true, title: tm('main.phrase.title'),
            message: tm('main.phrase.message'), detail: tm('main.phrase.detail') };
          return (win ? await dialog.showMessageBox(win, o) : await dialog.showMessageBox(o)).response === 1;
        },
      });
      if (!ok) throw new Error(tm('main.phrase.refused'));
      return core.revealPhrase();
    },
    exportIdentityBackup: async (password: string) => {
      if (typeof password !== 'string') throw new Error(tm('main.err.badPassword'));
      const options = { title: tm('main.backup.saveTitle'), defaultPath: 'piu-identidade.piu', filters: [{ name: tm('main.backup.filter'), extensions: ['piu'] }] };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return 'cancelled';
      const encrypted = await core.exportIdentityBackup(password);
      await writeFile(result.filePath, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return 'saved';
    },
    suggestWords: (p: string) => core.suggestWords(String(p)),
    eraseAll: async () => {
      // Confirmação nativa no processo principal: um renderer comprometido não apaga tudo sozinho.
      const o: MessageBoxOptions = { type: 'warning', buttons: [tm('common.cancel'), tm('main.erase.confirm')], defaultId: 0, cancelId: 0, noLink: true,
        title: tm('main.erase.title'), message: tm('main.erase.message'), detail: tm('main.erase.detail') };
      const ok = (win ? await dialog.showMessageBox(win, o) : await dialog.showMessageBox(o)).response === 1;
      if (!ok) throw new Error(tm('main.erase.refused'));
      return core.eraseAll();
    },
    myCard: (kind: 'public' | 'anon', fresh?: boolean) => core.myCard(kind, !!fresh),
    addContactByCard: (text: string) => core.addContactByCard(String(text)),
    listConversations: () => core.listConversations(),
    listGroupCandidates: () => core.listGroupCandidates(),
    createGroup: (options) => core.createGroup(options),
    groupInviteCandidates: (id: string) => core.groupInviteCandidates(id),
    addGroupMembers: (id: string, ids: string[]) => core.addGroupMembers(id, ids),
    leaveGroup: (id: string) => core.leaveGroup(id),
    getMessages: (id: string) => core.getMessages(String(id)),
    sendText: (id: string, text: string) => core.sendText(String(id), String(text)),
    markRead: (id: string) => core.markRead(String(id)),
    removeContact: (id: string) => core.removeContact(String(id)),
    safetyCode: (id: string) => core.safetyCode(String(id)),
    networkStatus: () => core.networkStatus(),
    addPeer: (a: string) => core.addPeer(String(a)),
    removePeer: (a: string) => core.removePeer(String(a)),
    wallet: () => core.wallet(),
    walletPayment: () => core.walletPayment(),
    requestWalletPayment: (input) => core.requestWalletPayment(input),
    setWalletAddress: (a: string | null) => core.setWalletAddress(a === null ? null : String(a)),
    refreshWallet: () => core.refreshWallet(),
    getPrefs: () => core.prefs(),
    // B-01: só as chaves que a interface usa, com tipo e valores conferidos.
    setPrefs: (p: unknown) => core.setPrefs(sanitizePrefsPatch(p)),
    copy: (text: string) => clipboard.writeText(String(text)),
    // Aviso de exemplo, com o mesmo caminho das mensagens reais (nativo do sistema).
    testNotification: () => notifyIncoming({ id: 'piu:teste', name: 'Piu', via: 'public', request: false }, tm('main.notif.testText'), false, true),
    setConversationOpen: (open: boolean) => { conversationOpen = open === true; applyScreenSecurity(); },
    setSecretVisible: (screen: unknown, on: boolean) => {
      if (!isSecretScreen(screen)) throw new Error(tm('main.err.unknownScreen'));
      if (on === true) secretScreens.add(screen); else secretScreens.delete(screen);
      applyScreenSecurity();
    },
    retryVault: () => core.retryOpen(),
    linkStart: () => core.linkStart(),
    linkConfirm: (word: string) => core.linkConfirm(typeof word === 'string' ? word : ''),
    linkCancel: () => core.linkCancel(),
    linkStatus: () => core.linkStatus(),
    setMuted: (id: string, muted: boolean) => core.setMuted(String(id), muted === true),
    listBlocked: () => core.listBlocked(),
    blockContact: (id: string) => core.blockContact(String(id)),
    unblockContact: (id: string) => core.unblockContact(String(id)),
    setTemp: (id: string, mode: TempMode) => core.setTemp(String(id), mode),
    typing: (id: string) => core.typing(String(id)),
    storageUsage: () => core.storageUsage(),
    // Única chamada de internet fora da carteira, e só quando a pessoa pede (system.ts).
    checkForUpdates: () => checkForUpdates(app.getVersion()),
    openReleasePage: (url: string) => {
      const u = String(url);
      if (!u.startsWith(`https://github.com/${RELEASES_REPO}/releases/`) || !externalUrlAllowed(u)) throw new Error(tm('main.update.badReleasePage'));
      return shell.openExternal(new URL(u).href);
    },
    appLockState: () => lockState(),
    lockApp: () => lockNow(),
    unlockApp: (password?: string) => unlockWith(password),
    setLockPassword: async (current: unknown, next: unknown) => {
      if (typeof next !== 'string' || (current !== null && typeof current !== 'string')) throw new Error(tm('main.err.badPassword'));
      await core.setLockPassword(current as string | null, next);
      return lockState();
    },
    removeLockPassword: async (current: unknown) => { await core.removeLockPassword(typeof current === 'string' ? current : ''); return lockState(); },
    storageDetail: () => core.storageDetail(),
    clearConversation: (id: string) => core.clearConversation(String(id)),
    clearRelayQueue: () => core.clearRelayQueue(),
    updateState: () => updater.state,
    checkUpdate: () => updater.check(),
    downloadUpdate: () => updater.download(),
    installUpdate: () => installUpdate(),
    dismissUpdate: () => { const st = updater.state.state; if (st === 'bad' || st === 'error') { updater.cleanup(); updater.state = { state: 'idle' }; } return updater.state; },
    guardianState: () => g().state(),
    guardianNetwork: () => g().network(),
    guardianTest: () => g().test(),
    guardianActivate: (c: unknown) => g().activate(c),
    guardianUpdate: (patch: unknown) => g().update(patch),
    guardianPause: (paused: unknown) => g().pause(paused === true),
    guardianAdoptNetwork: () => g().adoptNetwork(),
    guardianSetWifi: (w: unknown) => g().setWifi(w),
    guardianEnd: () => g().end(),
    // Só PNG em data URL, pequeno (o QR do ponto): vira imagem nativa na área de transferência.
    callState: () => core.callSnapshot(),
    callAct: (act: unknown) => core.callAct(act),
    callFrame: (codec: unknown, payload: unknown) => core.callFrame(codec, payload),
    copyImage: async (d: unknown) => {
      if (typeof d !== 'string' || d.length > 2_000_000 || !d.startsWith('data:image/png;base64,')) throw new Error(tm('main.err.badImage'));
      const img = nativeImage.createFromDataURL(d);
      if (img.isEmpty()) throw new Error(tm('main.err.badImage'));
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
    },
  };
  const g = () => { if (!guardian) throw new Error(tm('main.err.pointOpening')); return guardian; };
  ipcMain.handle('piu', async (e, method: string, ...args: unknown[]) => {
    // B-01: só a janela do Piu (quadro principal, URL do próprio renderer) chama o núcleo.
    const frame = e.senderFrame;
    if (!win || win.isDestroyed() || e.sender !== win.webContents || !isTrustedSender(frame ? { url: frame.url, isMain: frame.parent === null } : null, rendererOrigin())) throw new Error(tm('main.err.badOrigin'));
    if (typeof method !== 'string' || !Object.hasOwn(methods, method)) throw new Error(tm('main.err.unknownMethod'));
    if (!methodAllowed(appLock.locked, method)) throw new Error(tm('main.lock.locked'));
    return methods[method]!(...(args as never[]));
  });
  for (const ev of ['conversations', 'message', 'network', 'wallet', 'walletPayment', 'session', 'prefs', 'link', 'notice', 'typing', 'call', 'callAudio', 'callToast', 'callDraft'] as PiuEventName[]) core.events.on(ev, p => send(ev, p));
  core.events.on('prefs', applyScreenSecurity);
  core.events.on('incoming', (p: { contact: ContactInfo; text: string; isNew: boolean }) => { appLock.received(); if (appLock.locked) send('appLock', lockState()); notifyIncoming(p.contact, p.text, p.isNew); });
  core.events.on('walletReceived', (p: { planck: string }) => notifyWallet(p.planck));
  core.events.on('call', syncCallNotif);
  core.events.on('callRecord', (r: CallRecord) => { if (r.outcome === 'missed' && r.dir === 'in') appLock.missedCall(r.peer); });
  core.events.on('communityAlert', notifyAlert);
  core.events.on('conversations', applyBadge);
  let last = core.prefs();
  core.events.on('prefs', (p: Prefs) => {
    applyLang(p); applySpellcheck(p);
    applyBadge(); applyTray(p);
    // Senha criada/removida ou bloqueios ligados: a tela de Ajustes mostra o estado novo.
    send('appLock', lockState());
    if (p.openAtLogin !== last.openAtLogin) {
      try { if (!applyLoginItem(p.openAtLogin)) send('notice', { text: tm('main.login.devOnly'), kind: 'info' }); }
      catch (e) { send('notice', { text: tm('main.login.failed', { error: (e as Error).message }), kind: 'error' }); }
    }
    last = p;
  });
}

// ── menu ──────────────────────────────────────────────────
function buildMenu() {
  // Menu do app com o nome "Piu" também em desenvolvimento (o papel `appMenu` usaria o nome do
  // binário, "Electron"). Em dev, scripts/dev-brand.mjs ainda renomeia o bundle para a barra de menus.
  const appMenu: MenuItemConstructorOptions = {
    label: 'Piu',
    submenu: [
      { label: tm('main.menu.about'), role: 'about' },
      { type: 'separator' },
      { label: tm('main.menu.hide'), role: 'hide' }, { role: 'hideOthers', label: tm('main.menu.hideOthers') }, { role: 'unhide', label: tm('main.menu.showAll') },
      { type: 'separator' },
      { label: tm('main.menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : [{ label: tm('main.menu.file'), submenu: [{ label: tm('main.menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] }]),
    { role: 'editMenu' },
    { label: 'Piu', submenu: [
      { label: tm('main.menu.lock'), accelerator: 'CmdOrCtrl+L', click: () => { try { lockNow(); } catch (e) { send('notice', { text: (e as Error).message, kind: 'info' }); showWindow(); } } },
      { type: 'separator' },
      { label: tm('main.menu.dataFolder'), click: () => void shell.openPath(app.getPath('userData')) },
      { label: tm('main.menu.lanAbout'), click: () => void dialog.showMessageBox(win ?? undefined!, { type: 'info', title: tm('main.lan.title'), message: tm('main.lan.message'), detail: tm('main.lan.detail'), buttons: [tm('common.close')] }) },
    ] },
    { label: tm('main.menu.view'), submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── ciclo de vida ────────────────────────────────────────
if (debugSwitches.length || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    // Em desenvolvimento o Dock mostraria o ícone do Electron; usa a marca do Piu.
    if (isMac && !app.isPackaged) { try { app.dock?.setIcon(asset('icon.png')); } catch { /* sem Dock */ } }
    hardenSession();
    // Portas e destinos do LNNP ajustáveis pelo ambiente (duas instâncias na mesma máquina, testes),
    // com os mesmos nomes do piu-node: PIU_LNNP_PORT, PIU_LNNP_DISCOVERY_PORT, PIU_LNNP_BROADCAST, PIU_LNNP_LISTEN.
    const env = process.env;
    const list = (v?: string) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean);
    const lan = {
      port: env.PIU_LNNP_PORT ? Number(env.PIU_LNNP_PORT) : undefined,
      discoveryPort: ['off', '0', 'false'].includes(env.PIU_LNNP_DISCOVERY_PORT ?? '') ? null : env.PIU_LNNP_DISCOVERY_PORT ? Number(env.PIU_LNNP_DISCOVERY_PORT) : undefined,
      broadcast: env.PIU_LNNP_BROADCAST ? list(env.PIU_LNNP_BROADCAST) : undefined,
      listen: env.PIU_LNNP_LISTEN || undefined,
    };
    core = new PiuCore({
      userData: app.getPath('userData'), safeStorage, platform: process.platform, version: app.getVersion(), hostname: hostname(), lan,
      log: m => { if (!app.isPackaged) console.log(m); },
      micAccess,
    });
    setupUpdater();
    registerIpc();
    // Idioma do sistema até as preferências abrirem; depois, o escolhido em Ajustes.
    applyLang(null);
    try { await core.open(); }
    catch (e) { dialog.showErrorBox(tm('main.open.failed'), (e as Error).message); }
    try { applyLang(core.prefs()); applySpellcheck(core.prefs()); } catch { /* sem preferências: fica o do sistema */ }
    // Ponto Piu (guardião): chave cifrada com a chave de dados do cofre; liga sozinho se estava ativo.
    guardian = new GuardianService({
      dir: join(app.getPath('userData'), 'guardian'), hostname: hostname().replace(/\.local$/i, '').slice(0, 30), dataKey: () => core.dataKey(),
      onState: s => send('guardian', s), log: m => { if (!app.isPackaged) console.log(m); },
      lan: { port: env.PIU_POINT_PORT ? Number(env.PIU_POINT_PORT) : undefined, discoveryPort: lan.discoveryPort, broadcast: lan.broadcast, listen: lan.listen },
    });
    void guardian.init().catch(e => { if (!app.isPackaged) console.log(`ponto: ${(e as Error).message}`); });
    // Com bloqueio automático ligado, abrir o Piu já começa bloqueado (fechar e abrir não é atalho).
    lockIf({ kind: 'start' });
    buildMenu();
    createWindow();
    applyTray(core.prefs());
    applyBadge();
    // O ajuste pode ter mudado fora do Piu (Ajustes do Sistema no macOS/Windows): vale o do sistema.
    if (app.isPackaged && process.platform !== 'linux') {
      try { const os = app.getLoginItemSettings().openAtLogin; if (os !== core.prefs().openAtLogin) core.setPrefs({ openAtLogin: os }); } catch { /* sem suporte */ }
    }
    powerMonitor.on('suspend', () => lockIf({ kind: 'suspend' }));
    powerMonitor.on('lock-screen', () => lockIf({ kind: 'lock-screen' }));
    setInterval(() => { try { lockIf({ kind: 'idle', idleSec: powerMonitor.getSystemIdleTime() }); } catch { /* sem suporte */ } }, 30_000).unref();
    app.on('activate', showWindow);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('will-quit', e => {
    if (!core) return;
    e.preventDefault();
    const c = core; core = undefined as unknown as PiuCore;
    const pt = guardian; guardian = null;
    void Promise.allSettled([pt?.close(), c.close()]).finally(() => app.exit(0));
  });
}
