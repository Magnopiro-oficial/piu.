/// <reference types="node" />
/**
 * Tamanho do APK (0.1.5): só arm64-v8a, pacote JS comprimido e reanimated/worklets/gesture-handler fora.
 * Os três pontos andam juntos: `app.json` (expo-build-properties), `expo.autolinking.exclude` do
 * `package.json` (parte nativa) e o `metro.config.js` (parte JS). Se um nome sair de um lugar só, o nativo
 * entra sem o JS, ou o contrário. Ver "Tamanho do APK" em docs/distribuicao/checklist.md.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const FORA = ['react-native-reanimated', 'react-native-worklets', 'react-native-gesture-handler'];

function buildProps(): Record<string, unknown> {
  const app = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'));
  const plugin = (app.expo.plugins as unknown[]).find(p => Array.isArray(p) && p[0] === 'expo-build-properties') as [string, { android?: Record<string, unknown> }] | undefined;
  assert.ok(plugin, 'expo-build-properties no app.json');
  return plugin[1].android ?? {};
}

test('app.json: APK de release só com arm64-v8a e pacote JS comprimido', () => {
  const android = buildProps();
  assert.deepEqual(android.buildArchs, ['arm64-v8a']);
  assert.equal(android.enableBundleCompression, true);
  assert.equal(android.enableMinifyInReleaseBuilds, true);
});

test('app.json: shrinkResources desligado (apagaria res/raw/piu, o som da notificação)', () => {
  const android = buildProps();
  assert.ok(!android.enableShrinkResourcesInReleaseBuilds, 'só religar com keep.xml e teste em aparelho');
});

test('reanimated, worklets e gesture-handler: fora do nativo (package.json) e do JS (metro.config.js), a mesma lista', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const exclude: string[] = pkg.expo?.autolinking?.exclude ?? [];
  assert.deepEqual([...exclude].sort(), [...FORA].sort());

  const metro = readFileSync(new URL('metro.config.js', root), 'utf8');
  const fonte = /const FORA_DO_APP = \/(.+)\/;/.exec(metro);
  assert.ok(fonte, 'regex FORA_DO_APP no metro.config.js');
  const regex = new RegExp(fonte[1]!);
  for (const nome of exclude) {
    assert.ok(regex.test(nome), `metro.config.js não barra ${nome}`);
    assert.ok(regex.test(`${nome}/lib/x`), `metro.config.js não barra subcaminho de ${nome}`);
  }
  // E só eles: pacotes que o app usa passam, e a regex não barra nome que o autolinking deixaria entrar.
  for (const nome of ['react-native', 'react-native-screens', 'react-native-svg', 'react-native-safe-area-context', '@shopify/react-native-skia', 'react-native-reanimated-x']) {
    assert.ok(!regex.test(nome), `metro.config.js barra ${nome}`);
  }
  const barrados = /\(([^)]+)\)/.exec(fonte[1]!)![1]!.split('|').map(n => `react-native-${n}`);
  assert.deepEqual(barrados.sort(), [...exclude].sort());

  // Nenhum deles como dependência direta: se virar, é porque o app passou a usar e a exclusão tem de sair.
  for (const nome of FORA) assert.ok(!pkg.dependencies[nome] && !pkg.devDependencies?.[nome], `${nome} não é dependência do app`);
});

// android/ não é versionado (sai do prebuild): aqui confere o gerado, quando existe.
const gradleProps = new URL('android/gradle.properties', root);
test('android/gradle.properties gerado: arm64-v8a e compressão do pacote', { skip: !existsSync(gradleProps) && 'android/ não gerado (rode o prebuild)' }, () => {
  const txt = readFileSync(gradleProps, 'utf8');
  assert.match(txt, /^reactNativeArchitectures=arm64-v8a$/m);
  assert.match(txt, /^android\.enableBundleCompression=true$/m);
  assert.ok(!/^android\.enableShrinkResourcesInReleaseBuilds=true$/m.test(txt), 'shrinkResources desligado');
});

// Trava do x86_64 (0.1.5): a 0.1.4 saiu com lib/x86_64 porque a lista de ABIs veio de fora do projeto
// (-PreactNativeArchitectures). Três camadas: buildArchs no app.json (acima), o plugin que tira do
// release as .so de outras ABIs (vence qualquer -PreactNativeArchitectures) e o script do build, que
// recusa o APK com lib/ fora de arm64-v8a.
const require = createRequire(import.meta.url);
const { addReleaseAbiLock, MARK: ABI_MARK, OUTRAS_ABIS } = require('../../../plugins/releaseAbiGradle.js') as {
  addReleaseAbiLock: (s: string) => string;
  MARK: string;
  OUTRAS_ABIS: string[];
};

const GRADLE_APP = `android {
    buildTypes {
        release {
            minifyEnabled true
        }
    }
}

dependencies {
}
`;

test('plugin da trava: registrado no app.json', () => {
  const app = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'));
  assert.ok((app.expo.plugins as unknown[]).includes('./plugins/withReleaseAbi'));
});

test('plugin da trava: tira do release as .so de toda ABI que não seja arm64-v8a, só no release', () => {
  const out = addReleaseAbiLock(GRADLE_APP);
  assert.ok(out.startsWith(GRADLE_APP), 'não mexe no que o prebuild gerou');
  assert.ok(out.includes(ABI_MARK));
  // Trava 1: lista de ABIs trocada por arm64-v8a depois do plugin do RN, salvo em build só de debug.
  assert.match(out, /finalizeDsl \{ ext ->\n\s+if \(!piuSoDebug\) \{\n\s+ext\.defaultConfig\.ndk\.abiFilters\.clear\(\)\n\s+ext\.defaultConfig\.ndk\.abiFilters\.add\('arm64-v8a'\)/);
  assert.match(out, /def piuSoDebug = .*taskNames\.every \{ it\.toLowerCase\(\)\.contains\('debug'\) \}/);
  // Trava 2: excludes das outras ABIs no release.
  assert.match(out, /onVariants\(selector\(\)\.withBuildType\('release'\)\)/);
  assert.match(out, /packaging\.jniLibs\.excludes/);
  for (const abi of ['armeabi', 'armeabi-v7a', 'x86', 'x86_64', 'riscv64']) {
    assert.ok(OUTRAS_ABIS.includes(abi), `${abi} na lista`);
    assert.ok(out.includes(`'**/${abi}/*.so'`), `${abi} excluída`);
  }
  assert.ok(!OUTRAS_ABIS.includes('arm64-v8a'));
  assert.ok(!out.includes("'**/arm64-v8a/*.so'"));
  assert.equal(addReleaseAbiLock(out), out, 'idempotente (prebuild de novo)');
});

// android/ sai do prebuild: aqui confere o gerado, quando existe.
const appGradle = new URL('android/app/build.gradle', root);
test('android/app/build.gradle gerado: com a trava do release', { skip: !existsSync(appGradle) && 'android/ não gerado (rode o prebuild)' }, () => {
  assert.ok(readFileSync(appGradle, 'utf8').includes(ABI_MARK), 'rode npx expo prebuild --platform android');
});

const checkAbi = fileURLToPath(new URL('scripts/check-apk-abi.sh', root));
function apkFalso(dir: string, nome: string, arquivos: string[]): string {
  const base = join(dir, nome);
  for (const a of arquivos) {
    mkdirSync(dirname(join(base, a)), { recursive: true });
    writeFileSync(join(base, a), 'x');
  }
  const apk = join(dir, `${nome}.apk`);
  const r = spawnSync('zip', ['-qr', apk, '.'], { cwd: base });
  assert.equal(r.status, 0, String(r.stderr));
  return apk;
}

test('check-apk-abi.sh: aceita só arm64-v8a e recusa qualquer outra ABI ou APK sem lib/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-abi-'));
  try {
    const roda = (apk: string) => spawnSync('bash', [checkAbi, apk], { encoding: 'utf8' });
    const ok = apkFalso(dir, 'ok', ['AndroidManifest.xml', 'lib/arm64-v8a/libhermes.so', 'lib/arm64-v8a/libc++_shared.so']);
    assert.equal(roda(ok).status, 0, roda(ok).stderr);
    for (const abi of ['x86_64', 'x86', 'armeabi-v7a', 'riscv64']) {
      const ruim = apkFalso(dir, abi, ['lib/arm64-v8a/libhermes.so', `lib/${abi}/libhermes.so`]);
      const r = roda(ruim);
      assert.notEqual(r.status, 0, `${abi} passou`);
      assert.match(r.stderr, new RegExp(abi));
    }
    assert.notEqual(roda(apkFalso(dir, 'semlib', ['AndroidManifest.xml'])).status, 0, 'APK sem lib/ passou');
    assert.notEqual(roda(join(dir, 'nao-existe.apk')).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-apk.sh: gera o release e passa o APK pelo check-apk-abi.sh', () => {
  const sh = readFileSync(new URL('scripts/build-apk.sh', root), 'utf8');
  assert.match(sh, /set -euo pipefail/);
  assert.match(sh, /assembleRelease/);
  assert.match(sh, /check-apk-abi\.sh/);
  assert.ok(sh.includes(ABI_MARK), 'confere que o prebuild trouxe a trava antes de compilar');
});
