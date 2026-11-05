import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { addReleaseSigning, MARK } = require('../../../plugins/releaseSigningGradle.js') as { addReleaseSigning: (s: string) => string; MARK: string };

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

test('release assina com a chave das variáveis de ambiente; sem elas, segue a de debug', () => {
  const out = addReleaseSigning(GRADLE);
  assert.match(out, /release \{ \/\/ piu: assinatura de release\n\s+def piuStore = System\.getenv\('PIU_RELEASE_STORE_FILE'\)/);
  assert.match(out, /storePassword System\.getenv\('PIU_RELEASE_STORE_PASSWORD'\)/);
  assert.match(out, /signingConfig System\.getenv\('PIU_RELEASE_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/);
  // o tipo debug continua com a chave de debug
  assert.match(out, /debug \{\n\s+signingConfig signingConfigs\.debug\n/);
  assert.ok(!/storePassword '[^a]/.test(out), 'nenhuma senha de release escrita no arquivo');
});

test('aplicar duas vezes não duplica (prebuild roda de novo)', () => {
  const once = addReleaseSigning(GRADLE);
  assert.equal(addReleaseSigning(once), once);
  assert.equal(once.split(MARK).length - 1, 1);
});

test('formato inesperado: falha alto em vez de gerar um APK assinado com a chave de debug sem aviso', () => {
  assert.throws(() => addReleaseSigning('android { }'), /signingConfigs/);
});
