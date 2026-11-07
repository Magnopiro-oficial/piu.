/**
 * Atualização do Piu Desktop (Ajustes → Sistema → Atualizar), sem Electron (testada em test/updater.test.ts).
 *
 * De onde: só releases publicadas `desktop-vX.Y.Z` do GitHub do projeto (system.ts), arquivos do próprio
 * release. Nada vem da malha: o download é do GitHub, e a interface diz isso.
 *
 * Ordem da conferência (falha fechada em cada passo):
 *  1. baixa `SHA256SUMS.txt` e `SHA256SUMS.txt.asc` e confere a assinatura OpenPGP com a chave pública
 *     FIXADA no app (releaseKey.ts: chave + impressão digital). Sem chave configurada, nada é baixado:
 *     a interface mostra "verificação indisponível" e só oferece abrir a página da versão;
 *  2. o pacote deste sistema precisa estar na lista assinada;
 *  3. baixa o pacote (`.part`), calcula o SHA-256 enquanto grava e compara com a lista e com o tamanho.
 *     Não bateu: o arquivo é apagado e nada é instalado (D3e).
 * Só então fica "pronto"; instalar é sempre pedido pela pessoa (main.ts → `installPlan`).
 */
import { createHash } from 'node:crypto';
import { createWriteStream, chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as openpgp from 'openpgp';
import type { UpdateInfo, UpdateState } from '../shared/types';
import { compareVersions, type DesktopRelease, type FetchLike, latestRelease, type ReleaseAsset, UpdateCheckError } from './system';
import { tm } from './i18n';

export type InstallKind = 'appimage' | 'deb' | 'dmg' | 'nsis';
export type FetchBin = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const SUMS = 'SHA256SUMS.txt';
const SUMS_SIG = 'SHA256SUMS.txt.asc';
/** Pacote maior que isso não é do Piu (hoje ~100 MB): nem começa a baixar. */
const MAX_PACKAGE = 600 * 1024 * 1024;
const MAX_SMALL = 1024 * 1024;

export function installKindFor(platform: string, env: Record<string, string | undefined>): InstallKind | null {
  if (platform === 'darwin') return 'dmg';
  if (platform === 'win32') return 'nsis';
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb';
  return null;
}

const OS_EXT: Record<InstallKind, [string, string]> = { dmg: ['mac', 'dmg'], nsis: ['win', 'exe'], appimage: ['linux', 'AppImage'], deb: ['linux', 'deb'] };
const ARCH_ALIASES: Record<string, string[]> = { x64: ['x64', 'x86_64', 'amd64'], arm64: ['arm64', 'aarch64'] };

/** Nome do electron-builder: `Piu-<versão>-<so>-<arquitetura>.<ext>` (electron-builder.yml `artifactName`). */
export function pickAsset(assets: ReleaseAsset[], version: string, kind: InstallKind, arch: string): ReleaseAsset | null {
  const [os, ext] = OS_EXT[kind];
  const archs = [...(ARCH_ALIASES[arch] ?? [arch]), ...(kind === 'dmg' ? ['universal'] : [])];
  for (const a of archs) {
    const hit = assets.find(x => x.name === `Piu-${version}-${os}-${a}.${ext}`);
    if (hit) return hit;
  }
  return null;
}

/** `sha256sum`: "<64 hex>  nome" ou "<64 hex> *nome". Nomes com caminho são ignorados. */
export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const r = /^([0-9a-fA-F]{64}) [ *]([^/\\]+)$/.exec(line.trim());
    if (r && !r[2]!.startsWith('.')) m.set(r[2]!, r[1]!.toLowerCase());
  }
  return m;
}

const normFpr = (f: string) => f.replace(/\s+/g, '').toUpperCase();

/** Assinatura destacada (binária, `gpg --detach-sign --armor`) da lista de hashes, pela chave fixada. */
export async function verifySumsSignature(sums: Uint8Array, armoredSignature: string, armoredKey: string, fpr: string): Promise<boolean> {
  try {
    if (!armoredKey || !/^[0-9A-F]{40}$/.test(normFpr(fpr))) return false;
    const key = await openpgp.readKey({ armoredKey });
    if (normFpr(key.getFingerprint()) !== normFpr(fpr)) return false;
    const { signatures } = await openpgp.verify({
      message: await openpgp.createMessage({ binary: sums }),
      signature: await openpgp.readSignature({ armoredSignature }),
      verificationKeys: key, expectSigned: true,
    });
    await signatures[0]!.verified;
    return signatures.length > 0;
  } catch { return false; }
}

