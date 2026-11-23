#!/usr/bin/env node
// Monta o repositório apt do Piu (servido pelo GitHub Pages em <site>/apt/) a partir dos releases PUBLICADOS:
// o .deb mais recente do Piu Desktop (pacote "piu"), do Piu Provider ("piu-provider-desktop") e do Piu Node
// ("piu-node"). Cada .deb é conferido com o SHA256SUMS.txt do próprio release e com o digest do GitHub antes
// de entrar no repositório. Depois: apt-ftparchive (suite stable, componente main, amd64 e all) e assinatura
// de Release/InRelease com a chave do secret APT_GPG_PRIVATE_KEY (senha opcional em APT_GPG_PASSPHRASE).
//
//   node scripts/apt-repo.mjs --out <pasta>             # precisa de apt-ftparchive, gpg e gpgv no PATH
//   node scripts/apt-repo.mjs --out <pasta> --unsigned  # só para teste local: sem assinatura
//   node scripts/apt-repo.mjs --out <pasta> --releases <arquivo.json>   # lista de releases já baixada
//
// Variáveis: APT_GPG_PRIVATE_KEY (chave privada em ASCII armor), APT_GPG_PASSPHRASE (opcional),
// GH_TOKEN ou GITHUB_TOKEN (opcional, só para a API do GitHub; nunca vai para os downloads).
// Qualquer divergência (hash, nome, release sem SHA256SUMS.txt, secret com mais de uma chave) aborta com erro: o workflow então não publica e o repositório anterior continua no ar.
// Passo a passo para o dono: docs/distribuicao/linux-apt-appimagehub.md.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { assetId, PRODUCTS, SUMS, tagVersion } from './release-products.mjs';

const GH_REPO = 'Magnopiro-oficial/piu.';
const DOWNLOAD_BASE = `https://github.com/${GH_REPO}/releases/download/`;
export const SUITE = 'stable';
export const COMPONENT = 'main';
export const ARCHES = ['amd64', 'all'];
/** Nome do arquivo da chave pública publicado em <site>/apt/ (binário, para /etc/apt/keyrings). */
export const KEYRING = 'piu-archive-keyring.gpg';
/** Pages aceita até 1 GB por site; acima disto, avisa. */
const SIZE_WARN = 700 * 1024 * 1024;

/** Produto → id do .deb em release-products.mjs. */
export const APT_PRODUCTS = { desktop: 'linux-deb', provider: 'linux-deb', node: 'deb' };

const cmpVersion = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Release mais novo (maior versão) do produto que está publicado, não é pré-release e tem o .deb. */
export function pickRelease(releases, product) {
  const debId = APT_PRODUCTS[product];
  if (!debId) throw new Error(`produto sem .deb no apt: ${product}`);
  const found = [];
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const version = tagVersion(product, r.tag_name);
    if (!version) continue;
    const deb = r.assets.find(a => assetId(product, version, a.name) === debId);
    if (deb) found.push({ r, version, deb });
  }
  if (!found.length) throw new Error(`${product}: nenhum release publicado com .deb`);
  found.sort((a, b) => cmpVersion(b.version, a.version));
  const { r, version, deb } = found[0];
  const sums = r.assets.find(a => a.name === SUMS);
  if (!sums) throw new Error(`${product}: ${r.tag_name} não tem ${SUMS}`);
  for (const a of [deb, sums]) if (a.state && a.state !== 'uploaded') throw new Error(`${product}: ${a.name} ainda não terminou de subir (state=${a.state})`);
  return { product, tag: r.tag_name, version, deb, sums };
}

/** SHA256SUMS.txt → Map(nome → sha256). Linha torta ou nome repetido é erro. */
export function parseSums(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l);
    if (!m) throw new Error(`${SUMS}: linha inválida: ${l}`);
    if (out.has(m[2])) throw new Error(`${SUMS}: nome repetido: ${m[2]}`);
    out.set(m[2], m[1]);
  }
  return out;
}

