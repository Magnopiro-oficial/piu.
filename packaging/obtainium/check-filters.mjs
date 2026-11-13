#!/usr/bin/env node
// Confere a configuração do Obtainium (net.piu.app.json) contra os releases reais do GitHub.
//
// Reproduz a escolha de release da fonte GitHub do Obtainium (lib/app_sources/github.dart, v1.7.x):
// pede /releases?per_page=100, ordena por data de publicação (sortMethodChoice "date"), percorre do mais
// novo para o mais antigo, pula rascunho/pré-release, aplica o filtro de título (o título do release; a tag
// só entra quando o título está vazio) e o filtro de arquivo (só .apk/.xapk/.apkm/.apks entram no filtro).
// Com fallbackToOlderReleases, o primeiro release que passa nos dois filtros é o escolhido.
//
// Também confere que os links obtainium://app/... do README e do site decodificam para a mesma configuração.
//
// Uso: node packaging/obtainium/check-filters.mjs [--expect-tag android-vX.Y.Z] [--expect-apk Piu-X.Y.Z.apk]
//      node packaging/obtainium/check-filters.mjs --link   (só imprime os links)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const entry = JSON.parse(readFileSync(join(here, 'net.piu.app.json'), 'utf8'));
const config = entry.configs[0];
const settings = JSON.parse(config.additionalSettings);

export const deepLink = (c = config) => `obtainium://app/${encodeURIComponent(JSON.stringify(c))}`;
export const redirectLink = (c = config) => `https://apps.obtainium.imranr.dev/redirect?r=${deepLink(c)}`;

const APK_EXT = ['.apk', '.xapk', '.apkm', '.apks'];
const isApk = name => APK_EXT.some(e => name.toLowerCase().endsWith(e));

/** Mesma lógica de _selectGitHubTargetRelease do Obtainium, para os campos que a configuração usa. */
export function selectRelease(releases, s = settings) {
  const byDate = [...releases].sort((a, b) => new Date(a.published_at ?? 0) - new Date(b.published_at ?? 0)).reverse();
  const title = s.filterReleaseTitlesByRegEx ? new RegExp(s.filterReleaseTitlesByRegEx) : null;
  const apk = s.apkFilterRegEx ? new RegExp(s.apkFilterRegEx) : null;
  const log = [];
  let skipped = 0;
  for (let i = 0; i < byDate.length; i++) {
    const r = byDate[i];
    if (!s.fallbackToOlderReleases && i > skipped) break;
    if ((!s.includePrereleases && r.prerelease) || r.draft) { skipped++; log.push([r.tag_name, 'pulado (rascunho/pré-release)']); continue; }
    const name = (r.name ?? '').trim() || String(r.tag_name ?? '');
    if (title && title.test(name.trim()) === !!s.invertReleaseTitlesFilter) { log.push([r.tag_name, `título "${name}" fora do filtro`]); continue; }
    const apks = (r.assets ?? []).map(a => a.name).filter(isApk).filter(n => !apk || apk.test(n) !== !!s.invertAPKFilter);
    if (!apks.length) { log.push([r.tag_name, 'nenhum APK passa no filtro de arquivo']); continue; }
    log.push([r.tag_name, `ESCOLHIDO: ${apks.join(', ')}`]);
    return { release: r, apks, log };
  }
  return { release: null, apks: [], log };
}

function fail(msg) { console.error(`FALHOU: ${msg}`); process.exitCode = 1; }

