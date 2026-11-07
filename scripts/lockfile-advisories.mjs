// Confere os package-lock.json do monorepo contra os alertas de segurança já corrigidos aqui, para que uma
// atualização de dependência não traga de volta uma versão vulnerável. A correção de cada alerta está nos
// `overrides` do package.json do app (npm). Alerta novo: acrescente em ADVISORIES e corrija o lockfile.
// Uso: node scripts/lockfile-advisories.mjs            → confere todos os lockfiles de LOCKFILES
//      node scripts/lockfile-advisories.mjs <lockfile>  → só esse
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Faixa vulnerável [desde, corrigido): `from` incluso, `fixed` excluído (como no aviso do GitHub). */
export const ADVISORIES = [
  { id: 'GHSA-g3hv-75wg-m249', name: 'minimatch', from: '7.0.0', fixed: '11.0.1', summary: 'DoS por amplificação de globparts' },
  { id: 'GHSA-3g3m-2fjr-6pw4', name: 'glob', from: '9.0.0', fixed: '14.0.2', summary: 'AbortSignal não interrompe a varredura depois do tempo limite' },
];

export const LOCKFILES = [
  'apps/mobile', 'apps/desktop', 'apps/provider-desktop', 'apps/provider-panel', 'apps/piu-node',
  'apps/settlement', 'apps/site', 'packaging/openwrt', // packaging/linux não tem dependências npm
].map(d => `${d}/package-lock.json`);

/** Só X.Y.Z (pré-lançamento conta como a própria versão: o conservador para uma faixa vulnerável). */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`versão inválida: ${a} / ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const isVulnerable = (version, adv) =>
  parseVersion(version) !== null && compareVersions(version, adv.from) >= 0 && compareVersions(version, adv.fixed) < 0;

/** Lista { path, name, version, advisory } de cada pacote vulnerável instalado pelo lockfile (v2/v3). */
export function findVulnerable(lock, advisories = ADVISORIES) {
  const found = [];
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path) continue; // raiz = o próprio app
    const name = pkg.name ?? path.split('node_modules/').pop();
    for (const adv of advisories) {
      if (adv.name === name && isVulnerable(pkg.version, adv)) found.push({ path, name, version: pkg.version, advisory: adv.id });
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : LOCKFILES.map(f => join(ROOT, f));
  let bad = 0;
  for (const file of files) {
    if (!existsSync(file)) { console.error(`Lockfile não encontrado: ${file}`); bad++; continue; }
    const hits = findVulnerable(JSON.parse(readFileSync(file, 'utf8')));
    for (const h of hits) console.error(`${relative(ROOT, file)}: ${h.path} ${h.version} (${h.advisory})`);
    bad += hits.length;
  }
  if (bad) process.exit(1);
  console.log(`Sem versões vulneráveis conhecidas em ${files.length} lockfile(s).`);
}
