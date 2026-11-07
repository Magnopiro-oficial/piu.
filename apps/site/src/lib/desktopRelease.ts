// Releases do Piu Desktop (apps/desktop) e do Piu Provider para computador (apps/provider-desktop).
// Nomes, URLs, tamanhos e hashes vêm de releases.json, preenchido por scripts/sync-release.mjs a partir do
// release publicado no GitHub. Enquanto o release não existe (ou é rascunho), o site lista os pacotes
// esperados como "em breve", sem link.
//
// Os nomes seguem electron-builder.yml (artifactName: <produto>-${version}-${os}-${arch}.${ext}).
// Só os formatos que realmente produzimos: dmg/zip (mac arm64 e x64), AppImage e .deb (linux x86_64) e
// instalador NSIS (win x64). Nada de Homebrew, .rpm, Flatpak nem Linux ARM64.
import { REPO, fmtSize, release, type Product } from './releases';

export { REPO };
export type DesktopOs = 'mac' | 'linux' | 'win';

export interface DesktopFile {
  /** Chave estável usada nos textos (i18n), no DOM e em releases.json. */
  id: string;
  os: DesktopOs;
  /** Nome exato do arquivo no release (ou o esperado, enquanto não publicado). */
  file: string;
  /** URL do arquivo publicado; vazio = ainda não publicado. */
  url: string;
  /** Tamanho legível (ex.: "94 MB"). Vazio até o release sair. */
  size: string;
  /** SHA-256 completo em hexa (64 caracteres). Vazio até o release sair. */
  sha256: string;
  /** Arquivo do botão principal da aba. */
  main?: boolean;
}

const LAYOUT: { id: string; os: DesktopOs; suffix: string; main?: boolean }[] = [
  { id: 'mac-arm64-dmg', os: 'mac', suffix: 'mac-arm64.dmg', main: true },
  { id: 'mac-x64-dmg', os: 'mac', suffix: 'mac-x64.dmg' },
  { id: 'mac-arm64-zip', os: 'mac', suffix: 'mac-arm64.zip' },
  { id: 'mac-x64-zip', os: 'mac', suffix: 'mac-x64.zip' },
  { id: 'linux-appimage', os: 'linux', suffix: 'linux-x86_64.AppImage', main: true },
  { id: 'linux-deb', os: 'linux', suffix: 'linux-amd64.deb' },
  { id: 'win-x64-exe', os: 'win', suffix: 'win-x64.exe', main: true },
];

export interface DesktopRelease {
  version: string;
  tag: string;
  published: boolean;
  releaseUrl: string;
  /** SHA256SUMS.txt do release; vazio se não houver. */
  sumsUrl: string;
  sigUrl: string;
  files: DesktopFile[];
  filesFor: (os: DesktopOs) => DesktopFile[];
  mainFile: (os: DesktopOs) => DesktopFile | undefined;
}

function load(product: Exclude<Product, 'android'>, namePrefix: string): DesktopRelease {
  const r = release(product);
  const files: DesktopFile[] = LAYOUT
    .map(l => {
      const a = r.assets[l.id];
      return { id: l.id, os: l.os, main: l.main, file: a?.name ?? `${namePrefix}-${r.version}-${l.suffix}`, url: a?.url ?? '', size: a ? fmtSize(a.size) : '', sha256: a?.sha256 ?? '' };
    })
    // Publicado: só o que está de fato no release. Não publicado: a lista esperada, sem link.
    .filter(f => !r.published || f.url);
  const filesFor = (os: DesktopOs) => files.filter(f => f.os === os);
  return {
    version: r.version, tag: r.tag, published: r.published && files.length > 0,
    releaseUrl: `${REPO}/releases/tag/${r.tag}`,
    sumsUrl: r.assets.sums?.url ?? '',
    sigUrl: r.assets.sig?.url ?? '',
    files, filesFor,
    mainFile: os => filesFor(os).find(f => f.main) ?? filesFor(os)[0],
  };
}

export const DESKTOP = load('desktop', 'Piu');
export const PROVIDER = load('provider', 'Piu-Provider');

export const DESKTOP_VERSION = DESKTOP.version;
export const DESKTOP_TAG = DESKTOP.tag;
export const DESKTOP_PUBLISHED = DESKTOP.published;
export const DESKTOP_RELEASE_URL = DESKTOP.releaseUrl;
export const DESKTOP_SUMS_URL = DESKTOP.sumsUrl;
export const DESKTOP_FILES = DESKTOP.files;
export const PROVIDER_PUBLISHED = PROVIDER.published;

export const DESKTOP_OSES: DesktopOs[] = ['mac', 'linux', 'win'];
/** "a91f 0c3e … 52d8 7b2d": primeiros e últimos 8 hexa, como na faixa de assinatura do APK. */
export const shortSha = (sha?: string) => (sha && sha.length >= 16 ? `${sha.slice(0, 4)} ${sha.slice(4, 8)} … ${sha.slice(-8, -4)} ${sha.slice(-4)}` : '');

// Chave GPG de release do projeto (docs/distribuicao/chave-de-release.md). A lista SHA256SUMS.txt de cada
// release é assinada no computador de quem publica (scripts/sign-release.sh) e vira SHA256SUMS.txt.asc.
// Impressão digital igual à de docs/distribuicao/piu-release.fpr; vazia = chave ainda não criada, e o site
// não mostra assinatura nem comando de conferência.
export const RELEASE_KEY_FPR = '';
export const RELEASE_KEY_FILE = 'piu-release.asc';
export const DESKTOP_SIG_URL = DESKTOP.sigUrl;
/** "ABCD 1234 …": impressão digital em grupos de 4, como o gpg mostra. */
export const fmtFpr = (fpr: string) => fpr.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
