/**
 * Piu Desktop: processo principal.
 * - Janela única com renderer React (Vite) carregado por file://, em sandbox, com contextIsolation,
 *   sem nodeIntegration e CSP estrita (só recursos do próprio app; nada de rede no renderer).
 * - O núcleo (core.ts) roda aqui: frase no cofre do sistema, estado cifrado, nó LNNP na rede local.
 * - IPC: um canal `piu` (invoke) com os métodos de `PiuApi`; eventos em `piu:<evento>`.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, Notification, safeStorage, session, shell } from 'electron';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PiuCore } from './core';
import { screenSecurityFor } from '../shared/screenSecurity';
import type { ContactInfo, PiuEventName } from '../shared/types';

const isMac = process.platform === 'darwin';
// Nome do app antes do `ready`: vale para o menu, as notificações, o painel "Sobre" e a pasta de dados.
app.setName('Piu');
app.setAboutPanelOptions({ applicationName: 'Piu', applicationVersion: app.getVersion(), copyright: 'Lunes Network · AGPL-3.0-only', credits: 'Mensagens que chegam sem internet.' });
app.enableSandbox();

let core: PiuCore;
let win: BrowserWindow | null = null;
let quitting = false;

const rendererDir = () => join(__dirname, 'renderer');
const rendererOrigin = () => pathToFileURL(rendererDir()).href;
const asset = (name: string) => join(app.isPackaged ? process.resourcesPath : join(__dirname, '..'), 'assets', name);

// ── segurança da janela ───────────────────────────────────
function hardenSession() {
  const ses = session.defaultSession;
  // Nenhuma permissão do navegador, exceto copiar texto e notificações.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'notifications'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write' || permission === 'notifications');
  // O renderer só carrega o próprio app (file:// dentro de dist/renderer). Nada de internet nele.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    cb({ cancel: !(u.startsWith(rendererOrigin()) || u.startsWith('devtools://') || u.startsWith('blob:') || u.startsWith('data:')) });
  });
  // CSP estrita, também no modo de desenvolvimento (o Vite gera scripts e CSS em arquivos).
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"] } });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => { if (!url.startsWith(rendererOrigin())) e.preventDefault(); });
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
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  applyScreenSecurity();
  win.once('ready-to-show', () => { if (!hidden) win?.show(); });
  win.on('closed', () => { win = null; });
  void win.loadFile(join(rendererDir(), 'index.html'));
}

/**
 * Segurança da tela (Ajustes → Privacidade, padrão ligado): bloqueia captura e gravação das janelas
 * do app no macOS e no Windows ENQUANTO uma conversa estiver aberta; nas outras telas (lista sem
 * conversa, Ajustes, Carteira) a captura fica liberada. O renderer avisa por `setConversationOpen`.
 * No Linux não há suporte (decisão pura em shared/screenSecurity.ts; o interruptor fica desabilitado).
 */
