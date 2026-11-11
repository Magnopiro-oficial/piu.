#!/usr/bin/env bash
# Gera o APK de release do Piu e confere que ele só tem arm64-v8a.
# A chave vem das variáveis PIU_RELEASE_STORE_FILE e PIU_RELEASE_STORE_PASSWORD
# (ver docs/distribuicao/publicar-0.1.5.md, passo 1). Argumentos extras vão para o Gradle.
# Uso, em apps/mobile: scripts/build-apk.sh
set -euo pipefail

mobile="$(cd "$(dirname "$0")/.." && pwd)"
gradle_app="$mobile/android/app/build.gradle"
apk="$mobile/android/app/build/outputs/apk/release/app-release.apk"

# Sem a trava do plugin withReleaseAbi no projeto gerado, o release pode levar outras ABIs.
if ! grep -qF '// piu: release só com arm64-v8a' "$gradle_app" 2>/dev/null; then
  echo "build-apk: $gradle_app sem a trava de arm64-v8a. Rode antes: npx expo prebuild --platform android" >&2
  exit 1
fi

# O prebuild não gera local.properties: sem ANDROID_HOME o Gradle não acha o SDK.
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

# APK velho não pode passar pela conferência no lugar do novo.
rm -f "$apk"

(cd "$mobile/android" && ./gradlew assembleRelease "$@")

if ! "$mobile/scripts/check-apk-abi.sh" "$apk"; then
  mv -f "$apk" "${apk%.apk}-REPROVADO.apk"
  echo "build-apk: APK renomeado para ${apk%.apk}-REPROVADO.apk" >&2
  exit 1
fi

echo "build-apk: APK pronto em $apk"
