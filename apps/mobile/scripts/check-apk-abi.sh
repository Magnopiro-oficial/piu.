#!/usr/bin/env bash
# Confere que o APK só tem bibliotecas nativas de arm64-v8a (lib/arm64-v8a/).
# Sai com erro se aparecer outra pasta em lib/ (x86_64, x86, armeabi-v7a...) ou se não houver lib/.
# Uso: scripts/check-apk-abi.sh caminho/do.apk
set -euo pipefail

apk="${1:?uso: check-apk-abi.sh caminho/do.apk}"
if [ ! -f "$apk" ]; then
  echo "check-apk-abi: APK não encontrado: $apk" >&2
  exit 2
fi

if ! lista="$(unzip -l "$apk")"; then
  echo "check-apk-abi: unzip -l falhou em $apk" >&2
  exit 2
fi

# Coluna 4 do unzip -l é o nome; as pastas de ABI ficam em lib/<abi>/.
abis="$(printf '%s\n' "$lista" | awk '$4 ~ /^lib\// { split($4, p, "/"); print p[2] }' | sort -u)"

if [ -z "$abis" ]; then
  echo "check-apk-abi: $apk não tem nenhuma biblioteca em lib/ (esperado lib/arm64-v8a/)" >&2
  exit 1
fi

outras="$(printf '%s\n' "$abis" | grep -vx 'arm64-v8a' || true)"
if [ -n "$outras" ]; then
  echo "check-apk-abi: REPROVADO. $apk tem lib/ fora de arm64-v8a:" >&2
  printf '  lib/%s/\n' $outras >&2
  echo "Esse APK não pode ser publicado. Ver 'Tamanho do APK' em docs/distribuicao/checklist.md." >&2
  exit 1
fi

echo "check-apk-abi: ok, só lib/arm64-v8a/ em $apk"