let conversationOpen = false;
function applyScreenSecurity() {
  const { protect } = screenSecurityFor(process.platform, core ? core.prefs().screenSecurity : true, conversationOpen);
  for (const w of BrowserWindow.getAllWindows()) { try { w.setContentProtection(protect); } catch { /* sem suporte nesta janela */ } }
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

const send = (event: PiuEventName, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(`piu:${event}`, payload); };

/** Notificação nativa do sistema para mensagem recebida com a janela fora de foco. */
function notifyIncoming(contact: ContactInfo, text: string, isNew: boolean, force = false) {
  const p = core.prefs();
  if ((!p.notifications && !force) || !Notification.isSupported()) return;
  if (win && win.isFocused() && !force) return;
  const who = contact.name || (contact.via === 'anon' ? `Contato anônimo · ${contact.id.replace(/^piu:/, '').slice(0, 4).toUpperCase()}` : contact.id.replace(/^piu:/, '').slice(0, 8));
  // "Mostrar no aviso": nome e texto, só o nome, ou nada (Ajustes → Notificações).
  const title = p.notifPreview === 'never' ? 'Piu' : isNew ? `${who} quer conversar` : who;
  const body = p.notifPreview === 'always' ? text.slice(0, 140) : 'Nova mensagem';
  const n = new Notification({ title, body, silent: !p.notifSound });
  n.on('click', () => { showWindow(); send('notice', { text: `Conversa com ${who}`, kind: 'info' }); });
  n.show();
}

// ── IPC ───────────────────────────────────────────────────
function registerIpc() {
  const methods: Record<string, (...args: never[]) => unknown> = {
    getSession: () => core.session(),
    createIdentity: (o: { kind: 'public' | 'anon'; name: string }) => core.createIdentity(o),
    restoreIdentity: (o: { phrase: string[]; name: string }) => core.restoreIdentity(o),
    revealPhrase: () => core.revealPhrase(),
    suggestWords: (p: string) => core.suggestWords(String(p)),
    eraseAll: () => core.eraseAll(),
    myCard: (kind: 'public' | 'anon', fresh?: boolean) => core.myCard(kind, !!fresh),
    addContactByCard: (text: string) => core.addContactByCard(String(text)),
    listConversations: () => core.listConversations(),
    getMessages: (id: string) => core.getMessages(String(id)),
    sendText: (id: string, text: string) => core.sendText(String(id), String(text)),
    markRead: (id: string) => core.markRead(String(id)),
    removeContact: (id: string) => core.removeContact(String(id)),
    safetyCode: (id: string) => core.safetyCode(String(id)),
    networkStatus: () => core.networkStatus(),
    addPeer: (a: string) => core.addPeer(String(a)),
    removePeer: (a: string) => core.removePeer(String(a)),
    wallet: () => core.wallet(),
    setWalletAddress: (a: string | null) => core.setWalletAddress(a === null ? null : String(a)),
    refreshWallet: () => core.refreshWallet(),
    getPrefs: () => core.prefs(),
    setPrefs: (p: Record<string, unknown>) => core.setPrefs(p ?? {}),
    openExternal: (url: string) => { if (/^https:\/\//.test(url)) return shell.openExternal(url); },
    copy: (text: string) => clipboard.writeText(String(text)),
    // Aviso de exemplo, com o mesmo caminho das mensagens reais (nativo do sistema).
    testNotification: () => notifyIncoming({ id: 'piu:teste', name: 'Piu', via: 'public', request: false }, 'Assim chegam as mensagens quando a janela não está em foco.', false, true),
    setConversationOpen: (open: boolean) => { conversationOpen = open === true; applyScreenSecurity(); },
    linkStart: () => core.linkStart(),
    linkConfirm: () => core.linkConfirm(),
    linkCancel: () => core.linkCancel(),
    linkStatus: () => core.linkStatus(),
  };
  ipcMain.handle('piu', async (_e, method: string, ...args: unknown[]) => {
    const fn = methods[method];
    if (!fn) throw new Error(`Método desconhecido: ${method}`);
    return fn(...(args as never[]));
  });
  for (const ev of ['conversations', 'message', 'network', 'wallet', 'session', 'prefs', 'link', 'notice'] as PiuEventName[]) core.events.on(ev, p => send(ev, p));
  core.events.on('prefs', applyScreenSecurity);
  core.events.on('incoming', (p: { contact: ContactInfo; text: string; isNew: boolean }) => notifyIncoming(p.contact, p.text, p.isNew));
}

// ── menu ──────────────────────────────────────────────────
function buildMenu() {
  // Menu do app com o nome "Piu" também em desenvolvimento (o papel `appMenu` usaria o nome do
  // binário, "Electron"). Em dev, scripts/dev-brand.mjs ainda renomeia o bundle para a barra de menus.
  const appMenu: MenuItemConstructorOptions = {
    label: 'Piu',
    submenu: [
      { label: 'Sobre o Piu', role: 'about' },
      { type: 'separator' },
      { label: 'Ocultar o Piu', role: 'hide' }, { role: 'hideOthers', label: 'Ocultar outros' }, { role: 'unhide', label: 'Mostrar tudo' },
      { type: 'separator' },
      { label: 'Sair do Piu', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : [{ label: 'Arquivo', submenu: [{ label: 'Sair do Piu', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] }]),
    { role: 'editMenu' },
    { label: 'Piu', submenu: [
      { label: 'Abrir pasta de dados', click: () => void shell.openPath(app.getPath('userData')) },
      { label: 'Sobre o LNNP na rede local…', click: () => void dialog.showMessageBox(win ?? undefined!, { type: 'info', title: 'Rede local', message: 'Este computador é um nó LNNP na sua rede Wi-Fi/Ethernet.', detail: 'Ele anuncia-se por UDP (porta 8423) e aceita enlaces TCP (porta 8422) de outros computadores e nós piu-node. As mensagens vão sempre cifradas de ponta a ponta; o enlace só vê envelopes.', buttons: ['Fechar'] }) },
    ] },
    { label: 'Exibir', submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── ciclo de vida ────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
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
    });
    registerIpc();
    try { await core.open(); }
    catch (e) { dialog.showErrorBox('Não foi possível abrir o Piu', (e as Error).message); }
    buildMenu();
    createWindow();
    app.on('activate', showWindow);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('will-quit', e => {
    if (!core) return;
    e.preventDefault();
    const c = core; core = undefined as unknown as PiuCore;
    void c.close().finally(() => app.exit(0));
  });
}
