import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { addReleaseSigning, MARK, GUARD } = require('../../../plugins/releaseSigningGradle.js') as { addReleaseSigning: (s: string) => string; MARK: string; GUARD: string };

// Trecho do `app/build.gradle` que o prebuild do Expo gera (SDK 58).
const GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            shrinkResources false
        }
    }
}`;

test('release assina com a chave das variáveis de ambiente', () => {
  const out = addReleaseSigning(GRADLE);
  assert.match(out, /release \{ \/\/ piu: assinatura de release\n\s+def piuStore = System\.getenv\('PIU_RELEASE_STORE_FILE'\)/);
  assert.match(out, /storePassword System\.getenv\('PIU_RELEASE_STORE_PASSWORD'\)/);
  assert.match(out, /signingConfig System\.getenv\('PIU_RELEASE_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/);
  // o tipo debug continua com a chave de debug
  assert.match(out, /debug \{\n\s+signingConfig signingConfigs\.debug\n/);
  assert.ok(!/storePassword '[^a]/.test(out), 'nenhuma senha de release escrita no arquivo');
});

// M-03 (auditoria 2026-11-06): sem a chave, o release não pode sair assinado com a chave de debug pública.
test('sem PIU_RELEASE_STORE_FILE ou a senha, qualquer tarefa de release do app falha (debug segue igual)', () => {
  const out = addReleaseSigning(GRADLE);
  assert.ok(out.includes(GUARD), 'guarda presente');
  // confere o arquivo e a senha; a saída explícita para teste local é -PallowDebugSignedRelease
  assert.match(out, /if \(!\(piuStore && System\.getenv\('PIU_RELEASE_STORE_PASSWORD'\)\) && !project\.hasProperty\('allowDebugSignedRelease'\)\)/);
  assert.match(out, /gradle\.taskGraph\.whenReady \{ g ->/);
  // só tarefas deste módulo com "release" no nome (assembleRelease, bundleRelease, installRelease…)
  assert.match(out, /g\.allTasks\.any \{ it\.project == project && it\.name\.toLowerCase\(\)\.contains\('release'\) \}/);
  assert.match(out, /throw new GradleException\(/);
  // a guarda fica dentro do bloco de release do plugin, antes de qualquer storeFile
  assert.ok(out.indexOf(GUARD) > out.indexOf(MARK) && out.indexOf(GUARD) < out.indexOf('storeFile file(piuStore)'));
});

test('build.gradle já gerado pela versão antiga do plugin ganha a guarda (prebuild sem --clean)', () => {
  const OLD = `release { ${MARK}
            def piuStore = System.getenv('PIU_RELEASE_STORE_FILE')
            if (piuStore) {`;
  const old = GRADLE.replace(/(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s{8}\}\n)/, `$1        ${OLD}\n            }\n        }\n`)
    .replace('            signingConfig signingConfigs.debug\n            shrinkResources', "            signingConfig System.getenv('PIU_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug\n            shrinkResources");
  assert.ok(!old.includes(GUARD));
  const up = addReleaseSigning(old);
  assert.equal(up.split(GUARD).length - 1, 1);
  assert.equal(up.split(MARK).length - 1, 1);
  assert.equal(addReleaseSigning(up), up);
});

test('o build.gradle do repositório já tem a guarda', () => {
  const real = readFileSync(new URL('../../../android/app/build.gradle', import.meta.url), 'utf8');
  assert.equal(addReleaseSigning(real), real, 'aplicar o plugin não muda nada');
  assert.ok(real.includes(GUARD));
});

test('aplicar duas vezes não duplica (prebuild roda de novo)', () => {
  const once = addReleaseSigning(GRADLE);
  assert.equal(addReleaseSigning(once), once);
  assert.equal(once.split(MARK).length - 1, 1);
  assert.equal(once.split(GUARD).length - 1, 1);
});

test('formato inesperado: falha alto em vez de gerar um APK assinado com a chave de debug sem aviso', () => {
  assert.throws(() => addReleaseSigning('android { }'), /signingConfigs/);
});

// Versão 0.1.1 (código 2): o `build.gradle` versionado tem de bater com o app.json, senão um `expo prebuild`
// volta o versionCode para 1 e o Android recusa instalar o APK novo por cima do 0.1.1.
test('versão: app.json (version + android.versionCode) igual ao android/app/build.gradle e ao package.json', () => {
  const app = JSON.parse(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8')).expo;
  const gradle = readFileSync(new URL('../../../android/app/build.gradle', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.ok(Number.isInteger(app.android?.versionCode), 'app.json sem android.versionCode');
  assert.match(gradle, new RegExp(`versionCode ${app.android.versionCode}\\b`));
  assert.match(gradle, new RegExp(`versionName "${app.version.replace(/\./g, '\\.')}"`));
  assert.equal(pkg.version, app.version);
});
