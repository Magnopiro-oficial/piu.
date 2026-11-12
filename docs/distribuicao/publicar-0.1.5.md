# Publicar: Piu 0.1.5 (Android), Piu Desktop 0.1.4 e Piu Node 0.1.2

Roteiro para o dono do projeto. Escrito em 11/11/2026. Os comandos foram conferidos nos scripts e workflows do repositório. Onde não existe script, está dito.

O que só você pode fazer: digitar a senha da chave do APK, testar no aparelho, publicar os rascunhos no GitHub e entrar nas contas do Uptodown e do Aptoide. Nenhum agente faz esses passos.

Versões desta rodada:

| Produto | Versão | Tag |
|---|---|---|
| Piu para Android | 0.1.5 (versionCode 6) | `android-v0.1.5` |
| Piu Desktop | 0.1.4 | `desktop-v0.1.4` |
| Piu Node | 0.1.2 | `node-v0.1.2` |

O Piu Provider não mudou e continua em 0.1.4 (rascunho `provider-v0.1.4`).

## 0. Antes de tudo: o código precisa estar na `main`

As correções estão no ramo `fix/auditoria-2026-11-09-medios` e ainda não foram commitadas. As tags só valem depois que o commit com as versões novas estiver na `main` do GitHub.

1. Revise e faça o commit das mudanças.
2. Leve o ramo para a `main` (por PR ou merge) e envie.

   Aviso: a checagem "CI · flatpak" (`.github/workflows/ci-flatpak.yml`, nova neste commit) vai ficar vermelha no PR e na `main`. Ela roda sempre que `apps/desktop/package.json` muda e hoje falha por dois motivos: o `packaging/flatpak/io.github.magnopiro_oficial.Piu.metainfo.xml` tem a 0.1.2 como versão mais nova (faltam os blocos `<release>` da 0.1.3 e da 0.1.4) e as capturas ainda têm o marcador `__COMMIT__`. Já falhava antes desta rodada (0.1.2 contra 0.1.3). Ela não é gatilho de nenhum workflow de release e não mexe no APK nem nos instaladores, e a `main` não tem proteção de ramo hoje (conferido em 11/11 com `gh api repos/Magnopiro-oficial/piu./branches/main/protection`), então o merge não trava. Só não confunda esse vermelho com falha das outras checagens. Para conferir no seu computador:

   ```bash
   node packaging/flatpak/check.mjs
   ```

   Para ficar verde é preciso acrescentar os dois blocos `<release>` no metainfo e trocar `__COMMIT__` pelo hash do commit que trouxe as capturas (esse hash só existe depois do commit). Ver o item Flathub nas Pendências.
3. No seu computador:

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu
git checkout main
git pull --ff-only
```

4. Confira as versões (devem aparecer 0.1.5 e 6, 0.1.4, 0.1.2 e 0.1.2):

```bash
grep -n '"version"\|versionCode' apps/mobile/app.json
grep -n '"version"' apps/desktop/package.json apps/piu-node/package.json
grep -n '^PKG_VERSION' packaging/openwrt/Makefile
```

5. Rode os testes do celular (lista do `docs/distribuicao/checklist.md`, item 2):

```bash
cd apps/mobile
npm test
npx tsc --noEmit
```

## 1. Android: gerar o APK com a sua senha

Não existe workflow que gere o APK. O build é feito no seu computador pelo script `apps/mobile/scripts/build-apk.sh`, que roda o Gradle do projeto Android (`apps/mobile/android`) e confere o APK no fim. A pasta `android` é gerada pelo Expo e não vai para o git.

1. Se o `app.json` ou os plugins mudaram desde o último build, gere a pasta de novo (comando citado em `docs/testes/roteiro-aparelhos.md`):

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu/apps/mobile
npx expo prebuild --platform android
```

2. Confira que o projeto Android está na versão certa (deve mostrar `versionCode 6` e `versionName "0.1.5"`):

```bash
grep -n 'versionCode\|versionName' android/app/build.gradle
```

3. Digite a senha no terminal, sem que ela apareça na tela nem fique no histórico. Depois do primeiro comando, digite a senha e aperte Enter:

