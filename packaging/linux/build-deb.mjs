#!/usr/bin/env node
// Gera o pacote do piu-node para Debian, Ubuntu e Raspberry Pi OS: piu-node_<versão>-<revisão>_all.deb em dist/.
//
//   npm run deps && npm run build:panel   (uma vez: dependências do piu-node, do painel e do empacotador do OpenWrt)
//   npm run build                         (bundle + .deb)
//
// O conteúdo do programa é o MESMO do .ipk: `packaging/openwrt/build-ipk.mjs --stage-only` gera o bundle
// único em JS (esbuild, sem node_modules nem addon nativo) e copia o painel. Por isso Architecture: all,
// com Depends: nodejs (>= 20.19): o Node.js do sistema (Debian 13, NodeSource) é que é por arquitetura.
// Aqui entram só as peças do Linux: unidade systemd endurecida, sysusers.d, /etc/default/piu-node,
// o lançador e os scripts do dpkg. Sem dpkg-deb: o .deb é montado por lib/deb.mjs (roda no macOS também).
// Reprodutível: com o mesmo código e o mesmo SOURCE_DATE_EPOCH, o .deb sai igual byte a byte.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeb } from './lib/deb.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const openwrt = join(repo, 'packaging', 'openwrt');
// PIU_DEB_BUILD e PIU_DEB_OUT mudam as pastas de trabalho e de saída (os testes usam pastas temporárias).
const work = process.env.PIU_DEB_BUILD ?? join(here, 'build');
const outDir = process.env.PIU_DEB_OUT ?? join(here, 'dist');

const die = msg => {
  console.error(`build-deb: ${msg}`);
  process.exit(1);
};

const version = JSON.parse(readFileSync(join(repo, 'apps', 'piu-node', 'package.json'), 'utf8')).version;
const revision = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).debRevision;
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`versão do piu-node inválida: ${version}`);
if (!/^\d+$/.test(String(revision))) die(`debRevision inválida em package.json: ${revision}`);
const debVersion = `${version}-${revision}`;

function sourceDateEpoch() {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH);
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return 0;
  }
}
const mtime = sourceDateEpoch();
if (!Number.isInteger(mtime) || mtime < 0) die('SOURCE_DATE_EPOCH inválido');
if (!existsSync(join(openwrt, 'node_modules', 'esbuild'))) die('falta o empacotador do OpenWrt (esbuild): rode `npm run deps`.');

// 1. Bundle e painel: o mesmo conteúdo do .ipk, montado pelo build-ipk.mjs numa pasta nossa.
rmSync(work, { recursive: true, force: true });
const ipkWork = join(work, 'openwrt');
execFileSync(process.execPath, [join(openwrt, 'build-ipk.mjs'), '--stage-only'], {
  cwd: openwrt, env: { ...process.env, PIU_IPK_BUILD: ipkWork, SOURCE_DATE_EPOCH: String(mtime) }, stdio: ['ignore', 'ignore', 'inherit'],
});
const staged = join(ipkWork, 'root');

// 2. Arquivos do pacote. Permissões vêm daqui, não do disco (umask e checkout variam).
const files = {};
const add = (path, data, mode = 0o644) => { files[path] = { data, mode }; };
const walk = (dir, prefix) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, `${prefix}/${e.name}`);
    else if (e.isFile()) add(`${prefix}/${e.name}`, readFileSync(full));
    else die(`tipo de arquivo não suportado no pacote: ${full}`);
  }
};
walk(join(staged, 'usr', 'lib', 'piu-node'), '/usr/lib/piu-node');
walk(join(staged, 'usr', 'share', 'piu-node'), '/usr/share/piu-node');
const file = name => readFileSync(join(here, 'files', name));
add('/usr/lib/piu-node/piu-node-start', file('piu-node-start'), 0o755);
add('/usr/lib/systemd/system/piu-node.service', file('piu-node.service'));
add('/usr/lib/sysusers.d/piu-node.conf', file('piu-node.sysusers'));
add('/etc/default/piu-node', file('piu-node.default'));
add('/usr/share/doc/piu-node/copyright', `Pacote piu-node (Piu, Lunes Network)
Código: https://github.com/Magnopiro-oficial/piu.
Licença: AGPL-3.0-only (texto completo abaixo).
Avisos de licença das bibliotecas incluídas no bundle: /usr/lib/piu-node/piu-node.mjs.LEGAL.txt

${readFileSync(join(repo, 'LICENSE'), 'utf8')}`);
if (!files['/usr/lib/piu-node/piu-node.mjs']) die('bundle não encontrado no stage do OpenWrt');
if (!files['/usr/share/piu-node/panel/index.html']) die('painel não encontrado no stage do OpenWrt');

// 3. control (deb-control(5)). Installed-Size é calculado em buildDeb.
const control = `Package: piu-node
Version: ${debVersion}
Architecture: all
Maintainer: Lunes Network
Depends: nodejs (>= 20.19)
Section: net
Priority: optional
Homepage: https://github.com/Magnopiro-oficial/piu.
Description: Nó de referência do Piu (painel do provider e retransmissão LNNP)
 Painel do provider por HTTPS (porta 8420) e retransmissão de envelopes
 LNNP v1 na rede local (TCP 8422, UDP 8423), como serviço systemd com
 usuário próprio. Requer Node.js 20.19 ou mais novo (Debian 13, NodeSource).
 Configuração em /etc/default/piu-node; dados em /var/lib/piu-node.
`;

const { deb, installedKiB } = buildDeb({
  files,
  control,
  conffiles: ['/etc/default/piu-node'],
  scripts: { postinst: file('postinst'), prerm: file('prerm'), postrm: file('postrm') },
  mtime,
});
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `piu-node_${debVersion}_all.deb`);
writeFileSync(out, deb);
console.log(`build-deb: ${relative(process.cwd(), out) || out}`);
console.log(`  ${(deb.length / 1024).toFixed(0)} KiB comprimido, ${installedKiB} KiB instalado, ${Object.keys(files).length} arquivos`);
console.log(`  sha256 ${createHash('sha256').update(deb).digest('hex')}`);