async function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--link')) { console.log(deepLink()); console.log(redirectLink()); return; }

  // 1. Casos sintéticos: o filtro tem que barrar os outros produtos mesmo que um dia tragam APK.
  const fake = (tag, name, assets, published_at, extra = {}) => ({ tag_name: tag, name, assets: assets.map(n => ({ name: n })), published_at, ...extra });
  const synthetic = [
    fake('provider-v9.0.0', 'Piu Provider 9.0.0', ['Piu-Provider-9.0.0.apk'], '2030-01-05'),
    fake('desktop-v9.0.0', 'Piu Desktop 9.0.0', ['Piu-9.0.0-win-x64.exe', 'Piu-9.0.0.apk'], '2030-01-04'),
    fake('node-v9.0.0', 'Piu Node 9.0.0', ['piu-node_9.0.0-1_all.deb'], '2030-01-03'),
    fake('android-v9.1.0', 'Piu 9.1.0 para Android', ['Piu-9.1.0.apk'], '2030-01-02', { prerelease: true }),
    fake('android-v9.0.0', 'Piu 9.0.0 para Android', ['Piu-9.0.0.apk', 'SHA256SUMS.txt'], '2030-01-01'),
  ];
  const syn = selectRelease(synthetic);
  console.log('Casos sintéticos:');
  for (const [tag, why] of syn.log) console.log(`  ${tag.padEnd(16)} ${why}`);
  if (syn.release?.tag_name !== 'android-v9.0.0' || syn.apks.join() !== 'Piu-9.0.0.apk') fail('casos sintéticos não escolheram android-v9.0.0 / Piu-9.0.0.apk');
  // Cada filtro sozinho também segura o caso de outro produto com APK (defesa em dobro).
  const onlyApk = selectRelease(synthetic.filter(r => r.tag_name !== 'desktop-v9.0.0'), { ...settings, filterReleaseTitlesByRegEx: '' });
  const onlyTitle = selectRelease(synthetic.filter(r => r.tag_name !== 'desktop-v9.0.0'), { ...settings, apkFilterRegEx: '' });
  console.log(`  só o filtro de arquivo -> ${onlyApk.release?.tag_name}; só o filtro de título -> ${onlyTitle.release?.tag_name}`);
  if (onlyApk.release?.tag_name !== 'android-v9.0.0' || onlyTitle.release?.tag_name !== 'android-v9.0.0') fail('um dos filtros sozinho deixou passar outro produto');

  // 2. Releases reais.
  const api = `https://api.github.com/repos/${new URL(config.url).pathname.slice(1)}/releases?per_page=100`;
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'piu-obtainium-check' } });
  if (!res.ok) { fail(`${api} respondeu ${res.status}`); return; }
  const releases = await res.json();
  const real = selectRelease(releases);
  console.log(`\nReleases reais (${releases.length}) em ${api}:`);
  for (const [tag, why] of real.log) console.log(`  ${tag.padEnd(16)} ${why}`);
  const tag = real.release?.tag_name;
  const version = tag?.match(/\d+\.\d+\.\d+/)?.[0];
  console.log(`\nResultado: tag ${tag ?? '(nenhuma)'} · arquivo ${real.apks.join(', ') || '(nenhum)'} · versão comparada pelo Obtainium ${version ?? '?'}`);
  const expTag = opt('--expect-tag'), expApk = opt('--expect-apk');
  if (!tag) fail('nenhum release passou nos filtros');
  if (expTag && tag !== expTag) fail(`esperava a tag ${expTag}`);
  if (expApk && real.apks.join() !== expApk) fail(`esperava só o arquivo ${expApk}`);
  if (real.apks.length !== 1) fail('o release escolhido tem que ter exatamente 1 APK');

  // Mesmos releases sem o Android mais novo: Desktop e Node passam a ser os mais recentes e têm que ser pulados.
  if (tag) {
    const older = selectRelease(releases.filter(r => r.tag_name !== tag));
    console.log(`\nSem o ${tag} (outros produtos ficam mais novos que o Android):`);
    for (const [t, why] of older.log) console.log(`  ${t.padEnd(16)} ${why}`);
    if (!/^android-v/.test(older.release?.tag_name ?? '')) fail('sem o release mais novo, a escolha saiu de android-v*');
  }

  // 3. Links do README apontam para esta mesma configuração.
  for (const f of ['README.md', 'README.pt-BR.md']) {
    const text = readFileSync(join(root, f), 'utf8');
    const m = text.match(/obtainium:\/\/app\/([^)\s"'<>]+)/);
    if (!m) { fail(`${f} sem link obtainium://app/`); continue; }
    const same = JSON.stringify(JSON.parse(decodeURIComponent(m[1]))) === JSON.stringify(config);
    console.log(`${f}: link ${same ? 'igual à configuração' : 'DIFERENTE da configuração'}`);
    if (!same) fail(`${f}: o link não bate com net.piu.app.json (gere com --link)`);
  }
  if (!process.exitCode) console.log('\nOK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
