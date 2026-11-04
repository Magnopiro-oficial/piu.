/**
 * Piu Provider para computador (Linux e macOS).
 *
 * Este computador vira um nó do provider: o processo principal sobe o piu-node embutido
 * (API + painel, HTTPS com certificado próprio) e a janela mostra o painel servido por ele.
 * - Por padrão o nó só escuta em 127.0.0.1. "Permitir acesso pela rede local" (menu Nó) abre para a
 *   rede de casa, como o piu-node instalado num roteador ou Raspberry Pi.
 * - A janela só aceita o certificado do próprio nó (fixado pelo PEM) e não navega para fora dele.
 * - O pareamento desta janela é automático: o processo principal é a "tela do equipamento".
 *   Outros navegadores e o step-up continuam pedindo o código, que aparece em Nó → Mostrar código.
 */
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, Notification, session, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { createServer } from 'node:net';
import { hostname, networkInterfaces, userInfo } from 'node:os';
import { join } from 'node:path';
import { type Config, loadLnnpConfig } from '../../piu-node/src/config';
import { startNode, type NodeServer } from '../../piu-node/src/server';
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
    dialog.showErrorBox('Não foi possível reiniciar o nó', `O piu-node embutido não voltou a subir.\n\n${(err as Error).message}`);
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
    if (url.startsWith('https://') && !url.startsWith(origin())) void shell.openExternal(url);
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
    title: 'Piu Provider', show: false, backgroundColor: '#F7F7F5',
    icon: asset('icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: !app.isPackaged },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.on('did-finish-load', () => { void autoPair(); });
  win.on('close', e => {
    if (quitting || isMac) return;
    // Linux: fechar a janela não desliga o nó; ele continua na bandeja.
    if (tray) {
      e.preventDefault();
      win?.hide();
      if (!prefs.trayHintShown && Notification.isSupported()) {
        new Notification({ title: 'O Piu Provider continua ligado', body: 'O nó segue retransmitindo. Use o ícone da bandeja para abrir ou sair.' }).show();
        prefs = savePrefs({ ...prefs, trayHintShown: true });
      }
    }
  });
  win.on('closed', () => { win = null; });
  void win.loadURL(node!.url + '/');
}

/** Esta janela é a tela do próprio equipamento: pareia sozinha com um código gerado aqui. */
let pairing = false;
async function autoPair() {
  if (!win || pairing) return;
  pairing = true;
  try {
    const status = await win.webContents.executeJavaScript(`fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(r => r.status)`);
    if (status !== 401) return;
    const body = JSON.stringify({ code: node!.issueCode(), name: operatorName() });
    const ok = await win.webContents.executeJavaScript(
      `fetch('/api/pair', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: ${JSON.stringify(body)} }).then(r => r.ok)`,
    );
    if (ok) win.webContents.reload();
  } catch { /* a página mostra a tela de pareamento; o código está em Nó → Mostrar código */ }
  finally { pairing = false; }
}

function operatorName() {
  try { const n = userInfo().username; return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 40) || 'Este computador'; } catch { return 'Este computador'; }
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

async function showCode() {
  const code = latestCode || node!.issueCode();
  await dialog.showMessageBox(win ?? undefined!, {
    type: 'info', title: 'Código de pareamento', message: `${code.slice(0, 4)} ${code.slice(4)}`,
    detail: 'Use este código para entrar no painel por outro navegador da rede local, ou para confirmar uma operação sensível (transferir LUNES, encerrar sessões).\n\nVale por 10 minutos e uma única vez. Não envie para ninguém.',
    buttons: ['Fechar'],
  });
}

async function toggleLan() {
  const next = !prefs.lan;
  const { response } = await dialog.showMessageBox(win ?? undefined!, {
    type: 'question', buttons: [next ? 'Permitir e reiniciar' : 'Desligar e reiniciar', 'Cancelar'], defaultId: 0, cancelId: 1,
    title: 'Acesso pela rede local',
    message: next ? 'Permitir acesso ao painel pela rede de casa?' : 'Voltar a aceitar só este computador?',
    detail: next
      ? `O painel passa a responder em https://piu-node.local:${PREFERRED_PORT} e no endereço deste computador na rede. Quem estiver na mesma rede ainda precisa do código de pareamento, que só aparece aqui. Nunca pela internet.`
      : 'Outros aparelhos da rede deixam de ver o painel. As sessões abertas por eles param de funcionar.',
  });
  if (response !== 0) return;
  prefs = savePrefs({ ...prefs, lan: next });
  app.relaunch();
  quitting = true;
  app.quit();
}

function buildMenu() {
  const nodeMenu: MenuItemConstructorOptions = {
    label: 'Nó',
    submenu: [
      { label: 'Mostrar código de pareamento…', accelerator: 'CmdOrCtrl+K', click: () => void showCode() },
      { label: 'Copiar endereço do painel', click: () => clipboard.writeText(prefs.lan ? `https://piu-node.local:${node!.port}` : node!.url) },
      { label: 'Impressão digital do certificado…', click: () => void dialog.showMessageBox(win ?? undefined!, { type: 'info', title: 'Certificado do nó', message: 'SHA-256', detail: `${node!.fingerprint}\n\nConfira este valor no navegador antes de aceitar o certificado de piu-node.local.`, buttons: ['Fechar'] }) },
      { type: 'separator' },
      { label: 'Permitir acesso pela rede local', type: 'checkbox', checked: prefs.lan, click: () => void toggleLan() },
      ...(isMac ? [{ label: 'Abrir ao iniciar a sessão', type: 'checkbox' as const, checked: app.getLoginItemSettings().openAtLogin, click: (i: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: i.checked }) }] : []),
      { label: 'Abrir pasta de dados', click: () => void shell.openPath(app.getPath('userData')) },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : [{ label: 'Arquivo', submenu: [{ label: 'Sair', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] }]),
    { role: 'editMenu' },
    nodeMenu,
    { label: 'Exibir', submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray() {
  try {
    const img = nativeImage.createFromPath(asset(isMac ? 'trayTemplate.png' : 'tray.png'));
    if (isMac) img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip(`Piu Provider · nó ${prefs.lan ? 'na rede local' : 'local'}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir painel', click: showWindow },
      { label: 'Mostrar código de pareamento…', click: () => void showCode() },
      { type: 'separator' },
      { label: 'Sair do Piu Provider', click: () => { quitting = true; app.quit(); } },
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
    prefs = loadPrefs(app.getPath('userData'));
    hardenSession();
    try {
      await bootNode();
    } catch (err) {
      dialog.showErrorBox('Não foi possível iniciar o nó', `O piu-node embutido não subiu.\n\n${(err as Error).message}`);
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
