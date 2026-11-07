/**
 * Piu Provider para computador (Linux e macOS).
 *
 * Este computador vira um nó do provider: o processo principal sobe o piu-node embutido
 * (API + painel, HTTPS com certificado próprio) e a janela mostra o painel servido por ele.
 * - Por padrão o nó só escuta em 127.0.0.1. "Permitir acesso pela rede local" (menu Nó) abre para a
 *   rede de casa, como o piu-node instalado num roteador ou Raspberry Pi.
 * - A janela só aceita o certificado do próprio nó (fixado pelo PEM) e não navega para fora dele.
 * - O pareamento desta janela é automático: o processo principal é a "tela do equipamento". A sessão
 *   é criada aqui no processo principal e o cookie vai direto para a sessão do Electron, sem código e
 *   sem passar pelo JavaScript da página. Ela não vale como step-up: outros navegadores e as operações
 *   sensíveis continuam pedindo o código, que aparece em Nó → Mostrar código.
 */
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { createServer } from 'node:net';
import { hostname, networkInterfaces, userInfo } from 'node:os';
import { join } from 'node:path';
import { type Config, loadLnnpConfig } from '../../piu-node/src/config';
import { ABSOLUTE_MS, SESSION_COOKIE, sessionLabel } from '../../piu-node/src/security/session';
import { startNode, type NodeServer } from '../../piu-node/src/server';
import { externalUrl } from './external';
import { matchLang, translator } from './i18n';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

const PREFERRED_PORT = 8420;
const isMac = process.platform === 'darwin';

app.setName('Piu Provider');
app.userAgentFallback = `${app.userAgentFallback} PiuProvider/${app.getVersion()}`;
app.enableSandbox();

let node: NodeServer | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let latestCode = '';
let prefs: Prefs;
/** Textos no idioma do sistema (definido em `whenReady`, quando o Electron já sabe o locale). */
let t = translator('pt-BR');

const asset = (name: string) => join(app.isPackaged ? process.resourcesPath : join(__dirname, '..'), 'assets', name);
const panelDir = () => (app.isPackaged ? join(process.resourcesPath, 'panel') : join(__dirname, '..', '..', 'provider-panel', 'dist'));
const origin = () => (node ? new URL(node.url).origin : '');
const pemBody = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');

/** Porta 8420 (a do piu-node) se estiver livre; senão, uma qualquer. */
function freePort(host: string): Promise<number> {
  const tryPort = (p: number) => new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(p, host, () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : p)); });
  });
  return tryPort(PREFERRED_PORT).catch(() => tryPort(0));
}

/** Nomes pelos quais o painel responde (o piu-node recusa os outros: proteção contra DNS rebinding). */
function hostsFor(port: number, lan: boolean): string[] {
  const names = ['localhost', '127.0.0.1'];
  if (lan) {
    names.push('piu-node.local', `${hostname().toLowerCase().replace(/\.local$/, '')}.local`);
    for (const list of Object.values(networkInterfaces())) {
      for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) names.push(i.address);
    }
  }
  return [...new Set(names)].flatMap(h => [h, `${h}:${port}`]);
}

async function bootNode() {
  const host = prefs.lan ? '0.0.0.0' : '127.0.0.1';
  const port = await freePort(host);
  const config: Config = {
    port, host,
    allowedHosts: hostsFor(port, prefs.lan),
    dataDir: join(app.getPath('userData'), 'node'),
    panelDir: panelDir(),
    releasePubKey: process.env.PIU_RELEASE_PUBKEY?.trim() || null,
    // Este computador retransmite: enlace LNNP com os nós da rede local (só envelopes cifrados,
    // handshake autenticado; não expõe o painel). Ajustável pelas variáveis PIU_LNNP_*.
    lnnp: loadLnnpConfig(),
  };
  node = await startNode(config, {
    onCode: code => { latestCode = code; }, log: msg => { if (!app.isPackaged) console.log(msg); },
    onRestart: () => void restartNode(),
  });
  latestCode = node.issueCode();
}

/**
 * Reiniciar pelo painel: o nó roda neste processo, então o app é o supervisor. Fecha o nó limpo
 * (mensagens guardadas e histórico gravados), sobe de novo e recarrega a janela (a sessão continua:
 * fica no disco do nó). Se não subir, avisa e sai.
 */
