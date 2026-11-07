# Flatpak (Flathub) do Piu Desktop

ID: `io.github.Magnopiro_oficial.Piu`. O manifesto reaproveita o `.deb` do release `desktop-v*`
(conferido pelo SHA-256) e roda o Electron com o zypak da `org.electronjs.Electron2.BaseApp`.
O CI `.github/workflows/ci-flatpak.yml` monta, passa o linter do Flathub e instala o app.

## Antes de enviar ao Flathub
1. **Repositório do ID.** `io.github.Magnopiro_oficial.Piu` aponta para `github.com/Magnopiro-oficial/piu`
   (sem o ponto final, que um ID não aceita). Crie esse repositório público, nem que seja só com um README
   apontando para `piu.`. Enquanto ele não existir, o linter acusa `appid-url-not-reachable`.
2. **Capturas de tela.** Acrescente `<screenshots>` no metainfo com imagens PNG por URL pública
   (por exemplo, arquivos commitados aqui, por `raw.githubusercontent.com`).
3. **Pedido.** Fork de `flathub/flathub`, branch a partir de `new-pr`, com estes arquivos na raiz, e PR para `new-pr`.

## Nova versão
Troque `url` e `sha256` do `.deb` no `.yml` e acrescente um `<release>` no metainfo.
