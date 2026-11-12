#!/usr/bin/env bash
# Assina um release do GitHub com a chave GPG do projeto, NO COMPUTADOR DE QUEM PUBLICA.
# A chave privada nunca vai para o CI: o workflow só gera os instaladores e o SHA256SUMS.txt
# (rascunho); este script baixa tudo, confere cada hash, assina e envia as assinaturas.
#
#   scripts/sign-release.sh desktop-v0.1.0
#
# Gera e anexa ao release:
#   SHA256SUMS.txt.asc   assinatura da lista de hashes (cobre todos os arquivos, inclusive Mac e Windows)
#   <pacote>.asc         assinatura avulsa de cada .deb e .AppImage (costume no Linux)
#
# A chave é a de docs/distribuicao/piu-release.fpr (impressão digital), ou PIU_GPG_KEY.
# A senha da chave é pedida pelo próprio gpg (pinentry); o script nunca a vê.
set -euo pipefail

TAG="${1:?uso: scripts/sign-release.sh <tag>  (ex.: desktop-v0.1.0)}"
REPO="${PIU_REPO:-Magnopiro-oficial/piu.}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${PIU_GPG_KEY:-$(tr -d ' \n' < "$ROOT/docs/distribuicao/piu-release.fpr" 2>/dev/null || true)}"

for cmd in gh gpg; do command -v "$cmd" >/dev/null || { echo "Falta o comando '$cmd'." >&2; exit 1; }; done
[[ "$KEY" =~ ^[0-9A-Fa-f]{40}$ ]] || { echo "Impressão digital da chave inválida ou ausente (docs/distribuicao/piu-release.fpr ou PIU_GPG_KEY)." >&2; exit 1; }
gpg --list-secret-keys "$KEY" >/dev/null 2>&1 || { echo "A chave privada $KEY não está neste computador." >&2; exit 1; }
if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/piu-sign.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

echo "Baixando os arquivos de $TAG…"
gh release download "$TAG" --repo "$REPO" --pattern '*' --dir .
rm -f -- *.asc
[[ -f SHA256SUMS.txt ]] || { echo "O release não tem SHA256SUMS.txt." >&2; exit 1; }

echo "Conferindo os hashes…"
"${SHA[@]}" -c SHA256SUMS.txt
# Nada no release pode ficar fora da lista assinada.
for f in *; do
  [[ "$f" == SHA256SUMS.txt ]] && continue
  grep -qF "  $f" SHA256SUMS.txt || { echo "Arquivo fora do SHA256SUMS.txt: $f" >&2; exit 1; }
done

# A assinatura atesta o que está no release; os hashes vieram do mesmo release (gerados pelo CI).
# Confira-os por outro canal (build local/reprodutível) antes de assinar. PIU_SIGN_YES=1 pula a pergunta.
echo "Hashes que serão assinados (SHA256SUMS.txt):"
cat SHA256SUMS.txt
if [[ "${PIU_SIGN_YES:-}" != 1 ]]; then
  [[ -t 0 ]] || { echo "Sem terminal para confirmar. Rode de forma interativa (ou PIU_SIGN_YES=1)." >&2; exit 1; }
  read -r -p "Esses hashes conferem com um build local/reprodutível? Assinar? [s/N] " ans
  [[ "$ans" =~ ^[sSyY]$ ]] || { echo "Cancelado, nada foi assinado." >&2; exit 1; }
fi

echo "Assinando com $KEY…"
sign() { gpg --yes --local-user "$KEY" --armor --detach-sign --output "$1.asc" -- "$1"; gpg --verify "$1.asc" "$1"; }
sign SHA256SUMS.txt
shopt -s nullglob
for f in *.deb *.AppImage; do sign "$f"; done

echo "Enviando as assinaturas para o release…"
gh release upload "$TAG" --repo "$REPO" --clobber -- *.asc
echo "Pronto. Assinaturas anexadas a $TAG:"; ls -1 -- *.asc