```bash
read -rs PIU_RELEASE_STORE_PASSWORD
export PIU_RELEASE_STORE_PASSWORD
export PIU_RELEASE_STORE_FILE="$HOME/piu-release-key/piu-release.jks"
```

4. Gere o APK:

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu/apps/mobile
scripts/build-apk.sh
```

Não acrescente `-PreactNativeArchitectures=...` nem use `npx expo run:android` para o APK oficial.

Sem as duas variáveis, o build falha de propósito (`apps/mobile/plugins/releaseSigningGradle.js`). Isso evita um APK assinado com a chave de teste.

O script também para com erro se o APK tiver bibliotecas fora de `lib/arm64-v8a/` (a 0.1.4 saiu com `lib/x86_64/`). Nesse caso ele renomeia o arquivo para `app-release-REPROVADO.apk`: não publique. Ele para antes de compilar se o `android/` foi gerado sem a trava (`apps/mobile/plugins/withReleaseAbi.js`); rode o passo 1.1 de novo.

5. Copie o APK para fora do repositório, com o nome que o site e o app esperam (`Piu-0.1.5.apk`), e confira de novo, à mão, que não há outra arquitetura (o `grep` não pode mostrar nada):

```bash
mkdir -p ~/piu-release-0.1.5
cp android/app/build/outputs/apk/release/app-release.apk ~/piu-release-0.1.5/Piu-0.1.5.apk
unzip -l ~/piu-release-0.1.5/Piu-0.1.5.apk | grep -E 'lib/(x86|x86_64|armeabi-v7a)/'
```

6. Confira a assinatura. O `apksigner` não está no PATH deste computador; ele fica na pasta do Android SDK:

```bash
~/Library/Android/sdk/build-tools/37.0.0/apksigner verify --print-certs ~/piu-release-0.1.5/Piu-0.1.5.apk
```

O resultado precisa mostrar `O=piu.` e este SHA-256 do certificado:

```
595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31
```

Se aparecer outro valor, pare. Esse APK não pode ser publicado.

7. Anote o SHA-256 do arquivo e gere a lista de hashes (mesmo formato do release 0.1.3):

```bash
cd ~/piu-release-0.1.5
shasum -a 256 Piu-0.1.5.apk > SHA256SUMS.txt
cat SHA256SUMS.txt
```

8. Feche o terminal quando terminar, para a senha sair da memória dele.

## 2. Android: instalar e testar no aparelho

Instale por cima da versão que já está no celular, para conferir que conversas, contatos e carteira continuam. Se um dos celulares ainda estiver na 0.1.3 (a última versão pública), melhor: é o caminho que o público vai fazer. O `adb` também fica na pasta do SDK:

```bash
~/Library/Android/sdk/platform-tools/adb install -r ~/piu-release-0.1.5/Piu-0.1.5.apk
```

Teste nos dois celulares (Galaxy A31 e Poco). Esta versão tirou partes do app para ele ficar menor e mexeu em segurança, então os pontos abaixo são os que mais podem ter quebrado:

- [ ] **Abrir o app** depois de atualizar por cima: conversas, contatos e carteira continuam.
- [ ] **Navegação**: passar por todas as abas, abrir uma conversa, voltar com o gesto e com o botão, abrir Perfil e as telas dentro dele. Nenhuma tela em branco, nenhum travamento.
- [ ] **Chamada de voz** entre os dois celulares: com o app aberto, em segundo plano e com a tela bloqueada. Atender, recusar e desligar. O som vai nos dois sentidos. O fundo animado da tela de chamada aparece.
- [ ] **Leitura de QR**: convite de contato, vínculo com o computador (Aparelhos) e pareamento com um Piu Node. No Piu Node, o app agora pede confirmação antes de parear.
- [ ] **Envio de foto em "Original"**: mande uma foto tirada com a câmera, com a localização ligada na câmera. A foto chega em pé (não deitada), com boa qualidade, e o nome do arquivo é neutro (`foto-AAAA-MM-DD`). Se puder, abra o arquivo recebido num leitor de EXIF e confira que não tem GPS.
- [ ] **Carteira**: ver saldo, esconder saldo, enviar um valor pequeno e ver o envio aparecer como confirmado.
- [ ] **Bloqueio do app**: ligar o bloqueio, sair e voltar. O app pede a digital ou a senha do aparelho. Com o bloqueio ligado, a captura de tela é recusada. Uma mensagem que chega com o app bloqueado conta como não lida.
- [ ] **Apagar dados locais** (Perfil → "Apagar dados locais"): faça num celular de teste. Depois de apagar, o app volta para a tela inicial, sem conversa, contato nem carteira.
- [ ] **Avisos do sistema no idioma do app**: troque o idioma e veja uma conversa com avisos (por exemplo, chamada perdida). Os avisos aparecem no idioma escolhido.
- [ ] O resto da lista do `docs/distribuicao/checklist.md`, item 3 (notificação com o app fechado, mensagens sem internet, envio do app por Bluetooth).

Se algo falhar, não publique. Anote o que falhou e em qual aparelho.

## 3. Android: tag e release

Não existe workflow para o Android. A tag e o release são criados à mão. Os comandos abaixo usam as mesmas opções do `gh` que os workflows do Desktop e do Node usam (`--draft --verify-tag`).

1. Crie e envie a tag, a partir da `main` atualizada:

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu
git tag android-v0.1.5
git push origin android-v0.1.5
```

