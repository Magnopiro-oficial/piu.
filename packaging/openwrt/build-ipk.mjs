#!/usr/bin/env node
// Gera o pacote do piu-node para OpenWrt (opkg) sem o SDK: piu-node_<versão>-<release>_all.ipk em dist/.
//
//   npm run deps && npm run build:panel   (uma vez: dependências do piu-node e build do painel)
//   npm ci && npm run build               (bundle + .ipk)
//   npm run stage                         (só monta build/root/, para o Makefile do feed/SDK)
//
// O piu-node vira um único arquivo ESM (esbuild), sem node_modules nem addons nativos: o mesmo
// .ipk serve para qualquer arquitetura em que o pacote `node` do OpenWrt exista (Architecture: all).
// Reprodutível: com o mesmo código e o mesmo SOURCE_DATE_EPOCH, o .ipk sai igual byte a byte.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildIpk } from './lib/ipk.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const piuNode = join(repo, 'apps', 'piu-node');
const panelDist = process.env.PIU_PANEL_DIST ?? join(repo, 'apps', 'provider-panel', 'dist');
// PIU_IPK_BUILD e PIU_IPK_OUT mudam as pastas de trabalho e de saída (os testes usam pastas temporárias).
const work = process.env.PIU_IPK_BUILD ?? join(here, 'build');
const stage = join(work, 'root');
const outDir = process.env.PIU_IPK_OUT ?? join(here, 'dist');
const stageOnly = process.argv.includes('--stage-only');

const die = msg => {
  console.error(`build-ipk: ${msg}`);
  process.exit(1);
};

// Versão: a do piu-node; release: a do Makefile (PKG_RELEASE), para o .ipk e o pacote do SDK baterem.
const version = JSON.parse(readFileSync(join(piuNode, 'package.json'), 'utf8')).version;
const makefile = readFileSync(join(here, 'Makefile'), 'utf8');
const release = /^PKG_RELEASE:=(\S+)$/m.exec(makefile)?.[1] ?? die('PKG_RELEASE não encontrado no Makefile');
const pkgVersion = `${version}-${release}`;

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

if (!existsSync(join(piuNode, 'node_modules'))) die('faltam as dependências do piu-node: rode `npm run deps`.');
if (!existsSync(join(panelDist, 'index.html'))) die(`painel não encontrado em ${panelDist}: rode \`npm run build:panel\`.`);

// 1. Bundle do piu-node: um único .mjs. ESM porque o main.ts usa top-level await; o `require`
// criado no banner atende as dependências CommonJS (fastify, pino) dentro do bundle.
rmSync(work, { recursive: true, force: true });
const libDir = join(stage, 'usr', 'lib', 'piu-node');
await build({
  entryPoints: [join(piuNode, 'src', 'main.ts')],
  outfile: join(libDir, 'piu-node.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: "import { createRequire as __piuCreateRequire } from 'node:module';\nconst require = __piuCreateRequire(import.meta.url);" },
  // Dependências opcionais do pino (logger do Fastify) que o nó não usa (transports).
  logOverride: { 'require-resolve-not-external': 'silent' },
  // Avisos de licença das dependências num arquivo ao lado (piu-node.mjs.LEGAL.txt).
  legalComments: 'external',
  sourcemap: false,
  minify: false,
  logLevel: 'warning',
});

// 2. Painel (somente leitura). `_headers` é configuração de hospedagem estática, não é servido pelo nó.
const panelDir = join(stage, 'usr', 'share', 'piu-node', 'panel');
cpSync(panelDist, panelDir, { recursive: true, filter: src => !src.endsWith(`${sep}_headers`) });

// 3. Init procd, config UCI e lista de preservação no sysupgrade.
const put = (path, src) => {
  mkdirSync(dirname(join(stage, path)), { recursive: true });
  cpSync(join(here, 'files', src), join(stage, path));
};
put('etc/init.d/piu-node', 'piu-node.init');
put('etc/config/piu-node', 'piu-node.config');
put('lib/upgrade/keep.d/piu-node', 'piu-node.keep');

if (stageOnly) {
  console.log(`build-ipk: conteúdo do pacote em ${relative(process.cwd(), stage) || '.'}`);
  process.exit(0);
}

// 4. Permissões vêm daqui, não do disco (umask e checkout variam): executáveis 0755, config 0600
// (como o INSTALL_CONF do OpenWrt), o resto 0644.
const MODES = { '/etc/init.d/piu-node': 0o755, '/etc/config/piu-node': 0o600 };
const files = {};
const walk = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) {
      const path = '/' + relative(stage, full).split(sep).join('/');
      files[path] = { data: readFileSync(full), mode: MODES[path] ?? 0o644 };
    } else die(`tipo de arquivo não suportado no pacote: ${full}`);
  }
};
walk(stage);

// Scripts do opkg: os mesmos que o OpenWrt gera para pacotes com init script (include/package-pack.mk).
// default_postinst cria o usuário de Require-User, habilita e inicia o serviço; default_prerm para e desabilita.
const postinst = `#!/bin/sh
[ "\${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s \${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. \${IPKG_INSTROOT}/lib/functions.sh
default_postinst $0 $@
`;
const prerm = `#!/bin/sh
[ -s \${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. \${IPKG_INSTROOT}/lib/functions.sh
default_prerm $0 $@
`;

// Campos do control na ordem do package-pack.mk. Installed-Size é calculado em buildIpk.
const control = `Package: piu-node
Version: ${pkgVersion}
Depends: node
Source: packaging/openwrt
SourceName: piu-node
License: AGPL-3.0-only
Section: net
Require-User: piu-node:piu-node:dialout=20
SourceDateEpoch: ${mtime}
Maintainer: Lunes Network
Architecture: all
Description: Nó de referência do Piu: painel do provider por HTTPS (porta 8420) e
 retransmissão de envelopes LNNP v1 na rede local (TCP 8422, UDP 8423).
 Requer Node.js 22 ou mais novo. Configuração em /etc/config/piu-node.
`;

const { ipk, installedSize } = buildIpk({
  files,
  control,
  conffiles: ['/etc/config/piu-node'],
  scripts: { postinst, prerm },
  mtime,
});
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `piu-node_${pkgVersion}_all.ipk`);
writeFileSync(out, ipk);
const sha = createHash('sha256').update(ipk).digest('hex');
console.log(`build-ipk: ${relative(process.cwd(), out)}`);
console.log(`  ${(ipk.length / 1024).toFixed(0)} KiB comprimido, ${(installedSize / 1024).toFixed(0)} KiB instalado, ${Object.keys(files).length} arquivos`);
console.log(`  sha256 ${sha}`);
