/// <reference types="node" />
/**
 * Tamanho do APK (0.1.5): só arm64-v8a, pacote JS comprimido e reanimated/worklets/gesture-handler fora.
 * Os três pontos andam juntos: `app.json` (expo-build-properties), `expo.autolinking.exclude` do
 * `package.json` (parte nativa) e o `metro.config.js` (parte JS). Se um nome sair de um lugar só, o nativo
 * entra sem o JS, ou o contrário. Ver "Tamanho do APK" em docs/distribuicao/checklist.md.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

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
