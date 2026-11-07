#!/usr/bin/env node
// Preenche src/lib/releases.json com o que está PUBLICADO no GitHub (nome, URL, tamanho e SHA-256 de cada
// arquivo), lido de `gh release view <tag> --json ...`. É o único lugar de onde o site tira os downloads.
//
//   node scripts/sync-release.mjs                     # relê as tags que já estão em releases.json
//   node scripts/sync-release.mjs --android android-v0.1.1 --desktop desktop-v0.1.0 --provider provider-v0.1.0
//   node scripts/sync-release.mjs --dry-run           # só mostra, não grava
//
// Regras: rascunho (draft) ou tag inexistente = "não publicado" (o site mostra "em breve", sem link).
// Cada valor é conferido (tag, nome, URL do próprio release, tamanho, digest sha256 de 64 hexa) e, se o
// release tiver SHA256SUMS.txt, cada hash é comparado com ele. Qualquer divergência aborta sem gravar.
// O certificado de assinatura do APK (ANDROID_CERT_SHA256) não vem do GitHub: fica em src/lib/androidRelease.ts.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GH_REPO = 'Magnopiro-oficial/piu.';
const REPO = `https://github.com/${GH_REPO}`;
const OUT = fileURLToPath(new URL('../src/lib/releases.json', import.meta.url));

// Mesmos ids de src/lib/desktopRelease.ts (nomes do electron-builder: <produto>-<versão>-<os>-<arch>.<ext>).
const DESKTOP_SUFFIX = {
  'mac-arm64-dmg': '-mac-arm64.dmg',
  'mac-x64-dmg': '-mac-x64.dmg',
  'mac-arm64-zip': '-mac-arm64.zip',
  'mac-x64-zip': '-mac-x64.zip',
  'linux-appimage': '-linux-x86_64.AppImage',
  'linux-deb': '-linux-amd64.deb',
  'win-x64-exe': '-win-x64.exe',
};
// O GitHub troca espaço por ponto no nome do arquivo ("Piu Provider" → "Piu.Provider").
const PRODUCTS = {
  android: { prefix: /^android-v(\d+\.\d+\.\d+)$/, names: v => ({ apk: new RegExp(`^Piu-${esc(v)}\\.apk$`) }) },
  desktop: { prefix: /^desktop-v(\d+\.\d+\.\d+)$/, names: v => desktopNames(`Piu-${esc(v)}`) },
  provider: { prefix: /^provider-v(\d+\.\d+\.\d+)$/, names: v => desktopNames(`Piu[-.]Provider-${esc(v)}`) },
};
const SUMS = 'SHA256SUMS.txt';

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function desktopNames(head) {
  const out = {};
  for (const [id, suf] of Object.entries(DESKTOP_SUFFIX)) out[id] = new RegExp(`^${head}${esc(suf)}$`);
  out.sums = new RegExp(`^${esc(SUMS)}$`);
  out.sig = new RegExp(`^${esc(SUMS)}\\.asc$`);
  return out;
}
const fail = msg => { console.error(`sync-release: ${msg}`); process.exit(1); };

function parseArgs(argv) {
  const a = { dry: false, tags: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dry = true;
    else if (k.startsWith('--') && k.slice(2) in PRODUCTS) { const v = argv[++i]; if (!v) fail(`${k} precisa de uma tag`); a.tags[k.slice(2)] = v; }
    else fail(`argumento desconhecido: ${k} (use --android, --desktop, --provider <tag> e --dry-run)`);
  }
  return a;
}

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) {
    const err = String(e.stderr || e.message);
    if (/release not found|Not Found/i.test(err)) return null;
    fail(`gh ${args.join(' ')} falhou: ${err.trim()}`);
  }
}

