// Testes do pacote .deb (Debian, Ubuntu, Raspberry Pi OS): gera o .deb, abre com o `ar` e o `tar` do
// sistema (leitores independentes do nosso gerador), confere formato, control, md5sums, conffiles,
// permissões, a unidade systemd endurecida, os scripts do dpkg e o lançador; sobe o bundle pelo lançador
// com o Node local e confere o código de pareamento em arquivo 0600. Com dpkg-deb na máquina (Linux, CI),
// confere também com ele.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const repo = join(pkgDir, '..', '..');
const EPOCH = '1767225600'; // 2026-01-01T00:00:00Z
const piuVersion = JSON.parse(readFileSync(join(repo, 'apps', 'piu-node', 'package.json'), 'utf8')).version;
const debRevision = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).debRevision;
const debName = `piu-node_${piuVersion}-${debRevision}_all.deb`;
const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

const tmp = mkdtempSync(join(tmpdir(), 'piu-deb-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dist = join(tmp, 'dist');
const build = () => {
  const env = { ...process.env, SOURCE_DATE_EPOCH: EPOCH, PIU_DEB_BUILD: join(tmp, 'build'), PIU_DEB_OUT: dist };
  execFileSync(process.execPath, [join(pkgDir, 'build-deb.mjs')], { cwd: pkgDir, env, stdio: 'pipe' });
  return readFileSync(join(dist, debName));
};
const sha = buf => createHash('sha256').update(buf).digest('hex');
const tarList = file => execFileSync('tar', ['--numeric-owner', '-tvzf', file], { encoding: 'utf8' }).trim().split('\n');
const modes = file => Object.fromEntries(tarList(file).map(l => { const p = l.split(/\s+/); return [p.at(-1), p[0]]; }));

let deb;
const outer = join(tmp, 'outer');
const control = join(tmp, 'control');
const root = join(tmp, 'root');

before(() => {
  deb = build();
  for (const d of [outer, control, root]) mkdirSync(d);
  execFileSync('ar', ['x', join(dist, debName)], { cwd: outer });
  execFileSync('tar', ['-xzf', join(outer, 'data.tar.gz')], { cwd: root });
  execFileSync('tar', ['-xzf', join(outer, 'control.tar.gz')], { cwd: control });
});

describe('formato do .deb (deb(5), binário 2.0)', () => {
  test('ar com debian-binary, control.tar.gz e data.tar.gz, nessa ordem', () => {
    assert.equal(deb.subarray(0, 8).toString('ascii'), '!<arch>\n');
    assert.deepEqual(execFileSync('ar', ['t', join(dist, debName)], { encoding: 'utf8' }).trim().split('\n'), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    assert.equal(readFileSync(join(outer, 'debian-binary'), 'utf8'), '2.0\n');
  });

  test('reprodutível: o mesmo código gera o mesmo .deb, byte a byte', () => {
    assert.equal(sha(build()), sha(deb));
  });

  test('tudo pertence a 0:0 e tem a data de SOURCE_DATE_EPOCH (cabeçalhos tar e ar)', () => {
    const oct = (b, off, len) => parseInt(b.subarray(off, off + len).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    for (const f of ['data.tar.gz', 'control.tar.gz']) {
      const t = gunzipSync(readFileSync(join(outer, f)));
      for (let off = 0; off + 512 <= t.length;) {
        const h = t.subarray(off, off + 512);
        if (h.every(x => x === 0)) break;
        const name = h.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
        assert.equal(oct(h, 108, 8), 0, `${f}:${name} uid`);
        assert.equal(oct(h, 116, 8), 0, `${f}:${name} gid`);
        assert.equal(oct(h, 136, 12), Number(EPOCH), `${f}:${name} mtime`);
        off += 512 + Math.ceil(oct(h, 124, 12) / 512) * 512;
      }
    }
    // Cabeçalhos do ar: data, uid e gid de cada membro.
    let off = 8;
    while (off < deb.length) {
      const h = deb.subarray(off, off + 60).toString('ascii');
      assert.equal(h.slice(58, 60), '`\n');
      assert.equal(h.slice(16, 28).trim(), EPOCH);
      assert.equal(h.slice(28, 34).trim(), '0');
      assert.equal(h.slice(34, 40).trim(), '0');
      const size = Number(h.slice(48, 58).trim());
      off += 60 + size + (size % 2);
    }
    assert.equal(off, deb.length);
  });
});

describe('control', () => {
  const fields = () => {
    const out = {};
    for (const line of readFileSync(join(control, 'control'), 'utf8').split('\n')) {
      if (!line || line.startsWith(' ')) continue;
      const i = line.indexOf(':');
      const k = line.slice(0, i);
      assert.ok(!(k in out), `campo repetido: ${k}`);
      out[k] = line.slice(i + 1).trim();
    }
    return out;
  };

  test('campos: Architecture all (bundle JS) e Depends nodejs >= 20.19', () => {
    const f = fields();
    assert.equal(f.Package, 'piu-node');
    assert.equal(f.Version, `${piuVersion}-${debRevision}`);
    assert.equal(f.Architecture, 'all');
    assert.equal(f.Depends, 'nodejs (>= 20.19)');
    assert.equal(f.Section, 'net');
    assert.equal(f.Priority, 'optional');
    assert.equal(f.Homepage, 'https://github.com/Magnopiro-oficial/piu.');
    assert.doesNotMatch(f.Maintainer, /@/, 'sem e-mail inventado');
    assert.match(f['Installed-Size'], /^\d+$/);
    assert.ok(Number(f['Installed-Size']) > 1000);
    assert.ok(f.Description.length > 10);
  });

  test('conffiles: só /etc/default/piu-node; md5sums confere com os arquivos e deixa o conffile de fora', () => {
    assert.equal(readFileSync(join(control, 'conffiles'), 'utf8'), '/etc/default/piu-node\n');
    const lines = readFileSync(join(control, 'md5sums'), 'utf8').trim().split('\n');
    assert.ok(lines.length > 5);
    for (const l of lines) {
      const [sum, path] = l.split(/ {2}/);
      assert.ok(!path.startsWith('/'), path);
      assert.notEqual(path, 'etc/default/piu-node');
      assert.equal(createHash('md5').update(readFileSync(join(root, path))).digest('hex'), sum, path);
    }
  });

  test('postinst, prerm e postrm: executáveis, sintaxe sh válida, usuário pelo sysusers.d do pacote', () => {
    const m = modes(join(outer, 'control.tar.gz'));
    for (const s of ['postinst', 'prerm', 'postrm']) {
      assert.equal(m[`./${s}`], '-rwxr-xr-x', s);
      execFileSync('sh', ['-n', join(control, s)]);
    }
    const post = readFileSync(join(control, 'postinst'), 'utf8');
    assert.match(post, /systemd-sysusers \/usr\/lib\/sysusers\.d\/piu-node\.conf/);
    assert.ok(existsSync(join(root, 'usr', 'lib', 'sysusers.d', 'piu-node.conf')));
    assert.match(post, /install -d -m 0700 -o piu-node -g piu-node \/var\/lib\/piu-node/);
    assert.match(readFileSync(join(control, 'postrm'), 'utf8'), /purge[\s\S]*rm -rf \/var\/lib\/piu-node/);
  });
});

describe('conteúdo', () => {
  test('caminhos e permissões; nada do OpenWrt', () => {
    const e = modes(join(outer, 'data.tar.gz'));
    assert.equal(e['./usr/lib/piu-node/piu-node.mjs'], '-rw-r--r--');
    assert.equal(e['./usr/lib/piu-node/piu-node-start'], '-rwxr-xr-x');
    assert.equal(e['./usr/lib/systemd/system/piu-node.service'], '-rw-r--r--');
    assert.equal(e['./usr/lib/sysusers.d/piu-node.conf'], '-rw-r--r--');
    assert.equal(e['./etc/default/piu-node'], '-rw-r--r--');
    assert.equal(e['./usr/share/piu-node/panel/index.html'], '-rw-r--r--');
    assert.equal(e['./usr/share/doc/piu-node/copyright'], '-rw-r--r--');
    for (const name of Object.keys(e)) {
      assert.ok(name.startsWith('./'), name);
      assert.doesNotMatch(name, /init\.d|etc\/config|upgrade\/keep\.d|node_modules|\.node$|_headers$/, `não deveria estar no pacote: ${name}`);
    }
    assert.match(readFileSync(join(root, 'usr', 'share', 'doc', 'piu-node', 'copyright'), 'utf8'), /AGPL-3\.0-only[\s\S]*GNU AFFERO GENERAL PUBLIC LICENSE/);
  });

  test('bundle único (o mesmo do .ipk): nenhum import fora de node:*', () => {
    const src = readFileSync(join(root, 'usr', 'lib', 'piu-node', 'piu-node.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import\s.*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
    assert.ok(imports.length > 0);
    for (const i of imports) assert.match(i, /^node:/, `import externo no bundle: ${i}`);
  });
});

describe('unidade systemd', () => {
  const unit = () => {
    const out = {};
    for (const line of readFileSync(join(root, 'usr', 'lib', 'systemd', 'system', 'piu-node.service'), 'utf8').split('\n')) {
      const m = /^([A-Za-z]+)=(.*)$/.exec(line);
      if (m) (out[m[1]] ??= []).push(m[2]);
    }
    return out;
  };

  test('usuário próprio, dados em /var/lib/piu-node (0700) e reinício com o código do painel', () => {
    const u = unit();
    assert.deepEqual(u.User, ['piu-node']);
    assert.deepEqual(u.Group, ['piu-node']);
    assert.deepEqual(u.SupplementaryGroups, ['dialout']);
    assert.deepEqual(u.StateDirectory, ['piu-node']);
    assert.deepEqual(u.StateDirectoryMode, ['0700']);
    assert.deepEqual(u.UMask, ['0077']);
    assert.ok(u.Environment.some(v => v.split(' ').includes('PIU_NODE_DATA=/var/lib/piu-node')));
    assert.ok(u.Environment.some(v => v.split(' ').includes('PIU_NODE_PANEL=/usr/share/piu-node/panel')));
    assert.ok(existsSync(join(root, 'usr', 'share', 'piu-node', 'panel', 'index.html')));
    assert.deepEqual(u.EnvironmentFile, ['-/etc/default/piu-node']);
    assert.deepEqual(u.ExecStart, ['/usr/lib/piu-node/piu-node-start']);
    assert.deepEqual(u.Restart, ['on-failure'], 'reinício pelo painel sai com 75 e precisa voltar');
    assert.deepEqual(u.RestartPreventExitStatus, ['78']);
    assert.deepEqual(u.WantedBy, ['multi-user.target']);
  });

  test('endurecida: sem privilégios, sistema só leitura, sem home, /tmp privado, sem W^X quebrado', () => {
    const u = unit();
    const want = {
      NoNewPrivileges: 'yes', ProtectSystem: 'strict', ProtectHome: 'yes', PrivateTmp: 'yes', CapabilityBoundingSet: '', AmbientCapabilities: '',
      ProtectKernelTunables: 'yes', ProtectKernelModules: 'yes', ProtectKernelLogs: 'yes', ProtectControlGroups: 'yes', ProtectClock: 'yes',
      ProtectHostname: 'yes', RestrictNamespaces: 'yes', RestrictRealtime: 'yes', RestrictSUIDSGID: 'yes', LockPersonality: 'yes',
      SystemCallArchitectures: 'native', DevicePolicy: 'closed',
    };
    for (const [k, v] of Object.entries(want)) assert.deepEqual(u[k], [v], k);
    assert.ok(u.SystemCallFilter.includes('@system-service'));
    assert.ok(!('MemoryDenyWriteExecute' in u), 'o JIT do V8 precisa de memória W+X');
    assert.ok(!('PrivateDevices' in u), 'esconderia as portas seriais do rádio');
    assert.deepEqual(u.DeviceAllow, ['char-ttyUSB rw', 'char-ttyACM rw']);
  });

  test('toda variável lida pelo piu-node está em /etc/default/piu-node ou na unidade', () => {
    const text = readFileSync(join(root, 'etc', 'default', 'piu-node'), 'utf8') + readFileSync(join(root, 'usr', 'lib', 'systemd', 'system', 'piu-node.service'), 'utf8');
    const read = new Set([...readFileSync(join(repo, 'apps', 'piu-node', 'src', 'config.ts'), 'utf8').matchAll(/(?:env\.|num\(')(PIU_[A-Z_]+)/g)].map(m => m[1]));
    assert.ok(read.size > 10);
    for (const v of read) assert.match(text, new RegExp(`\\b${v}=`), `variável sem linha em /etc/default/piu-node: ${v}`);
    // O arquivo é lido como EnvironmentFile: cada linha não comentada é VAR=valor.
    for (const l of readFileSync(join(root, 'etc', 'default', 'piu-node'), 'utf8').split('\n')) {
      if (l && !l.startsWith('#')) assert.match(l, /^PIU_[A-Z_]+=/, l);
    }
  });
});

describe('lançador /usr/lib/piu-node/piu-node-start', () => {
  const start = () => join(root, 'usr', 'lib', 'piu-node', 'piu-node-start');

  /** Roda o lançador com um "node" que só responde -v e mostra os argumentos e o PIU_NODE_HOSTS. */
  function run(nodeVersion, env = {}) {
    const dir = mkdtempSync(join(tmp, 'start-'));
    const fake = join(dir, 'node');
    writeFileSync(fake, `#!/bin/sh\nif [ "$1" = -v ]; then echo ${nodeVersion}; exit 0; fi\nprintf 'arg:%s\\n' "$@"; echo "hosts:$PIU_NODE_HOSTS"\n`);
    chmodSync(fake, 0o755);
    const r = spawnSync('sh', [start()], { encoding: 'utf8', env: { PATH: process.env.PATH, PIU_NODE_BIN: fake, ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr, args: r.stdout.split('\n').filter(l => l.startsWith('arg:')).map(l => l.slice(4)), hosts: /^hosts:(.*)$/m.exec(r.stdout)?.[1] };
  }

  test('sintaxe sh válida', () => execFileSync('sh', ['-n', start()]));

  test('Node.js antigo ou ausente: sai com 78 (a unidade não reinicia em laço) e diz a versão', () => {
    for (const v of ['v18.19.1', 'v20.18.3', 'v19.9.0', 'lixo']) {
      const r = run(v);
      assert.equal(r.code, 78, v);
      assert.match(r.err, /Node\.js/, v);
      assert.deepEqual(r.args, [], v);
    }
    const none = spawnSync('sh', [start()], { encoding: 'utf8', env: { PATH: process.env.PATH, PIU_NODE_BIN: join(tmp, 'nao-existe') } });
    assert.equal(none.status, 78);
  });

  test('Node 20 (Debian 13: 20.19) liga --experimental-websocket; 22 não; PIU_NODE_ARGS vira argumentos', () => {
    assert.deepEqual(run('v20.19.2').args, ['--experimental-websocket', '/usr/lib/piu-node/piu-node.mjs']);
    assert.deepEqual(run('v22.23.4').args, ['/usr/lib/piu-node/piu-node.mjs']);
    assert.deepEqual(run('v24.1.0', { PIU_NODE_ARGS: '--max-old-space-size=192 --lite-mode' }).args, ['--max-old-space-size=192', '--lite-mode', '/usr/lib/piu-node/piu-node.mjs']);
  });

  test('sem PIU_NODE_HOSTS: localhost, 127.0.0.1 e <nome>.local; com ele, fica o configurado', () => {
    const h = run('v22.23.4').hosts.split(',');
    assert.deepEqual(h.slice(0, 2), ['localhost', '127.0.0.1']);
    const name = execFileSync('hostname', { encoding: 'utf8' }).trim().toLowerCase();
    if (/^[a-z0-9-]+$/.test(name) && name !== 'localhost') assert.ok(h.includes(`${name}.local`), h.join(','));
    assert.equal(run('v22.23.4', { PIU_NODE_HOSTS: 'meu.nome,10.0.0.5' }).hosts, 'meu.nome,10.0.0.5');
  });

  test('com o Node local e o bundle do pacote: sobe, serve o painel e grava o código em arquivo 0600', async () => {
    const freePort = () => new Promise(res => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
    const port = await freePort();
    const data = join(tmp, 'var-lib-piu-node');
    const proc = spawn('sh', [start()], {
      env: {
        PATH: process.env.PATH, PIU_NODE_BIN: process.execPath, PIU_NODE_PROG: join(root, 'usr', 'lib', 'piu-node', 'piu-node.mjs'),
        PIU_NODE_DATA: data, PIU_NODE_PANEL: join(root, 'usr', 'share', 'piu-node', 'panel'), PIU_NODE_PORT: String(port), PIU_NODE_LISTEN: '127.0.0.1',
        PIU_LNNP_LISTEN: '127.0.0.1', PIU_LNNP_PORT: '0', PIU_LNNP_DISCOVERY_PORT: 'off', PIU_LNNP_MEMORY_MB: '16',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', c => (out += c));
    proc.stderr.on('data', c => (out += c));
    try {
      const end = Date.now() + 20_000;
      while (!/Código de pareamento em \S+pairing-code/.test(out)) {
        assert.ok(proc.exitCode === null, `o nó saiu:\n${out}`);
        assert.ok(Date.now() < end, `o nó não subiu em 20 s:\n${out}`);
        await new Promise(r => setTimeout(r, 100));
      }
      assert.doesNotMatch(out, /Código de pareamento: \d{4} \d{4}/, 'sem terminal, o código não vai para o log (journald)');
      assert.match(readFileSync(join(data, 'pairing-code'), 'utf8'), /^\d{8}\n$/);
      assert.equal(statSync(join(data, 'pairing-code')).mode & 0o777, 0o600);
      assert.equal(statSync(data).mode & 0o777, 0o700);
      const home = await new Promise((res, rej) => {
        const req = request({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false, headers: { Host: `localhost:${port}` } }, r => { r.resume(); r.on('end', () => res(r.statusCode)); });
        req.on('error', rej);
        req.end();
      });
      assert.equal(home, 200);
    } finally {
      proc.kill('SIGTERM');
    }
  });
});

describe('dpkg-deb (quando existe: Linux e CI)', { skip: has('dpkg-deb') ? false : 'dpkg-deb não instalado nesta máquina (macOS): estrutura conferida acima com ar e tar' }, () => {
  test('dpkg-deb lê o control e a lista de arquivos', () => {
    const file = join(dist, debName);
    assert.equal(execFileSync('dpkg-deb', ['--field', file, 'Version'], { encoding: 'utf8' }).trim(), `${piuVersion}-${debRevision}`);
    assert.equal(execFileSync('dpkg-deb', ['--field', file, 'Architecture'], { encoding: 'utf8' }).trim(), 'all');
    const list = execFileSync('dpkg-deb', ['--contents', file], { encoding: 'utf8' });
    assert.match(list, /\.\/usr\/lib\/systemd\/system\/piu-node\.service/);
    const x = join(tmp, 'dpkg-x');
    execFileSync('dpkg-deb', ['-x', file, x]);
    assert.deepEqual(readFileSync(join(x, 'usr', 'lib', 'piu-node', 'piu-node.mjs')), readFileSync(join(root, 'usr', 'lib', 'piu-node', 'piu-node.mjs')));
  });
});