2. Escreva o texto do release num arquivo, por exemplo `~/piu-release-0.1.5/notas.md`. Use o rascunho `android-v0.1.4` como modelo (Instalar, Conferir a cópia com os dois SHA-256, Nesta versão), trocando 0.1.4 por 0.1.5 e o SHA-256 do arquivo pelo que você anotou no passo 1.7. Para ver o modelo:

```bash
gh release view android-v0.1.4 -R Magnopiro-oficial/piu.
```

   Atenção em "Nesta versão": a 0.1.4 nunca foi publicada (é rascunho). A última versão pública é a 0.1.3, então quem atualiza vem dela. O texto precisa ter as duas partes:

   - as novidades da 0.1.5: `apps/mobile/fastlane/metadata/android/pt-BR/changelogs/6.txt`;
   - as novidades da 0.1.4, que o público ainda não recebeu (chamada de voz, rádio LoRa, Mapa da rede e o resto): a seção "Nesta versão" do rascunho `android-v0.1.4`, ou o resumo em `apps/mobile/fastlane/metadata/android/pt-BR/changelogs/5.txt`.

3. Crie o release em rascunho, com o APK e a lista de hashes:

```bash
cd ~/piu-release-0.1.5
gh release create android-v0.1.5 Piu-0.1.5.apk SHA256SUMS.txt \
  -R Magnopiro-oficial/piu. --draft --verify-tag \
  --title "Piu 0.1.5 para Android" --notes-file notas.md
```

4. Abra o rascunho no GitHub, confira o arquivo e o texto, e publique (botão "Publish release"). Quem tem o Piu instalado só recebe o aviso de versão nova depois que o release é publicado. Rascunho não avisa ninguém.

Sobre o rascunho antigo `android-v0.1.4`: ele nunca foi publicado e a 0.1.5 o substitui. Apagar ou não esse rascunho é decisão sua. Não o publique depois da 0.1.5.

## 4. Piu Desktop 0.1.4 e Piu Node 0.1.2: tags que disparam os workflows