function sync(product, tag) {
  const m = PRODUCTS[product].prefix.exec(tag);
  if (!m) fail(`tag "${tag}" não tem o formato ${product}-vX.Y.Z`);
  const version = m[1];
  const empty = { tag, version, published: false, publishedAt: null, assets: {} };
  const raw = gh(['release', 'view', tag, '-R', GH_REPO, '--json', 'tagName,isDraft,publishedAt,assets']);
  if (raw === null) { console.log(`${product}: ${tag} não existe no GitHub → em breve`); return empty; }
  const rel = JSON.parse(raw);
  if (rel.isDraft) { console.log(`${product}: ${tag} é rascunho (links não são públicos) → em breve`); return empty; }
  if (rel.tagName !== tag) fail(`${product}: o GitHub devolveu a tag ${rel.tagName}, esperado ${tag}`);

  const want = PRODUCTS[product].names(version);
  const assets = {};
  const base = `${REPO}/releases/download/${tag}/`;
  for (const a of rel.assets) {
    const id = Object.keys(want).find(k => want[k].test(a.name));
    if (!id) continue;
    if (assets[id]) fail(`${product}: dois arquivos para "${id}" (${assets[id].name} e ${a.name})`);
    if (a.state !== 'uploaded') fail(`${product}: ${a.name} ainda não terminou de subir (state=${a.state})`);
    const dm = /^sha256:([0-9a-f]{64})$/.exec(a.digest ?? '');
    if (!dm) fail(`${product}: ${a.name} sem digest sha256 válido (${a.digest})`);
    if (!Number.isInteger(a.size) || a.size <= 0) fail(`${product}: ${a.name} com tamanho inválido (${a.size})`);
    if (a.url !== base + encodeURIComponent(a.name) && a.url !== base + a.name) fail(`${product}: URL inesperada para ${a.name}: ${a.url}`);
    assets[id] = { name: a.name, url: a.url, size: a.size, sha256: dm[1] };
  }
  const files = Object.keys(assets).filter(k => k !== 'sums' && k !== 'sig');
  if (!files.length) fail(`${product}: ${tag} está publicado mas não tem nenhum arquivo reconhecido (${rel.assets.map(a => a.name).join(', ') || 'nenhum'})`);
  const missing = Object.keys(want).filter(k => !assets[k] && k !== 'sig');
  if (missing.length) console.warn(`${product}: aviso, sem ${missing.join(', ')} (o site omite esses itens)`);

  // Confere contra o SHA256SUMS.txt do próprio release, se houver.
  if (assets.sums) {
    const txt = gh(['release', 'download', tag, '-R', GH_REPO, '-p', SUMS, '-O', '-']) ?? '';
    const listed = new Map(txt.split('\n').map(l => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim())).filter(Boolean).map(x => [x[2], x[1]]));
    for (const id of files) {
      const a = assets[id];
      const s = listed.get(a.name);
      if (!s) console.warn(`${product}: aviso, ${a.name} não está no ${SUMS}`);
      else if (s !== a.sha256) fail(`${product}: ${a.name} tem digest ${a.sha256} no GitHub e ${s} no ${SUMS}`);
    }
  }
  if (!rel.publishedAt) fail(`${product}: ${tag} sem publishedAt`);
  console.log(`${product}: ${tag} publicado em ${rel.publishedAt} · ${files.length} arquivo(s)${assets.sums ? ' · conferido com ' + SUMS : ''}`);
  return { tag, version, published: true, publishedAt: rel.publishedAt, assets };
}

const args = parseArgs(process.argv.slice(2));
const cur = JSON.parse(readFileSync(OUT, 'utf8'));
const next = { $comment: cur.$comment };
for (const p of Object.keys(PRODUCTS)) {
  const tag = args.tags[p] ?? cur[p]?.tag;
  if (!tag) fail(`sem tag para ${p} (passe --${p} <tag>)`);
  next[p] = sync(p, tag);
}
if (next.android.published) console.log(`android: confira o certificado do APK novo (apksigner verify --print-certs) = ANDROID_CERT_SHA256 em src/lib/androidRelease.ts`);
const out = JSON.stringify(next, null, 2) + '\n';
if (args.dry) { process.stdout.write(out); process.exit(0); }
writeFileSync(OUT + '.tmp', out);
renameSync(OUT + '.tmp', OUT);
console.log(`gravado ${OUT}. Rode npm run build para conferir.`);