let restarting = false;
async function restartNode() {
  if (restarting || !node) return;
  restarting = true;
  const old = node;
  node = null;
  try {
    await old.close().catch(() => {});
    await bootNode();
    if (win) void win.loadURL(node!.url + '/');
  } catch (err) {
    dialog.showErrorBox(t('restart.title'), t('restart.body', { error: (err as Error).message }));
    quitting = true;
    app.exit(1);
  } finally { restarting = false; }
}

// ── segurança da janela ───────────────────────────────────
function hardenSession() {
  const ses = session.defaultSession;
  // Só o certificado do próprio nó, e só em localhost. Nada mais é carregado por esta janela.
  ses.setCertificateVerifyProc((req, cb) => {
    if (node && req.hostname === 'localhost' && pemBody(req.certificate.data) === pemBody(node.cert)) return cb(0);
    cb(-2);
  });
  // Nenhuma permissão do navegador, exceto copiar texto (botões "Copiar" do painel).
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  // Nada de requisições para fora do nó (o painel não usa internet).
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    cb({ cancel: !(u.startsWith(origin() + '/') || u.startsWith('devtools://') || u.startsWith('blob:') || u.startsWith('data:')) });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const ext = externalUrl(url); // só https para os hosts de external.ts (explorer da Lunes)
    if (ext) void shell.openExternal(ext);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => { if (!url.startsWith(origin() + '/')) e.preventDefault(); });
  contents.on('will-redirect', (e, url) => { if (!url.startsWith(origin() + '/')) e.preventDefault(); });
  contents.on('will-attach-webview', e => e.preventDefault());
});

// ── janela ────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 760, minHeight: 600,
    // Fundo da janela antes do painel pintar: o --side do design (claro #F8F8F6, escuro #0E0E0E).
    title: 'Piu Provider', show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E0E0E' : '#F8F8F6',
    icon: asset('icon.png'),
    // macOS: como no design, a faixa superior de 42 px do painel é a barra da janela, com os semáforos
    // de verdade dentro dela (o painel reconhece o app pelo user agent "PiuProvider/" e reserva o espaço).
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: !app.isPackaged },
  });
  win.once('ready-to-show', () => win?.show());
  // O nome da janela é o do app ("Piu Provider"), não o <title> da página.
  win.on('page-title-updated', e => e.preventDefault());
  win.webContents.on('did-finish-load', () => { void autoPair(); });
  win.on('close', e => {
    if (quitting || isMac) return;
    // Linux: fechar a janela não desliga o nó; ele continua na bandeja.
    if (tray) {
      e.preventDefault();
      win?.hide();
      if (!prefs.trayHintShown && Notification.isSupported()) {
        new Notification({ title: t('trayHint.title'), body: t('trayHint.body') }).show();
        prefs = savePrefs({ ...prefs, trayHintShown: true });
      }
    }
  });
  win.on('closed', () => { win = null; });
  void win.loadURL(node!.url + '/');
}

/** A sessão deste cookie está viva no nó? Pergunta direto ao nó embutido (sem rede e sem a página). */
async function sessionAlive(n: NodeServer, token: string) {
  const r = await n.app.inject({ method: 'GET', url: '/api/session', headers: { host: new URL(n.url).host, cookie: `${SESSION_COOKIE}=${token}`, accept: 'application/json' } });
  return r.statusCode === 200;
}

/**
 * Esta janela é a tela do próprio equipamento: pareia sozinha. A sessão nasce aqui no processo
 * principal e o token vai direto para o cookie `__Host-piu_session` (HttpOnly) da sessão do Electron.
 * Nenhum código é gerado nem entregue à página: um script nela não consegue capturar um código para
 * usar como step-up (auditoria 2026-11-06, provider.md M-01).
 */
