// Testes do pacote OpenWrt: gera o .ipk, abre com o GNU tar (leitor independente do nosso gerador),
// confere formato, control, permissões e conffiles, valida o init script e o mapeamento UCI -> ambiente,
// e sobe o bundle empacotado com o Node local para conferir HTTPS, painel e API.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const repo = join(pkgDir, '..', '..');
const EPOCH = '1767225600'; // 2026-01-01T00:00:00Z: fixo, para conferir a reprodutibilidade
const piuVersion = JSON.parse(readFileSync(join(repo, 'apps', 'piu-node', 'package.json'), 'utf8')).version;
const makefile = readFileSync(join(pkgDir, 'Makefile'), 'utf8');
const mkVar = name => new RegExp(`^${name}:=(.*)$`, 'm').exec(makefile)?.[1]?.trim();
const ipkName = `piu-node_${piuVersion}-${mkVar('PKG_RELEASE')}_all.ipk`;

const tmp = mkdtempSync(join(tmpdir(), 'piu-ipk-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Gera numa pasta temporária, para não trocar o .ipk de dist/ (o que a CI publica).
const dist = join(tmp, 'dist');
const build = () => {
  const env = { ...process.env, SOURCE_DATE_EPOCH: EPOCH, PIU_IPK_BUILD: join(tmp, 'build'), PIU_IPK_OUT: dist };
  execFileSync(process.execPath, [join(pkgDir, 'build-ipk.mjs')], { cwd: pkgDir, env, stdio: 'pipe' });
  return readFileSync(join(dist, ipkName));
};
const sha = buf => createHash('sha256').update(buf).digest('hex');
const tarList = (file, cwd) => execFileSync('tar', ['--numeric-owner', '-tvzf', file], { cwd, encoding: 'utf8' }).trim().split('\n');
const tarNames = (file, cwd) => execFileSync('tar', ['-tzf', file], { cwd, encoding: 'utf8' }).trim().split('\n');
const sh = (args, opts = {}) => execFileSync('sh', args, { encoding: 'utf8', ...opts });

let ipk;
const outer = join(tmp, 'outer');
const control = join(tmp, 'control');
const root = join(tmp, 'root');

before(() => {
  ipk = build();
  for (const d of [outer, control, root]) mkdirSync(d);
  execFileSync('tar', ['-xzf', join(dist, ipkName)], { cwd: outer });
  execFileSync('tar', ['-xzf', join(outer, 'data.tar.gz')], { cwd: root });
  execFileSync('tar', ['-xzf', join(outer, 'control.tar.gz')], { cwd: control });
});

describe('formato do .ipk (opkg do OpenWrt 23.05/24.10)', () => {
  test('é tar.gz com debian-binary, data.tar.gz e control.tar.gz, nessa ordem', () => {
    assert.deepEqual([...ipk.subarray(0, 2)], [0x1f, 0x8b], 'gzip, não ar (!<arch>)');
    assert.deepEqual(tarNames(join(dist, ipkName)), ['./debian-binary', './data.tar.gz', './control.tar.gz']);
    assert.equal(readFileSync(join(outer, 'debian-binary'), 'utf8'), '2.0\n');
    for (const f of ['data.tar.gz', 'control.tar.gz']) assert.deepEqual([...readFileSync(join(outer, f)).subarray(0, 2)], [0x1f, 0x8b], f);
  });

  test('reprodutível: o mesmo código gera o mesmo .ipk, byte a byte', () => {
    assert.equal(sha(build()), sha(ipk));
  });

  // Lê os cabeçalhos ustar direto dos bytes (uid, gid, mtime em octal): não depende do fuso horário da
  // máquina nem do formato de listagem do tar (GNU mostra 2026-01-01, o bsdtar do macOS "Dec 31 2025"
  // em UTC−3).
  test('tudo pertence a 0:0 e tem a data de SOURCE_DATE_EPOCH', () => {
    const oct = (b, off, len) => parseInt(b.subarray(off, off + len).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    for (const f of ['data.tar.gz', 'control.tar.gz']) {
      const tar = gunzipSync(readFileSync(join(outer, f)));
      let n = 0;
      for (let off = 0; off + 512 <= tar.length;) {
        const h = tar.subarray(off, off + 512);
        if (h.every(x => x === 0)) break;
        const name = h.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
        assert.equal(oct(h, 108, 8), 0, `${f}:${name} uid`);
        assert.equal(oct(h, 116, 8), 0, `${f}:${name} gid`);
        assert.equal(oct(h, 136, 12), Number(EPOCH), `${f}:${name} mtime`);
        const size = oct(h, 124, 12);
        off += 512 + Math.ceil(size / 512) * 512;
        n++;
      }
      assert.ok(n > 0, f);
      assert.equal(n, tarList(join(outer, f)).length, `${f}: todas as entradas conferidas`);
    }
  });
});

describe('control', () => {
  const fields = () => {
    const text = readFileSync(join(control, 'control'), 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      if (!line || line.startsWith(' ')) continue;
      const [k, ...v] = line.split(':');
      assert.ok(!(k in out), `campo repetido: ${k}`);
      out[k] = v.join(':').trim();
    }
    return { text, f: out };
  };

  test('campos obrigatórios e coerentes com o Makefile', () => {
    const { f } = fields();
    assert.equal(f.Package, 'piu-node');
    assert.equal(f.Package, mkVar('PKG_NAME'));
    assert.equal(f.Version, `${piuVersion}-${mkVar('PKG_RELEASE')}`);
    assert.equal(mkVar('PKG_VERSION'), piuVersion, 'PKG_VERSION do Makefile = versão do apps/piu-node/package.json');
    assert.equal(f.Depends, 'node');
    assert.match(makefile, /DEPENDS:=\+node$/m);
    assert.equal(f.Architecture, 'all');
    assert.match(makefile, /PKGARCH:=all$/m);
    assert.equal(f.License, 'AGPL-3.0-only');
    assert.equal(mkVar('PKG_LICENSE'), 'AGPL-3.0-only');
    assert.equal(f.Maintainer, mkVar('PKG_MAINTAINER'));
    assert.doesNotMatch(f.Maintainer, /@/, 'sem e-mail inventado');
    assert.equal(f['Require-User'], 'piu-node:piu-node:dialout=20');
    assert.match(makefile, /USERID:=piu-node:piu-node:dialout=20$/m);
    assert.equal(f.SourceDateEpoch, EPOCH);
    assert.ok(f.Description.length > 10);
  });

  test('Installed-Size é o tamanho do data.tar descomprimido (como no ipkg-build)', () => {
    const { f } = fields();
    const size = execFileSync('sh', ['-c', 'gzip -dc data.tar.gz | wc -c'], { cwd: outer, encoding: 'utf8' }).trim();
    assert.equal(f['Installed-Size'], size);
  });

  test('conffiles lista só a config UCI, que existe no pacote', () => {
    assert.equal(readFileSync(join(control, 'conffiles'), 'utf8'), '/etc/config/piu-node\n');
    assert.ok(existsSync(join(root, 'etc', 'config', 'piu-node')));
    assert.match(makefile, /define Package\/piu-node\/conffiles\n\/etc\/config\/piu-node\nendef/);
  });

  test('postinst e prerm: executáveis, sintaxe válida, helpers padrão do OpenWrt', () => {
    const modes = Object.fromEntries(tarList(join(outer, 'control.tar.gz')).map(l => [l.split(/\s+/).at(-1), l.split(/\s+/)[0]]));
    assert.equal(modes['./postinst'], '-rwxr-xr-x');
    assert.equal(modes['./prerm'], '-rwxr-xr-x');
    assert.equal(modes['./control'], '-rw-r--r--');
    const post = readFileSync(join(control, 'postinst'), 'utf8');
    const pre = readFileSync(join(control, 'prerm'), 'utf8');
    assert.match(post, /IPKG_NO_SCRIPT/);
    assert.match(post, /^default_postinst \$0 \$@$/m);
    assert.match(pre, /^default_prerm \$0 \$@$/m);
    sh(['-n', join(control, 'postinst')]);
    sh(['-n', join(control, 'prerm')]);
  });
});

describe('conteúdo', () => {
  const entries = () =>
    Object.fromEntries(tarList(join(outer, 'data.tar.gz')).map(l => {
      const parts = l.split(/\s+/);
      return [parts.at(-1), parts[0]];
    }));

  test('caminhos e permissões', () => {
    const e = entries();
    assert.equal(e['./etc/init.d/piu-node'], '-rwxr-xr-x');
    assert.equal(e['./etc/config/piu-node'], '-rw-------');
    assert.equal(e['./usr/lib/piu-node/piu-node.mjs'], '-rw-r--r--');
    assert.equal(e['./usr/share/piu-node/panel/index.html'], '-rw-r--r--');
    assert.equal(e['./lib/upgrade/keep.d/piu-node'], '-rw-r--r--');
    assert.equal(e['./usr/lib/piu-node/'], 'drwxr-xr-x');
    assert.equal(readFileSync(join(root, 'lib', 'upgrade', 'keep.d', 'piu-node'), 'utf8'), '/etc/piu-node/\n');
    for (const name of Object.keys(e)) {
      assert.ok(name.startsWith('./'), name);
      assert.doesNotMatch(name, /node_modules|\.node$|_headers$/, `não deveria estar no pacote: ${name}`);
    }
  });

  test('o painel empacotado é o build do provider-panel (sem _headers)', () => {
    const built = process.env.PIU_PANEL_DIST ?? join(repo, 'apps', 'provider-panel', 'dist');
    const panel = join(root, 'usr', 'share', 'piu-node', 'panel');
    assert.deepEqual(readFileSync(join(panel, 'index.html')), readFileSync(join(built, 'index.html')));
    assert.deepEqual(readdirSync(join(panel, 'assets')).sort(), readdirSync(join(built, 'assets')).sort());
    assert.ok(!existsSync(join(panel, '_headers')));
  });

  test('bundle único: nenhum import fora de node:*', () => {
    const src = readFileSync(join(root, 'usr', 'lib', 'piu-node', 'piu-node.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import\s.*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
    assert.ok(imports.length > 0);
    for (const i of imports) assert.match(i, /^node:/, `import externo no bundle: ${i}`);
    assert.doesNotMatch(src, /\.node['"]\)/, 'addon nativo');
  });
});

describe('init script procd e config UCI', () => {
  const init = () => join(root, 'etc', 'init.d', 'piu-node');
  const stub = join(here, 'openwrt-stub.sh');

  test('sintaxe sh válida e cabeçalho do rc.common', () => {
    sh(['-n', init()]);
    const text = readFileSync(init(), 'utf8');
    assert.match(text, /^#!\/bin\/sh \/etc\/rc.common\n/);
    assert.match(text, /^USE_PROCD=1$/m);
    assert.match(text, /^START=\d+$/m);
    sh(['-n', join(root, 'etc', 'config', 'piu-node')]); // a sintaxe UCI também é sh válido
  });

  /** Roda start_service com o stub e devolve as chamadas ao procd. */
  function startService({ config, nodeVersion = 'v22.4.0' }) {
    const dir = mkdtempSync(join(tmp, 'uci-'));
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', 'piu-node'), config);
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, `#!/bin/sh\necho ${nodeVersion}\n`);
    chmodSync(fakeNode, 0o755);
    const script = `. "${stub}"; . "${init()}"; NODE_BIN="${fakeNode}"; start_service; echo "rc=$?"`;
    const r = execFileSync('sh', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, UCI_CONFIG_DIR: join(dir, 'config') }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = r.trim().split('\n').map(l => l.split('\t'));
    const env = {};
    const params = {};
    for (const [what, type, ...args] of lines) {
      if ((what === 'set' || what === 'append') && type === 'env') {
        for (const kv of args) {
          const i = kv.indexOf('=');
          assert.ok(!(kv.slice(0, i) in env), `variável repetida: ${kv}`);
          env[kv.slice(0, i)] = kv.slice(i + 1);
        }
      } else if (what === 'set') params[type] = args;
    }
    return { env, params, rc: r.trim().split('\n').at(-1), out: r, dataDir: join(dir, 'data') };
  }

  const shipped = () => readFileSync(join(root, 'etc', 'config', 'piu-node'), 'utf8');
  const withData = (cfg, data) => cfg.replace("option data '/etc/piu-node'", `option data '${data}'`);

  test('config padrão: comando, usuário, respawn e variáveis de ambiente', () => {
    const data = join(tmp, 'data-padrao');
    const r = startService({ config: withData(shipped(), data) });
    assert.equal(r.rc, 'rc=0');
    assert.deepEqual(r.params.command, [r.params.command[0], '--max-old-space-size=48', '--max-semi-space-size=1', '/usr/lib/piu-node/piu-node.mjs']);
    assert.deepEqual(r.params.user, ['piu-node']);
    assert.deepEqual(r.params.respawn, []);
    assert.deepEqual(r.params.no_new_privs, ['1']);
    assert.deepEqual(r.params.stdout, ['1']);
    assert.deepEqual(r.params.file, ['/etc/config/piu-node']);
    assert.deepEqual(r.env, {
      PIU_NODE_DATA: data,
      PIU_NODE_PANEL: '/usr/share/piu-node/panel',
      PIU_NODE_HOSTS: 'piu-node.local,localhost,127.0.0.1,192.168.1.1',
      PIU_NODE_PORT: '8420',
      PIU_NODE_LISTEN: '0.0.0.0',
      PIU_LNNP: '1',
      PIU_LNNP_RELAY: '1',
      PIU_LNNP_LISTEN: '0.0.0.0',
      PIU_LNNP_PORT: '8422',
      PIU_LNNP_DISCOVERY_PORT: '8423',
      PIU_LNNP_BROADCAST: '255.255.255.255',
      PIU_LNNP_MEMORY_MB: '16',
      PIU_LNNP_BEACON_MS: '5000',
      PIU_GATEWAY: '1',
    });
    assert.ok(existsSync(data));
    assert.equal(statSync(data).mode & 0o777, 0o700);
    assert.match(r.out, new RegExp(`^chown\\t-hR\\tpiu-node\\t${data}$`, 'm'));
  });

  test('pasta de dados que é link simbólico: não inicia (o chown do root não segue o link); caixa do validador vira PIU_VALIDATOR_INBOX', () => {
    const real = join(tmp, 'alvo-de-root');
    mkdirSync(real);
    const link = join(tmp, 'data-link');
    execFileSync('ln', ['-s', real, link]);
    const r = startService({ config: withData(shipped(), link) });
    assert.equal(r.rc, 'rc=1');
    assert.doesNotMatch(r.out, /^chown/m);
    const gw = startService({ config: withData(shipped(), join(tmp, 'data-gw')).replace("#option inbox 'https://…'", "option inbox 'https://validador.example/caixa'").replace("config gateway 'gateway'\n\t# PIU_GATEWAY: 0 desliga de vez (o painel não liga).\n\toption enabled '1'", "config gateway 'gateway'\n\t# PIU_GATEWAY: 0 desliga de vez (o painel não liga).\n\toption enabled '0'") });
    assert.equal(gw.env.PIU_VALIDATOR_INBOX, 'https://validador.example/caixa');
    assert.equal(gw.env.PIU_GATEWAY, '0');
  });

  test('listas, booleanos, LoRa descomentado e opções vazias', () => {
    const cfg = withData(shipped(), join(tmp, 'data-lora'))
      .replace("option enabled '1'\n\t# PIU_LNNP_RELAY", "option enabled 'on'\n\t# PIU_LNNP_RELAY")
      .replace("option relay '1'", "option relay 'off'")
      .replace("#list peer '192.168.1.20:8422'", "list peer '192.168.1.20:8422'\n\tlist peer '10.0.0.2:8422'")
      .replace("list broadcast '255.255.255.255'", "option broadcast '192.168.1.255, 10.0.0.255'")
      .replace("option lan_host '1'", "option lan_host '0'")
      .replace("option node_args '--max-semi-space-size=1'", "option node_args '--max-semi-space-size=1 --lite-mode'")
      .replace(/^#(config serial|\toption device)/gm, '$1')
      .replace("#\toption lora_sf ''", "\toption lora_sf '9'")
      .replace("#\toption lora_cr ''", "\toption lora_cr ''");
    const r = startService({ config: cfg });
    assert.equal(r.rc, 'rc=0');
    assert.deepEqual(r.params.command.slice(1), ['--max-old-space-size=48', '--max-semi-space-size=1', '--lite-mode', '/usr/lib/piu-node/piu-node.mjs']);
    assert.equal(r.env.PIU_LNNP, '1');
    assert.equal(r.env.PIU_LNNP_RELAY, '0');
    assert.equal(r.env.PIU_LNNP_PEERS, '192.168.1.20:8422,10.0.0.2:8422');
    assert.equal(r.env.PIU_LNNP_BROADCAST, '192.168.1.255,10.0.0.255');
    assert.equal(r.env.PIU_NODE_HOSTS, 'piu-node.local,localhost,127.0.0.1');
    assert.equal(r.env.PIU_SERIAL, '/dev/ttyUSB0');
    assert.equal(r.env.PIU_LORA_SF, '9');
    assert.ok(!('PIU_LORA_CR' in r.env), 'opção vazia não define a variável');
    assert.ok(!('PIU_LNNP_ALLOW' in r.env));
  });

  test('Node.js antigo (18 do 23.05, 20 antes do 20.19) ou desligado: não inicia; 20.20 do 24.10 inicia', () => {
    const cfg = withData(shipped(), join(tmp, 'data-velho'));
    for (const v of ['v18.20.6', 'v20.18.3', 'v19.9.0']) {
      const old = startService({ config: cfg, nodeVersion: v });
      assert.equal(old.rc, 'rc=1', v);
      assert.doesNotMatch(old.out, /open_instance/, v);
    }
    for (const v of ['v20.20.2', 'v20.19.0', 'v22.23.4', 'v24.1.0']) assert.match(startService({ config: cfg, nodeVersion: v }).out, /open_instance/, v);
    const off = startService({ config: cfg.replace("config piu-node 'main'\n\toption enabled '1'", "config piu-node 'main'\n\toption enabled '0'") });
    assert.equal(off.rc, 'rc=0');
    assert.doesNotMatch(off.out, /open_instance/);
  });

  test('toda variável lida pelo piu-node tem opção UCI, e toda opção UCI é usada', () => {
    const text = readFileSync(init(), 'utf8');
    const mapped = new Set([...text.matchAll(/\b(PIU_[A-Z_]+)\b/g)].map(m => m[1]));
    // Lidas como env.PIU_X e pelo ajudante num('PIU_X', …).
    const read = new Set([...readFileSync(join(repo, 'apps', 'piu-node', 'src', 'config.ts'), 'utf8').matchAll(/(?:env\.|num\(')(PIU_[A-Z_]+)/g)].map(m => m[1]));
    assert.ok(read.size > 10);
    for (const v of read) assert.ok(mapped.has(v), `variável sem mapeamento UCI: ${v}`);
    for (const v of ['PIU_SERIAL', 'PIU_LORA_SF', 'PIU_LORA_BW_KHZ', 'PIU_LORA_CR', 'PIU_LORA_DUTY', 'PIU_LORA_MAX_ENVELOPE']) assert.ok(mapped.has(v), v);
    // Opções do arquivo UCI (inclusive as comentadas) precisam aparecer no init script.
    const opts = new Set([...shipped().matchAll(/^#?\s*(?:option|list) (\w+) /gm)].map(m => m[1]));
    for (const o of opts) assert.match(text, new RegExp(`\\b${o}\\b`), `opção UCI sem uso no init: ${o}`);
  });
});

describe('o bundle empacotado sobe', () => {
  let proc;
  let out = '';
  after(() => proc?.kill('SIGTERM'));

  const get = (port, path) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, rejectUnauthorized: false, headers: { Host: `localhost:${port}` } }, res => {
        const cert = res.socket.getPeerCertificate();
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), cert }));
      });
      req.on('error', reject);
      req.end();
    });

  // Porta livre escolhida antes: o piu-node confere o Host com a porta configurada (anti DNS rebinding).
  const freePort = () =>
    new Promise(resolve => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });

  test('HTTPS com certificado próprio, painel, API e motor LNNP', async t => {
    const port = await freePort();
    const data = join(tmp, 'run-data');
    const panel = join(root, 'usr', 'share', 'piu-node', 'panel');
    proc = spawn(process.execPath, ['--max-old-space-size=48', '--max-semi-space-size=1', join(root, 'usr', 'lib', 'piu-node', 'piu-node.mjs')], {
      env: {
        PATH: process.env.PATH,
        PIU_NODE_DATA: data,
        PIU_NODE_PANEL: panel,
        PIU_NODE_PORT: String(port),
        PIU_NODE_LISTEN: '127.0.0.1',
        PIU_NODE_HOSTS: 'localhost,127.0.0.1',
        PIU_LNNP_LISTEN: '127.0.0.1',
        PIU_LNNP_PORT: '0',
        PIU_LNNP_DISCOVERY_PORT: 'off',
        PIU_LNNP_MEMORY_MB: '16',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', c => (out += c));
    proc.stderr.on('data', c => (out += c));
    const deadline = Date.now() + 20_000;
    // Sem terminal o código não sai no log: vai para <dados>/pairing-code (0600).
    while (!/Código de pareamento em \S+pairing-code/.test(out)) {
      assert.ok(proc.exitCode === null, `o nó saiu:\n${out}`);
      assert.ok(Date.now() < deadline, `o nó não subiu em 20 s:\n${out}`);
      await new Promise(r => setTimeout(r, 100));
    }
    assert.doesNotMatch(out, /Código de pareamento: \d{4} \d{4}/, 'o código não pode aparecer no log');
    assert.match(readFileSync(join(data, 'pairing-code'), 'utf8'), /^\d{8}\n$/);
    assert.match(out, new RegExp(`painel em https://localhost:${port}`));
    assert.match(out, /Retransmissão LNNP v1: enlace TCP \d+, descoberta UDP desligada/);

    const fingerprint = /Certificado TLS \(SHA-256\): ([0-9A-F:]+)/.exec(out)?.[1];
    const home = await get(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /^text\/html/);
    assert.ok(home.headers['strict-transport-security']);
    assert.deepEqual(home.body, readFileSync(join(panel, 'index.html')));
    assert.equal(home.cert.fingerprint256, fingerprint, 'certificado servido = impressão digital mostrada no console');

    const js = /src="\.?(\/assets\/[^"]+\.js)"/.exec(home.body.toString())?.[1];
    assert.ok(js, 'index.html referencia o JS do painel');
    const asset = await get(port, js);
    assert.equal(asset.status, 200);
    assert.match(asset.headers['content-type'], /^text\/javascript/);

    const api = await get(port, '/api/session');
    assert.equal(api.status, 401, 'API sem sessão: 401');

    assert.equal(statSync(data).mode & 0o777, 0o700);
    assert.equal(statSync(join(data, 'tls', 'key.pem')).mode & 0o777, 0o600);
    assert.ok(existsSync(join(data, 'lnnp', 'node.seed')));

    // Memória residente do processo (só informativo: num roteador o Node é outro build).
    const status = existsSync(`/proc/${proc.pid}/status`) ? readFileSync(`/proc/${proc.pid}/status`, 'utf8') : '';
    const rss = /VmRSS:\s+(\d+) kB/.exec(status)?.[1];
    if (rss) t.diagnostic(`RSS do piu-node depois de servir o painel: ${(Number(rss) / 1024).toFixed(0)} MiB`);
  });
});
