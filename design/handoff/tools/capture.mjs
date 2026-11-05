// Renders every screen of the Piu prototypes to PNG (and key animations to WebM)
// so the implementation can be compared pixel by pixel against the design.
//
//   cd tools && npm i && npx playwright install chromium && node capture.mjs
//   node capture.mjs --only=app      (app | prov | desk | canvas)
//   node capture.mjs --no-video
//
// Output: ../reference/<group>/<name>.png  and  ../reference/video/<name>.webm
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../design');
const OUT = path.resolve(here, '../reference');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

// ---- screen lists --------------------------------------------------------
const APP = ['welcome', 'identity', 'keys', 'chats', 'chat', 'route', 'queue', 'group', 'channel', 'fileSend', 'contact', 'groupInfo',
  'new', 'newChannel', 'community', 'nearby', 'nearProfile', 'nearInvite', 'requests', 'match', 'network', 'diagnostics',
  'provIntro', 'provAdd', 'provConnect', 'provAp', 'provTest', 'provConfig', 'provider', 'provDevice', 'provEarnings',
  'wallet', 'send', 'receive', 'rewards', 'referrals', 'profile', 'invite', 'share', 'recvPage', 'verify', 'accept',
  'lock', 'lockPrivate', 'notifSettings', 'dlg:delete', 'dlg:battery', 'dlg:backup', 'dlg:revoke',
  'backup', 'restore', 'migrate', 'myDevices', 'privacy', 'storage', 'battery'];
const APP_NOTIFY = ['msg', 'lunes', 'node', 'expired', 'offline', 'delivered', 'emergency'];
const PROV = ['overview', 'devices', 'detail', 'mesh', 'earnings', 'wallet', 'sign', 'settings', 'wizard', 'wizPair', 'wizTest'];
const DESK_AUTH = ['start', 'qr', 'confirm', 'create', 'phrase'];
const DESK_SET = ['profile', 'devices', 'notifs', 'privacy', 'look', 'chats', 'network', 'system', 'backup', 'lang', 'keys'];
const CANVAS = ['Piu', 'Piu 1 Base do app', 'Piu 2 Convite P2P', 'Piu 3 Carteira', 'Piu 4 Por perto', 'Piu 5 Alertas e animacoes',
  'Piu 6 Provider celular', 'Piu 7 Provider computador', 'Piu 8 Seguranca e ajustes', 'Piu Site', 'Piu Site EN'];

const browser = await chromium.launch();
const want = g => !args.only || args.only === g;
const safe = s => s.replace(/[:/ ]/g, '_');
const settle = (page, ms = 1200) => page.evaluate(() => document.fonts.ready).then(() => page.waitForTimeout(ms));

