#!/usr/bin/env node
/**
 * Confere o painel em várias larguras: nenhuma rolagem horizontal em nenhuma rota, nos temas claro e
 * escuro, e alvos de toque com pelo menos 44 px no celular. Tira capturas para conferir a olho.
 *
 *   npm run build
 *   node scripts/check-responsive.mjs                         # demonstração (serve o dist/ aqui mesmo), inclusive embutido em iframe
 *   node scripts/check-responsive.mjs --url https://localhost:8430 --code 12345678 --name Cardeal   # com piu-node
 *   node scripts/check-responsive.mjs --shots /tmp/capturas  # pasta das capturas (padrão: ./responsive-shots)
 *
 * Precisa do Playwright com o Chromium instalado (`npx playwright install chromium`).
 * Sai com código 1 se alguma largura tiver rolagem horizontal ou alvo de toque pequeno.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']] : a), []));
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const shots = resolve(args.shots ?? 'responsive-shots');
const WIDTHS = [360, 390, 768, 1024, 1280];
const ROUTES = ['overview', 'devices', 'mesh', 'earnings', 'wallet', 'settings'];
const THEMES = ['light', 'dark'];

/** Servidor estático mínimo do dist/ (modo demonstração), com uma página que embute o painel num iframe, como o site. */
function serveDist() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Rode `npm run build` antes (dist/ não existe).');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/__site.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh;display:block}</style><iframe src="/" title="Painel"></iframe>');
      return;
    }
    if (path.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
    let file = normalize(join(dist, path));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function main() {
  mkdirSync(shots, { recursive: true });
  let server = null;
  let base = args.url;
  if (!base) { server = await serveDist(); base = `http://127.0.0.1:${server.address().port}`; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const problems = [];
  const errors = [];

  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  if (args.code) {
    // Com piu-node: pareia uma vez com o código do console do equipamento.
    await page.goto(base + '/');
    const inputs = await page.waitForSelector('input').then(() => page.$$('input'));
    await inputs[0].fill(String(args.code));
    await inputs[1].fill(String(args.name ?? 'Operador'));
    await page.click('button[type=submit]');
    await page.waitForSelector('nav[aria-label=Painel]');
  }

  for (const theme of THEMES) {
    // Tema salvo e página recarregada (trocar só o #hash não recarrega o painel).
    if (!page.url().startsWith(base)) await page.goto(base + '/');
    await page.evaluate(t => localStorage.setItem('piu-theme', t), theme);
    await page.reload();
    await page.waitForSelector('nav[aria-label=Painel]');
    const applied = await page.evaluate(() => document.documentElement.dataset.piuTheme);
    if (applied !== theme) problems.push(`tema ${theme} não foi aplicado (${applied})`);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 760 ? 800 : 900 });
      for (const route of ROUTES) {
        await page.goto(`${base}/#/${route}`);
        await page.waitForSelector('nav[aria-label=Painel]');
        await page.waitForTimeout(350);
        const m = await page.evaluate(() => {
          const el = document.documentElement;
          // Também dentro do <main>, que rola sozinho.
          const main = document.querySelector('main');
          return { sw: el.scrollWidth, cw: el.clientWidth, msw: main?.scrollWidth ?? 0, mcw: main?.clientWidth ?? 0 };
        });
        const tag = `${theme} ${w}px #/${route}`;
        if (m.sw > m.cw) problems.push(`${tag}: página rola para o lado (${m.sw} > ${m.cw})`);
        if (m.msw > m.mcw + 1) problems.push(`${tag}: conteúdo rola para o lado (${m.msw} > ${m.mcw})`);
        if (w < 760) {
          // Alvos de toque: navegação e botões visíveis com pelo menos 44 px de altura.
          const small = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label=Painel] button, main .btn, header .btn')]
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; })
            .filter(b => b.getBoundingClientRect().height < 44)
            .map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)));
          if (small.length) problems.push(`${tag}: alvos de toque < 44 px: ${small.join(', ')}`);
        }
        if (theme === 'light' || route === 'overview') await page.screenshot({ path: join(shots, `${theme}-${w}-${route}.png`), fullPage: true });
      }
    }
  }

  // Assistente aberto no celular: ocupa a largura com 16 px de margem, sem rolar para o lado.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/#/overview`);
  await page.waitForSelector('nav[aria-label=Painel]');
  await page.click('text=Adicionar equipamento');
  await page.waitForTimeout(400);
  const wiz = await page.evaluate(() => { const r = document.querySelector('.wiz')?.getBoundingClientRect(); return r && { left: Math.round(r.left), right: Math.round(innerWidth - r.right), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
  if (!wiz || wiz.left !== 16 || wiz.right !== 16 || wiz.sw > wiz.cw) problems.push(`assistente a 390 px: ${JSON.stringify(wiz)}`);
  await page.screenshot({ path: join(shots, 'wizard-390.png') });

  // Embutido no site (iframe), só na demonstração.
  if (!args.url) {
    for (const w of [390, 1024]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto(`${base}/__site.html`);
      const frame = await (await page.waitForSelector('iframe')).contentFrame();
      await frame.waitForSelector('nav[aria-label=Painel]');
      const m = await frame.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, demo: document.body.innerText.includes('demonstração') }));
      if (m.sw > m.cw) problems.push(`iframe ${w}px: rola para o lado (${m.sw} > ${m.cw})`);
      if (!m.demo) problems.push(`iframe ${w}px: deveria mostrar o selo "demonstração"`);
      await page.screenshot({ path: join(shots, `iframe-${w}.png`) });
    }
  }

  await browser.close();
  server?.close();
  for (const e of errors) problems.push('erro na página: ' + e);
  console.log(`${WIDTHS.length} larguras × ${ROUTES.length} rotas × ${THEMES.length} temas · capturas em ${shots}`);
  if (problems.length) { console.log('PROBLEMAS:\n' + problems.join('\n')); process.exit(1); }
  console.log('OK: nenhuma rolagem horizontal; alvos de toque ≥ 44 px no celular.');
}

main().catch(e => { console.error(e); process.exit(1); });