/** Troca o AppImage em uso de uma vez: cópia na mesma pasta, executável, e `rename` por cima. */
export function replaceAppImage(target: string, src: string) {
  const tmp = `${target}.piu-update`;
  try {
    copyFileSync(src, tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

interface UpdaterOptions {
  current: string;
  /** Pasta só do Piu para os downloads (<userData>/updates). */
  dir: string;
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  /** App instalado? Em desenvolvimento baixa e confere, mas não instala. */
  packaged: boolean;
  key: { armored: string; fpr: string };
  fetchJson?: FetchLike;
  fetchBin?: FetchBin;
  onState: (s: UpdateState) => void;
}

export class Updater {
  state: UpdateState = { state: 'idle' };
  private release: DesktopRelease | null = null;
  private file: string | null = null;
  private busy = false;
  constructor(private o: UpdaterOptions) {}

  private get kind() { return installKindFor(this.o.platform, this.o.env); }
  private get hasKey() { return !!this.o.key.armored && /^[0-9A-F]{40}$/.test(normFpr(this.o.key.fpr)); }
  private set(s: UpdateState) { this.state = s; this.o.onState(s); return s; }
  readyFile() { return this.state.state === 'ready' ? this.file : null; }
  get installKind() { return this.kind; }

  private info(r: DesktopRelease): UpdateInfo {
    const a = this.kind ? pickAsset(r.assets, r.version, this.kind, this.o.arch) : null;
    return { current: this.o.current, version: r.version, url: r.url, notes: r.notes, asset: a?.name ?? null, size: a?.size ?? null, arch: this.o.arch };
  }

  async check(): Promise<UpdateState> {
    if (this.busy || this.state.state === 'ready') return this.state;
    this.set({ state: 'checking' });
    try {
      const r = await latestRelease(this.o.fetchJson);
      if (!r || compareVersions(r.version, this.o.current) <= 0) { this.release = null; return this.set({ state: 'latest', current: this.o.current, at: Date.now() }); }
      this.release = r;
      const info = this.info(r);
      const verify = !this.hasKey ? 'no-key' : !info.asset || !r.assets.some(x => x.name === SUMS) || !r.assets.some(x => x.name === SUMS_SIG) ? 'no-asset' : 'ok';
      return this.set({ state: 'available', info, verify, at: Date.now() });
    } catch (e) { return this.set({ state: 'error', message: (e as Error).message, info: null, kind: e instanceof UpdateCheckError ? e.kind : 'other', at: Date.now() }); }
  }

  private async small(a: ReleaseAsset | undefined): Promise<Uint8Array> {
    if (!a || a.size > MAX_SMALL) throw new Error(tm('main.update.sumsMissing'));
    const res = await (this.o.fetchBin ?? fetch)(a.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(tm('main.update.githubDownload', { status: res.status, name: a.name }));
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.length > MAX_SMALL) throw new Error(tm('main.update.sumsTooBig'));
    return b;
  }

  /** Baixa e confere (só com chave configurada e pacote deste sistema no release). */
  async download(): Promise<UpdateState> {
    const s = this.state;
    if (this.busy || s.state !== 'available' || s.verify !== 'ok' || !this.release) return this.state;
    const r = this.release, info = s.info;
    const pkg = r.assets.find(x => x.name === info.asset)!;
    this.busy = true;
    const part = join(this.o.dir, `${pkg.name}.part`), final = join(this.o.dir, pkg.name);
    try {
      rmSync(this.o.dir, { recursive: true, force: true });
      mkdirSync(this.o.dir, { recursive: true, mode: 0o700 });
      // 1. lista de hashes assinada
      this.set({ state: 'downloading', info, step: 'sums', received: 0, total: pkg.size });
      const sums = await this.small(r.assets.find(x => x.name === SUMS));
      const sig = new TextDecoder().decode(await this.small(r.assets.find(x => x.name === SUMS_SIG)));
      const fpr4 = normFpr(this.o.key.fpr).slice(-4);
      if (!(await verifySumsSignature(sums, sig, this.o.key.armored, this.o.key.fpr))) return this.set({ state: 'bad', info, reason: 'signature', expected: tm('main.update.keyExpected', { fpr: fpr4 }), got: tm('main.update.otherSignature') });
      // 2. o pacote precisa estar na lista
      const expected = parseSums(new TextDecoder().decode(sums)).get(pkg.name);
      if (!expected) return this.set({ state: 'bad', info, reason: 'unlisted', expected: pkg.name, got: tm('main.update.notListed') });
      if (pkg.size > MAX_PACKAGE) throw new Error(tm('main.update.packageTooBig'));
      // 3. pacote, com o SHA-256 calculado enquanto grava
      this.set({ state: 'downloading', info, step: 'package', received: 0, total: pkg.size });
      const res = await (this.o.fetchBin ?? fetch)(pkg.url, { signal: AbortSignal.timeout(30 * 60_000) });
      if (!res.ok || !res.body) throw new Error(tm('main.update.githubPackage', { status: res.status }));
      const hash = createHash('sha256');
      let received = 0, lastEmit = 0;
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          received += chunk.length;
          if (received > pkg.size) { cb(new Error(tm('main.update.packageBigger'))); return; }
          hash.update(chunk);
          const now = Date.now();
          if (now - lastEmit > 250) { lastEmit = now; this.set({ state: 'downloading', info, step: 'package', received, total: pkg.size }); }
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(part, { mode: 0o600 }));
      this.set({ state: 'downloading', info, step: 'hash', received, total: pkg.size });
      const got = hash.digest('hex');
      if (received !== pkg.size || got !== expected) {
        rmSync(part, { force: true });
        return this.set({ state: 'bad', info, reason: 'hash', expected: expected.slice(0, 8), got: received !== pkg.size ? tm('main.update.bytesOf', { received, size: pkg.size }) : got.slice(0, 8) });
      }
      renameSync(part, final);
      this.file = final;
      return this.set({ state: 'ready', info, signer: fpr4, install: this.o.packaged ? this.kind! : 'dev' });
    } catch (e) {
      rmSync(part, { force: true });
      return this.set({ state: 'error', message: (e as Error).message || tm('main.update.downloadFailed'), info, kind: 'other' });
    } finally { this.busy = false; }
  }

  /** Apaga downloads (ao abrir o Piu, depois de instalar, ou ao fechar o aviso de pacote ruim). */
  cleanup() {
    this.file = null;
    try { rmSync(this.o.dir, { recursive: true, force: true }); } catch { /* nada */ }
    if (this.state.state === 'ready' || this.state.state === 'bad') this.set({ state: 'idle' });
  }
}