As duas tags disparam o build no GitHub e criam um release em rascunho cada.

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu
git tag desktop-v0.1.4
git push origin desktop-v0.1.4
git tag node-v0.1.2
git push origin node-v0.1.2
```

- `desktop-v0.1.4` roda "Release · Piu Desktop" (`.github/workflows/release-desktop.yml`). Gera `.dmg` e `.zip` (Mac Intel e Mac M), `.AppImage` e `.deb` (Linux), `.exe` (Windows) e `SHA256SUMS.txt`.
- `node-v0.1.2` roda "Release · Piu Node" (`.github/workflows/release-node.yml`). Gera o `.ipk` (OpenWrt), o `.deb` e `SHA256SUMS.txt`. Esse workflow falha se a versão em `apps/piu-node/package.json` não for 0.1.2.

Para acompanhar:

```bash
gh run list -R Magnopiro-oficial/piu. --limit 5
gh release list -R Magnopiro-oficial/piu. --limit 8
```

Quando os dois rascunhos aparecerem:

1. Abra cada rascunho no GitHub e confira que todos os arquivos e o `SHA256SUMS.txt` estão lá.
2. Baixe e teste pelo menos o instalador do seu sistema: abrir o Piu Desktop, vincular ao celular por QR, trocar uma mensagem e fazer uma chamada com o celular.
3. Publique cada rascunho (botão "Publish release").

O Mac sai sem notarização e o Windows sem assinatura. O texto do release já avisa como abrir. Detalhes em `docs/distribuicao/assinatura.md`.

Sobre o rascunho antigo `node-v0.1.1`: nunca foi publicado e a 0.1.2 o substitui. A decisão de apagar é sua.

## 5. Site: atualizar os downloads

Só depois de **publicar** os três releases. O script lê apenas releases publicados; rascunho aparece no site como "em breve".

```bash
cd /Users/lucas/Documents/Projetos_DEV/piu/apps/site
node scripts/sync-release.mjs --android android-v0.1.5 --desktop desktop-v0.1.4 --node node-v0.1.2
npm run build
```

O script confere cada hash com o `SHA256SUMS.txt` do release e grava `src/lib/releases.json`. Se algo não bater, ele para sem gravar. Para só ver o resultado, sem gravar, acrescente `--dry-run`.

Depois, faça o commit do `apps/site/src/lib/releases.json` e envie para a `main`. O envio dispara `.github/workflows/pages-site.yml`, que publica o site.

Confira no site: o botão de baixar aponta para `Piu-0.1.5.apk`, o SHA-256 é o que você anotou no passo 1.7, e o Desktop e o Node mostram as versões novas.

## 6. Uptodown e Aptoide

Feito por você, logado na sua conta de desenvolvedor (`docs/distribuicao/lojas.md`). Não há script.

Em cada loja:

1. Envie o mesmo arquivo `~/piu-release-0.1.5/Piu-0.1.5.apk` que foi para o GitHub.
2. Em "Novidades", cole o texto de:
   - português: `apps/mobile/fastlane/metadata/android/pt-BR/changelogs/6.txt`
   - inglês: `apps/mobile/fastlane/metadata/android/en-US/changelogs/6.txt`

   Antes, veja no painel da loja qual foi a última versão enviada. Se a loja não recebeu a 0.1.4, as novidades dela também são novas para quem baixa por lá: junte o texto de `changelogs/5.txt` (mesmas pastas) ao de `6.txt`. Os dois juntos passam de 500 caracteres; se o campo da loja tiver esse limite, encurte o trecho da 0.1.4 (por exemplo, só chamada de voz, rádio LoRa e Mapa da rede).
3. Os outros campos da ficha (nome, descrição, ícone, capturas) estão em `apps/mobile/fastlane/metadata/android/pt-BR/` e `en-US/`.

O estado atual das fichas nas duas lojas não está registrado no repositório. Confira no painel de cada uma.

## 7. Pendências (não travam esta publicação)

- **Assinatura GPG dos releases.** O script `scripts/sign-release.sh <tag>` existe, mas hoje ele para logo no começo: falta o arquivo `docs/distribuicao/piu-release.fpr` com a impressão digital da chave, e a chave GPG do projeto ainda precisa ser criada por você. Quando existir, o uso é `scripts/sign-release.sh desktop-v0.1.4` (e o mesmo para `node-v0.1.2`). A senha da chave é pedida pelo próprio `gpg`.
- **Flathub.** Ainda não foi enviado. O conferidor `packaging/flatpak/check.mjs` falha hoje: o `metainfo.xml` tem a 0.1.2 como versão mais nova (faltam os blocos da 0.1.3 e da 0.1.4) e as capturas de tela ainda têm o marcador `__COMMIT__`. O manifesto e o pedido precisam ser escritos por uma pessoa. Ver `docs/distribuicao/flathub.md`.
- **Certificados do Mac e do Windows.** Ainda não existem. Ver `docs/distribuicao/assinatura.md`.
- **Google Play e App Store.** Nada feito. Ver `docs/distribuicao/checklist.md`, item 4.
- **Arquivo `Piu-0.1.4-teste.apk` na raiz do repositório.** O git já o ignora. Mova-o para fora da pasta do projeto.
