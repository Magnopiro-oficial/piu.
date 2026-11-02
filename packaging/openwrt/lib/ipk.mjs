// Monta um .ipk no formato que o opkg do OpenWrt 23.05/24.10 instala, sem o SDK.
//
// O formato segue o scripts/ipkg-build do OpenWrt (o mesmo dos pacotes de downloads.openwrt.org):
// o .ipk é um tar.gz (NÃO um arquivo `ar` como o .deb) com, nesta ordem,
//   ./debian-binary    "2.0\n"
//   ./data.tar.gz      os arquivos instalados, com caminhos "./usr/...", dono 0:0
//   ./control.tar.gz   control, conffiles, postinst, prerm
// Os tars são GNU (magic "ustar  "), com dono numérico 0:0, nomes ordenados, data fixa
// (SOURCE_DATE_EPOCH) e gzip sem nome nem data: o mesmo conteúdo gera o mesmo .ipk, byte a byte.
import { gzipSync } from 'node:zlib';

const BLOCK = 512;

/** Campo numérico octal do cabeçalho tar, terminado em NUL. */
function octal(value, width) {
  const s = value.toString(8);
  if (s.length > width - 1) throw new Error(`tar: valor ${value} não cabe em ${width} bytes`);
  return s.padStart(width - 1, '0') + '\0';
}

function header({ name, mode, size, mtime, type }) {
  const nameBytes = Buffer.from(name, 'utf8');
  // Sem extensões de nome longo (GNU 'L' ou prefixo ustar): caminhos curtos o bastante para qualquer leitor.
  if (nameBytes.length > 99) throw new Error(`tar: caminho longo demais (${nameBytes.length} bytes): ${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  nameBytes.copy(h, 0);
  h.write(octal(mode, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii'); // uid
  h.write(octal(0, 8), 116, 'ascii'); // gid
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(mtime, 12), 136, 'ascii');
  h.write('        ', 148, 'ascii'); // checksum: espaços durante o cálculo
  h.write(type, 156, 'ascii');
  h.write('ustar  \0', 257, 'ascii'); // GNU, como `tar --format=gnu`
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

/**
 * Tar GNU a partir de uma lista de entradas `{ name, mode, data? }` (diretório: `name` terminado em "/").
 * A ordem é a da lista; quem chama ordena.
 */
export function tar(entries, mtime) {
  const parts = [];
  for (const e of entries) {
    const dir = e.name.endsWith('/');
    const data = dir ? Buffer.alloc(0) : Buffer.from(e.data);
    parts.push(header({ name: e.name, mode: e.mode, size: data.length, mtime, type: dir ? '5' : '0' }));
    if (data.length) {
      parts.push(data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) parts.push(Buffer.alloc(pad, 0));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0)); // fim do arquivo
  return Buffer.concat(parts);
}

/** gzip determinístico (cabeçalho sem nome e com data zero, como `gzip -n`). */
export const gz = buf => gzipSync(buf, { level: 9 });

/**
 * Transforma `{ "/caminho/absoluto": { data, mode } }` em entradas tar "./caminho", com todos os
 * diretórios intermediários (0755) e "./" no início, na ordem de `tar --sort=name` (profundidade primeiro).
 */
export function treeEntries(files) {
  const root = { dirs: new Map(), files: new Map() };
  for (const [path, file] of Object.entries(files)) {
    if (!path.startsWith('/')) throw new Error(`caminho precisa ser absoluto: ${path}`);
    const parts = path.slice(1).split('/');
    const base = parts.pop();
    let node = root;
    for (const p of parts) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(p);
    }
    node.files.set(base, file);
  }
  const out = [{ name: './', mode: 0o755 }];
  const cmp = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  const walk = (node, prefix) => {
    const names = [...new Set([...node.dirs.keys(), ...node.files.keys()])].sort(cmp);
    for (const n of names) {
      if (node.files.has(n)) {
        const f = node.files.get(n);
        out.push({ name: `${prefix}${n}`, mode: f.mode, data: f.data });
      } else {
        out.push({ name: `${prefix}${n}/`, mode: 0o755 });
        walk(node.dirs.get(n), `${prefix}${n}/`);
      }
    }
  };
  walk(root, './');
  return out;
}

/**
 * Gera o .ipk. `control` é o texto do arquivo control sem `Installed-Size`, que é calculado aqui
 * como no ipkg-build (tamanho do data.tar descomprimido).
 */
export function buildIpk({ files, control, conffiles = [], scripts = {}, mtime }) {
  const dataTar = tar(treeEntries(files), mtime);
  const controlText = `${control.trimEnd()}\nInstalled-Size: ${dataTar.length}\n`;
  const controlFiles = { '/control': { data: controlText, mode: 0o644 } };
  if (conffiles.length) controlFiles['/conffiles'] = { data: [...conffiles].sort().join('\n') + '\n', mode: 0o644 };
  for (const [name, body] of Object.entries(scripts)) controlFiles[`/${name}`] = { data: body, mode: 0o755 };
  const controlTar = tar(treeEntries(controlFiles), mtime);
  const outer = tar(
    [
      { name: './debian-binary', mode: 0o644, data: '2.0\n' },
      { name: './data.tar.gz', mode: 0o644, data: gz(dataTar) },
      { name: './control.tar.gz', mode: 0o644, data: gz(controlTar) },
    ],
    mtime,
  );
  return { ipk: gz(outer), installedSize: dataTar.length, control: controlText };
}