let pairing = false;
async function autoPair() {
  if (!win || !node || pairing) return;
  pairing = true;
  try {
    const n = node, url = n.url + '/';
    const [cur] = await session.defaultSession.cookies.get({ url, name: SESSION_COOKIE });
    if (cur && await sessionAlive(n, cur.value)) return;
    const { token } = n.localSession(operatorName(), sessionLabel(app.userAgentFallback));
    // Sem `domain`: cookie só deste host, como o prefixo __Host- exige (Secure, Path=/).
    await session.defaultSession.cookies.set({
      url, name: SESSION_COOKIE, value: token, secure: true, httpOnly: true, sameSite: 'strict', path: '/',
      expirationDate: Math.floor((Date.now() + ABSOLUTE_MS) / 1000),
    });
    // Só recarrega com a sessão de pé (nada de recarregar sem parar se algo der errado).
    const [set] = await session.defaultSession.cookies.get({ url, name: SESSION_COOKIE });
    if (set?.value === token && await sessionAlive(n, token)) win?.webContents.reload();
  } catch { /* a página mostra a tela de pareamento; o código está em Nó → Mostrar código */ }
  finally { pairing = false; }
}

function operatorName() {
  try { const n = userInfo().username; return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 40) || t('operator.fallback'); } catch { return t('operator.fallback'); }
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

async function showCode() {
  const code = latestCode || node!.issueCode();
  await dialog.showMessageBox(win ?? undefined!, {
    type: 'info', title: t('code.title'), message: `${code.slice(0, 4)} ${code.slice(4)}`,
    detail: t('code.detail'),
    buttons: [t('close')],
  });
}

async function toggleLan() {
  const next = !prefs.lan;
  const { response } = await dialog.showMessageBox(win ?? undefined!, {
    type: 'question', buttons: [next ? t('lan.allow') : t('lan.disallow'), t('cancel')], defaultId: 0, cancelId: 1,
    title: t('lan.title'),
    message: next ? t('lan.messageOn') : t('lan.messageOff'),
    detail: next
      ? t('lan.detailOn', { port: PREFERRED_PORT })
      : t('lan.detailOff'),
  });
  if (response !== 0) return;
  prefs = savePrefs({ ...prefs, lan: next });
  app.relaunch();
  quitting = true;
  app.quit();
}

function buildMenu() {
  const nodeMenu: MenuItemConstructorOptions = {
    label: t('menu.node'),
    submenu: [
      { label: t('menu.showCode'), accelerator: 'CmdOrCtrl+K', click: () => void showCode() },
      { label: t('menu.copyAddress'), click: () => clipboard.writeText(prefs.lan ? `https://piu-node.local:${node!.port}` : node!.url) },
      { label: t('menu.fingerprint'), click: () => void dialog.showMessageBox(win ?? undefined!, { type: 'info', title: t('cert.title'), message: 'SHA-256', detail: t('cert.detail', { fingerprint: node!.fingerprint }), buttons: [t('close')] }) },
      { type: 'separator' },
      { label: t('menu.lan'), type: 'checkbox', checked: prefs.lan, click: () => void toggleLan() },
      ...(isMac ? [{ label: t('menu.openAtLogin'), type: 'checkbox' as const, checked: app.getLoginItemSettings().openAtLogin, click: (i: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: i.checked }) }] : []),
      { label: t('menu.dataFolder'), click: () => void shell.openPath(app.getPath('userData')) },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : [{ label: t('menu.file'), submenu: [{ label: t('menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] }]),
    { role: 'editMenu' },
    nodeMenu,
    { label: t('menu.view'), submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  try {
    const img = nativeImage.createFromPath(asset(isMac ? 'trayTemplate.png' : 'tray.png'));
    if (isMac) img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip(prefs.lan ? t('tray.tooltipLan') : t('tray.tooltipLocal'));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('tray.open'), click: showWindow },
      { label: t('menu.showCode'), click: () => void showCode() },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch { tray = null; } // sem bandeja (alguns ambientes Linux): fechar a janela encerra o app
}

// ── ciclo de vida ────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    t = translator(matchLang([...app.getPreferredSystemLanguages(), app.getLocale()]) ?? 'pt-BR');
    prefs = loadPrefs(app.getPath('userData'));
    hardenSession();
    try {
      await bootNode();
    } catch (err) {
      dialog.showErrorBox(t('boot.title'), t('boot.body', { error: (err as Error).message }));
      app.exit(1);
      return;
    }
    buildMenu();
    buildTray();
    createWindow();
    app.on('activate', showWindow);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac && !tray) app.quit(); });
  app.on('will-quit', e => {
    if (!node) return;
    e.preventDefault();
    const n = node; node = null;
    void n.close().finally(() => app.exit(0));
  });
}