/** O hash do arquivo baixado precisa bater com o SHA256SUMS.txt e, se o GitHub informar, com o digest dele. */
export function verifyDeb(asset, sha256, sums) {
  const listed = sums.get(asset.name);
  if (!listed) throw new Error(`${asset.name} não está no ${SUMS}`);
  if (listed !== sha256) throw new Error(`${asset.name}: SHA-256 ${sha256} não bate com o ${SUMS} (${listed})`);
  const dm = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '');
  if (asset.digest && !dm) throw new Error(`${asset.name}: digest do GitHub em formato desconhecido (${asset.digest})`);
  if (dm && dm[1] !== sha256) throw new Error(`${asset.name}: SHA-256 ${sha256} não bate com o digest do GitHub (${dm[1]})`);
}

export function checkFingerprint(fpr) {
  const f = String(fpr ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(f)) throw new Error(`impressão digital inválida: "${fpr}"`);
  return f;
}

// ---------- daqui para baixo: rede, disco, apt-ftparchive e gpg ----------

const log = msg => console.log(`apt-repo: ${msg}`);

function parseArgs(argv) {
  const a = { out: '', unsigned: false, releases: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i] ?? '';
    else if (k === '--unsigned') a.unsigned = true;
    else if (k === '--releases') a.releases = argv[++i] ?? '';
    else throw new Error(`argumento desconhecido: ${k}`);
  }
  if (!a.out) throw new Error('use --out <pasta>');
  return a;
}

async function listReleases() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`API do GitHub respondeu ${res.status} ao listar os releases`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** Só baixa do próprio repositório, sem token (o GitHub redireciona para outro domínio). */
function assetUrl(rel, asset) {
  const want = DOWNLOAD_BASE + encodeURIComponent(rel.tag) + '/';
  const u = asset.browser_download_url;
  if (u !== want + encodeURIComponent(asset.name) && u !== want + asset.name) throw new Error(`URL inesperada para ${asset.name}: ${u}`);
  return u;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download de ${url} respondeu ${res.status}`);
  const hash = createHash('sha256');
  const src = Readable.fromWeb(res.body);
  src.on('data', c => hash.update(c));
  await pipeline(src, createWriteStream(dest));
  return hash.digest('hex');
}

async function downloadText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download de ${url} respondeu ${res.status}`);
  return res.text();
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], ...opts });

function aptftparchive(out) {
  const conf = join(out, '.ftparchive.conf');
  const relConf = join(out, '.release.conf');
  for (const arch of ARCHES) mkdirSync(join(out, 'dists', SUITE, COMPONENT, `binary-${arch}`), { recursive: true });
  writeFileSync(conf, [
    `Dir { ArchiveDir "${out}"; CacheDir "${out}/.cache"; };`,
    'Default { Packages::Compress ". gzip xz"; FileMode 0644; };',
    `TreeDefault { Directory "pool/${COMPONENT}"; };`,
    `Tree "dists/${SUITE}" { Sections "${COMPONENT}"; Architectures "${ARCHES.join(' ')}"; };`,
    '',
  ].join('\n'));
  mkdirSync(join(out, '.cache'), { recursive: true });
  run('apt-ftparchive', ['generate', conf], { cwd: out, stdio: ['ignore', 'inherit', 'inherit'] });
  writeFileSync(relConf, [
    'APT::FTPArchive::Release {',
    '  Origin "Piu"; Label "Piu";',
    `  Suite "${SUITE}"; Codename "${SUITE}";`,
    `  Architectures "${ARCHES.join(' ')}"; Components "${COMPONENT}";`,
    '  Description "Piu: mensageiro descentralizado (Desktop, Provider e Node)";',
    '};',
    '',
  ].join('\n'));
  const release = run('apt-ftparchive', ['-c', relConf, 'release', join('dists', SUITE)], { cwd: out });
  writeFileSync(join(out, 'dists', SUITE, 'Release'), release);
  rmSync(conf); rmSync(relConf); rmSync(join(out, '.cache'), { recursive: true, force: true });
}

