// Produtos do site e os arquivos de cada release, por id (o mesmo id de releases.json e dos textos).
// Usado por sync-release.mjs; testado em release-products.test.mjs.
export const SUMS = 'SHA256SUMS.txt';

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

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sums = () => ({ sums: new RegExp(`^${esc(SUMS)}$`), sig: new RegExp(`^${esc(SUMS)}\\.asc$`) });
function desktopNames(head) {
  const out = {};
  for (const [id, suf] of Object.entries(DESKTOP_SUFFIX)) out[id] = new RegExp(`^${head}${esc(suf)}$`);
  return { ...out, ...sums() };
}

// O GitHub troca espaço por ponto no nome do arquivo ("Piu Provider" → "Piu.Provider").
// node: piu-node para OpenWrt (.ipk, packaging/openwrt) e Debian/Ubuntu/Raspberry Pi OS (.deb, packaging/linux),
// os dois com o mesmo bundle JS (Architecture all) e a revisão do pacote depois do hífen.
export const PRODUCTS = {
  android: { prefix: /^android-v(\d+\.\d+\.\d+)$/, names: v => ({ apk: new RegExp(`^Piu-${esc(v)}\\.apk$`) }) },
  desktop: { prefix: /^desktop-v(\d+\.\d+\.\d+)$/, names: v => desktopNames(`Piu-${esc(v)}`) },
  provider: { prefix: /^provider-v(\d+\.\d+\.\d+)$/, names: v => desktopNames(`Piu[-.]Provider-${esc(v)}`) },
  node: {
    prefix: /^node-v(\d+\.\d+\.\d+)$/,
    names: v => ({ ipk: new RegExp(`^piu-node_${esc(v)}-\\d+_all\\.ipk$`), deb: new RegExp(`^piu-node_${esc(v)}-\\d+_all\\.deb$`), ...sums() }),
  },
};

/** Versão da tag do produto (`node-v0.1.0` → `0.1.0`), ou null se a tag não é dele. */
export function tagVersion(product, tag) {
  return PRODUCTS[product]?.prefix.exec(tag)?.[1] ?? null;
}

/** Id do arquivo `name` no release `version` do produto, ou null se não é um arquivo conhecido. */
export function assetId(product, version, name) {
  const want = PRODUCTS[product].names(version);
  return Object.keys(want).find(k => want[k].test(name)) ?? null;
}