async function harness(q, size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/capture.dc.html?${new URLSearchParams(q)}`);
  await page.waitForFunction(() => window.__ready === true);
  await settle(page, 3500); // let the launch animation finish
  return { ctx, page };
}
async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator('#cap').screenshot({ path: file, animations: 'disabled' });
  console.log('✓', path.relative(OUT, file));
}

if (want('app')) for (const theme of ['light', 'dark']) {
  const { ctx, page } = await harness({ mode: 'app', theme }, { width: 390, height: 844 });
  for (const s of APP) { await page.evaluate(x => window.__go(x), s); await settle(page); await shot(page, `${OUT}/app/${theme}/${safe(s)}.png`); }
  for (const t of APP_NOTIFY) { await page.evaluate(() => window.__go('chats')); await settle(page, 600); await page.evaluate(x => window.__notify(x), t); await settle(page, 900); await shot(page, `${OUT}/app/${theme}/notify_${t}.png`); }
  await ctx.close();
}
if (want('prov')) for (const theme of ['light', 'dark']) {
  const { ctx, page } = await harness({ mode: 'prov', theme }, { width: 1280, height: 820 });
  for (const s of PROV) { await page.evaluate(x => window.__go(x), s); await settle(page); await shot(page, `${OUT}/provider-desktop/${theme}/${s}.png`); }
  await ctx.close();
}
if (want('desk')) for (const os of ['mac', 'linux']) for (const theme of ['light', 'dark']) {
  const dir = `${OUT}/desktop/${os}-${theme}`;
  const { ctx, page } = await harness({ mode: 'desk', os, theme, start: 'auth' }, { width: 1280, height: 820 });
  for (const a of DESK_AUTH) { await page.evaluate(x => window.__desk({ phase: 'auth', authStep: x }), a); await settle(page); await shot(page, `${dir}/auth_${a}.png`); }
  await page.evaluate(() => window.__desk({ phase: 'app', nav: 'chats', infoOpen: false })); await settle(page); await shot(page, `${dir}/chats.png`);
  await page.evaluate(() => window.__desk({ infoOpen: true })); await settle(page); await shot(page, `${dir}/chats_info.png`);
  await page.evaluate(() => window.__desk({ infoOpen: false, routeMsg: 'm4' })); await settle(page); await shot(page, `${dir}/chats_route.png`);
  await page.evaluate(() => window.__desk({ routeMsg: null, nav: 'wallet', wSheet: null })); await settle(page, 2200); await shot(page, `${dir}/wallet.png`);
  for (const w of ['send', 'receive']) { await page.evaluate(x => window.__desk({ wSheet: x }), w); await settle(page); await shot(page, `${dir}/wallet_${w}.png`); }
  await page.evaluate(() => window.__desk({ wSheet: null, nav: 'settings' }));
  for (const p of DESK_SET) { await page.evaluate(x => window.__desk({ page: x }), p); await settle(page, 700); await shot(page, `${dir}/settings_${p}.png`); }
  await ctx.close();
}
if (want('canvas')) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const f of CANVAS) { await page.goto(`${BASE}/${encodeURIComponent(f)}.dc.html`); await settle(page, 4000); fs.mkdirSync(`${OUT}/canvas`, { recursive: true }); await page.screenshot({ path: `${OUT}/canvas/${safe(f)}.png`, fullPage: true }); console.log('✓ canvas', f); }
  await ctx.close();
}

// ---- motion references (real-time video) ---------------------------------
if (!args['no-video'] && !args.only) {
  const vdir = `${OUT}/video`; fs.mkdirSync(vdir, { recursive: true });
  const rec = async (name, q, size, run, ms) => {
    const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: vdir, size } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/capture.dc.html?${new URLSearchParams(q)}`);
    await page.waitForFunction(() => window.__ready === true);
    if (run) await run(page);
    await page.waitForTimeout(ms);
    const v = page.video(); await ctx.close(); fs.renameSync(await v.path(), `${vdir}/${name}.webm`); console.log('🎬', name);
  };
  const A = { width: 390, height: 844 }, D = { width: 1280, height: 820 };
  await rec('app_launch', { mode: 'app' }, A, null, 4000);
  await rec('app_send_message', { mode: 'app' }, A, async p => { await p.waitForTimeout(3000); await p.evaluate(() => window.__notify('demoSend')); }, 7000);
  await rec('app_incoming_banner', { mode: 'app' }, A, async p => { await p.waitForTimeout(3000); await p.evaluate(() => window.__notify('msg')); }, 7000);
  await rec('app_emergency', { mode: 'app' }, A, async p => { await p.waitForTimeout(3000); await p.evaluate(() => window.__notify('emergency')); }, 4000);
  await rec('app_tabs', { mode: 'app' }, A, async p => { await p.waitForTimeout(3000); for (const s of ['nearby', 'network', 'wallet', 'profile', 'chats', 'chat']) { await p.evaluate(x => window.__go(x), s); await p.waitForTimeout(900); } }, 1000);
  await rec('desktop_mac_launch', { mode: 'desk', os: 'mac', start: 'splash' }, D, null, 5000);
  await rec('desktop_linux_launch', { mode: 'desk', os: 'linux', theme: 'dark', start: 'splash' }, D, null, 5000);
  await rec('desktop_wallet', { mode: 'desk', start: 'app' }, D, async p => { await p.waitForTimeout(1500); await p.evaluate(() => window.__desk({ nav: 'wallet' })); }, 3500);
  await rec('provider_mesh', { mode: 'prov' }, D, async p => { await p.waitForTimeout(1500); await p.evaluate(() => window.__go('mesh')); }, 6000);
}

await browser.close(); server.close();
console.log('\nReferências em', OUT);
