// Release do Piu Node (apps/piu-node empacotado): .ipk para OpenWrt (packaging/openwrt) e .deb para
// Debian, Ubuntu e Raspberry Pi OS (packaging/linux), os dois "all" (o mesmo bundle JS; o Node.js do
// sistema é que é por arquitetura). Nomes, URLs, tamanhos e hashes vêm de releases.json, preenchido por
// `node scripts/sync-release.mjs --node node-v<versão>`. Sem release publicado, o site lista os pacotes
// esperados como "em breve", sem link.
import { REPO, fmtSize, release } from './releases';

/** Revisões dos pacotes (PKG_RELEASE do Makefile do OpenWrt e debRevision de packaging/linux/package.json). */
const IPK_RELEASE = '1';
const DEB_REVISION = '1';

export type NodeFileId = 'ipk' | 'deb';
export interface NodeFile { id: NodeFileId; file: string; url: string; size: string; sha256: string }

const r = release('node');
const file = (id: NodeFileId, expected: string): NodeFile => {
  const a = r.assets[id];
  return { id, file: a?.name ?? expected, url: a?.url ?? '', size: a ? fmtSize(a.size) : '', sha256: a?.sha256 ?? '' };
};

export const NODE_VERSION = r.version;
export const NODE_TAG = r.tag;
export const NODE_IPK = file('ipk', `piu-node_${r.version}-${IPK_RELEASE}_all.ipk`);
export const NODE_DEB = file('deb', `piu-node_${r.version}-${DEB_REVISION}_all.deb`);
/** Algum pacote publicado (release não-rascunho com o arquivo)? */
export const NODE_PUBLISHED = !!(NODE_IPK.url || NODE_DEB.url);
export const NODE_RELEASE_URL = `${REPO}/releases/tag/${r.tag}`;
export const NODE_SUMS_URL = r.assets.sums?.url ?? '';