function sign(out) {
  const key = process.env.APT_GPG_PRIVATE_KEY ?? '';
  if (!key.includes('PRIVATE KEY BLOCK')) throw new Error('APT_GPG_PRIVATE_KEY vazio ou não é uma chave privada em ASCII armor');
  const pass = process.env.APT_GPG_PASSPHRASE ?? '';
  const home = mkdtempSync(join(tmpdir(), 'piu-apt-gnupg-'));
  const env = { ...process.env, GNUPGHOME: home };
  delete env.APT_GPG_PRIVATE_KEY; delete env.APT_GPG_PASSPHRASE;
  const gpg = (args, input) => run('gpg', ['--batch', '--no-tty', '--quiet', ...args], { env, input });
  try {
    // A chave entra pelo stdin (nunca vai para a linha de comando); fica só no GNUPGHOME temporário.
    gpg(['--import'], key);
    const fprs = gpg(['--list-secret-keys', '--with-colons']).toString().split('\n')
      .filter((l, i, arr) => l.startsWith('fpr:') && arr[i - 1]?.startsWith('sec:')).map(l => l.split(':')[9]);
    if (fprs.length !== 1) throw new Error(`o secret deve ter exatamente uma chave primária (achei ${fprs.length})`);
    const fpr = checkFingerprint(fprs[0]);
    const dist = join(out, 'dists', SUITE);
    const signArgs = ['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', fpr, '--digest-algo', 'SHA512', '--yes'];
    gpg([...signArgs, '--clearsign', '--output', join(dist, 'InRelease'), join(dist, 'Release')], pass);
    gpg([...signArgs, '--armor', '--detach-sign', '--output', join(dist, 'Release.gpg'), join(dist, 'Release')], pass);
    const pub = gpg(['--export', fpr]);
    if (!pub.length) throw new Error('não consegui exportar a chave pública');
    writeFileSync(join(out, KEYRING), pub);
    writeFileSync(join(out, KEYRING.replace(/\.gpg$/, '.asc')), gpg(['--armor', '--export', fpr]));
    writeFileSync(join(out, 'FINGERPRINT'), fpr + '\n');
    // Confere as duas assinaturas só com a chave pública publicada, como o apt fará.
    run('gpgv', ['--keyring', join(out, KEYRING), join(dist, 'InRelease')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    run('gpgv', ['--keyring', join(out, KEYRING), join(dist, 'Release.gpg'), join(dist, 'Release')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    log(`Release e InRelease assinados pela chave ${fpr} e conferidos com gpgv`);
    return fpr;
  } finally {
    try { execFileSync('gpgconf', ['--kill', 'all'], { env, stdio: 'ignore' }); } catch { /* sem agente */ }
    rmSync(home, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out;
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} já existe e não está vazia`);
  const releases = args.releases ? JSON.parse(readFileSync(args.releases, 'utf8')) : await listReleases();
  const pool = join(out, 'pool', COMPONENT);
  mkdirSync(pool, { recursive: true });
  let total = 0;
  for (const product of Object.keys(APT_PRODUCTS)) {
    const p = pickRelease(releases, product);
    const sums = parseSums(await downloadText(assetUrl(p, p.sums)));
    const dest = join(pool, p.deb.name);
    const sha = await download(assetUrl(p, p.deb), dest);
    verifyDeb(p.deb, sha, sums);
    const size = statSync(dest).size;
    if (Number.isInteger(p.deb.size) && p.deb.size !== size) throw new Error(`${p.deb.name}: tamanho ${size}, o GitHub diz ${p.deb.size}`);
    total += size;
    log(`${product}: ${p.tag} · ${p.deb.name} · ${(size / 1048576).toFixed(1)} MB · SHA-256 ${sha} conferido com ${SUMS}`);
  }
  if (total > SIZE_WARN) console.warn(`::warning title=apt::os .deb somam ${(total / 1048576).toFixed(0)} MB; o GitHub Pages aceita até 1 GB por site`);
  aptftparchive(out);
  if (args.unsigned) log('--unsigned: Release sem assinatura (só para teste local)');
  else sign(out);
  log(`pronto em ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`apt-repo: ${e.message}`); process.exit(1); });
}
