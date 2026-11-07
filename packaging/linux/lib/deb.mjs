// Monta um .deb (formato binário 2.0 do dpkg) sem dpkg-deb, para gerar o pacote em qualquer sistema
// (inclusive macOS) com o mesmo resultado byte a byte.
//
// O .deb é um arquivo `ar` (deb(5)) com, nesta ordem:
//   debian-binary    "2.0\n"
//   control.tar.gz   control, conffiles, md5sums, postinst, prerm, postrm
//   data.tar.gz      os arquivos instalados, "./usr/...", dono 0:0
// Os tars e o gzip determinístico são os mesmos do .ipk (../../openwrt/lib/ipk.mjs): GNU, 0:0, nomes
// ordenados, data fixa (SOURCE_DATE_EPOCH). No `ar`, cada membro tem cabeçalho de 60 bytes (nome com
// até 16 caracteres, data, uid/gid 0, modo 100644, tamanho, "`\n") e é completado com "\n" até tamanho par.
import { createHash } from 'node:crypto';
import { gz, tar, treeEntries } from '../../openwrt/lib/ipk.mjs';

const field = (value, width) => {
  const s = String(value);
  if (s.length > width) throw new Error(`ar: "${s}" não cabe em ${width} bytes`);
  return s.padEnd(width, ' ');
};

/** Arquivo `ar` comum (System V/GNU, sem tabela de símbolos), como o do dpkg-deb. */
export function ar(members, mtime) {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const { name, data } of members) {
    const body = Buffer.from(data);
    if (!/^[\x21-\x7e]{1,15}$/.test(name)) throw new Error(`ar: nome inválido: ${name}`);
    const h = field(name, 16) + field(mtime, 12) + field(0, 6) + field(0, 6) + field('100644', 8) + field(body.length, 10) + '`\n';
    parts.push(Buffer.from(h, 'ascii'), body);
    if (body.length % 2) parts.push(Buffer.from('\n', 'ascii'));
  }
  return Buffer.concat(parts);
}

/**
 * Gera o .deb. `files`: `{ "/caminho": { data, mode } }`. `control`: texto do control sem
 * `Installed-Size` (calculado aqui, em KiB, como o dpkg-gencontrol: arquivos arredondados para cima,
 * mais 1 por diretório). `md5sums` sai sozinho; os conffiles ficam fora dele, como no debhelper.
 */
export function buildDeb({ files, control, conffiles = [], scripts = {}, mtime }) {
  const entries = treeEntries(files);
  const dataTar = tar(entries, mtime);
  let kib = 0;
  for (const e of entries) kib += e.name.endsWith('/') ? 1 : Math.max(1, Math.ceil(Buffer.byteLength(e.data) / 1024));
  const controlText = `${control.trimEnd()}\nInstalled-Size: ${kib}\n`;
  const conf = new Set(conffiles);
  for (const c of conf) if (!files[c]) throw new Error(`conffile fora do pacote: ${c}`);
  const md5 = Object.keys(files)
    .filter(p => !conf.has(p))
    .sort()
    .map(p => `${createHash('md5').update(files[p].data).digest('hex')}  ${p.slice(1)}`)
    .join('\n') + '\n';
  const controlFiles = { '/control': { data: controlText, mode: 0o644 }, '/md5sums': { data: md5, mode: 0o644 } };
  if (conf.size) controlFiles['/conffiles'] = { data: [...conf].sort().join('\n') + '\n', mode: 0o644 };
  for (const [name, body] of Object.entries(scripts)) controlFiles[`/${name}`] = { data: body, mode: 0o755 };
  const controlTar = tar(treeEntries(controlFiles), mtime);
  const deb = ar(
    [
      { name: 'debian-binary', data: '2.0\n' },
      { name: 'control.tar.gz', data: gz(controlTar) },
      { name: 'data.tar.gz', data: gz(dataTar) },
    ],
    mtime,
  );
  return { deb, installedKiB: kib, control: controlText };
}
