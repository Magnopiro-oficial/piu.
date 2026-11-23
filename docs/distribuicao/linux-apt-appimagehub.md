# Linux: repositório apt e AppImageHub

Duas portas de entrada para quem usa Linux:

1. **Repositório apt do próprio Piu**, servido pelo GitHub Pages em
   `https://magnopiro-oficial.github.io/piu./apt`. Quem adiciona uma vez recebe as versões novas com
   `sudo apt upgrade`. Pacotes: `piu` (Piu Desktop), `piu-node` (Piu Node) e `piu-provider-desktop`
   (Piu Provider para computador).
2. **AppImageHub** (https://appimage.github.io), o catálogo de AppImages. Ele aponta para o AppImage
   do Piu Desktop que já está nos releases do GitHub.

---

## 1. Repositório apt

### O que você faz uma única vez

Precisa de um computador com `gpg` e `gh` (GitHub CLI) logado como dono do repositório. Faça num
diretório temporário, para a chave não se misturar com as suas:

```sh
export GNUPGHOME="$(mktemp -d)"

# 1. Gerar a chave do repositório apt (o gpg pede uma senha; pode deixar em branco).
#    Validade de 5 anos: antes de vencer, veja "Quando a chave estiver perto de vencer".
gpg --quick-gen-key "Piu apt <piu-apt@users.noreply.github.com>" ed25519 sign 5y

# 2. Anotar a impressão digital (40 letras e números).
FPR=$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr:/ {print $10; exit}')
echo "$FPR"

# 3. Guardar a chave privada como secret do repositório.
gpg --armor --export-secret-keys "$FPR" | gh secret set APT_GPG_PRIVATE_KEY -R Magnopiro-oficial/piu.

# 4. Só se você pôs senha no passo 1:
gh secret set APT_GPG_PASSPHRASE -R Magnopiro-oficial/piu.     # o gh pede a senha

# 5. Cópia de segurança, fora do computador (pen drive guardado, cofre de senhas):
#    a chave privada e o certificado de revogação que o gpg criou sozinho.
gpg --armor --export-secret-keys "$FPR" > piu-apt-privada.asc
cp "$GNUPGHOME"/openpgp-revocs.d/"$FPR".rev piu-apt-revogacao.rev
#    Guarde os dois arquivos e depois apague daqui:
rm -rf "$GNUPGHOME"; unset GNUPGHOME
```

Depois, em **Actions → Site · GitHub Pages → Run workflow** (ou espere a próxima rodada diária).
No fim, abra `https://magnopiro-oficial.github.io/piu./apt/FINGERPRINT` e confira que é a mesma
impressão digital do passo 2.

Nomes usados: **`APT_GPG_PRIVATE_KEY`** (obrigatório) e **`APT_GPG_PASSPHRASE`** (opcional).

Esta chave é só do apt. Ela fica no GitHub (o workflow precisa dela para assinar sozinho), por isso
não use a mesma chave com que você assina os releases no seu computador (`scripts/sign-release.sh`).

### O que fica automático

O workflow `.github/workflows/pages-site.yml` roda a cada mudança no site, todo dia às 09:23 UTC e
quando você aperta "Run workflow". O job **Repositório apt** (`apps/site/scripts/apt-repo.mjs`):

1. lista os releases do GitHub e pega, de cada produto, o release **publicado** mais novo que tem `.deb`
   (rascunhos e pré-releases ficam de fora): `desktop-v*`, `provider-v*` e `node-v*`;
2. baixa o `.deb` e o `SHA256SUMS.txt` de cada um e confere o SHA-256 com a lista e com o digest que
   o GitHub mostra. Qualquer diferença para tudo: nada é publicado e o site anterior continua no ar;
3. gera a árvore apt com `apt-ftparchive` (suite `stable`, componente `main`, arquiteturas `amd64` e
   `all`);
4. assina `Release` (gera `InRelease` e `Release.gpg`), publica a chave pública
   (`piu-archive-keyring.gpg` e `.asc`) e confere as assinaturas com `gpgv`, como o apt fará;
5. o job do site copia tudo para `/apt/` e a página de download passa a mostrar as instruções do apt,
   com a impressão digital da chave (em português e em inglês).

A chave nunca fica no mesmo job que roda `npm ci` (código de terceiros): o job do apt não instala
dependências e só entrega a pasta pronta para o job do site.

**Sem o secret**, o site continua sendo publicado normalmente; o job do apt mostra um aviso amarelo
("Repositório apt pulado") e a página de download não mostra as instruções do apt.

Lançou versão nova? Publique o release (não deixe como rascunho) com o `.deb` e o `SHA256SUMS.txt`.
O apt pega na rodada diária seguinte; para ser na hora, "Run workflow".

### O que aparece para quem instala

```sh
sudo install -d -m 0755 /etc/apt/keyrings && curl -fsSL https://magnopiro-oficial.github.io/piu./apt/piu-archive-keyring.gpg | sudo tee /etc/apt/keyrings/piu.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/piu.gpg] https://magnopiro-oficial.github.io/piu./apt stable main" | sudo tee /etc/apt/sources.list.d/piu.list
sudo apt update && sudo apt install piu          # ou piu-node, ou piu-provider-desktop
```

`piu` e `piu-provider-desktop` são só para x86_64 (amd64). `piu-node` é `all`: num Raspberry Pi o apt
lê o índice `binary-all` e instala também (precisa de `nodejs` 20.19 ou mais novo).

### Limites do GitHub Pages (atenção)

- O site inteiro pode ter até **1 GB**. Hoje os três `.deb` somam uns 210 MB; o script avisa acima de
  700 MB. Só a versão mais nova de cada produto fica no apt.
- O Pages tem um limite **flexível de 100 GB de tráfego por mês**. Cada instalação do Piu Desktop baixa
  ~100 MB, ou seja, umas 900 instalações/atualizações por mês. Se passar disso com folga, o GitHub pode
  pedir para mudar; aí o caminho é levar o `/apt/` para outro lugar (o script já gera a pasta pronta).
- Agendamentos do GitHub param sozinhos depois de 60 dias sem nenhum commit no repositório; nesse caso,
  "Run workflow" à mão ou reative em Actions.

### Quando a chave estiver perto de vencer

Recupere a cópia de segurança, estenda a validade e atualize o secret:

```sh
export GNUPGHOME="$(mktemp -d)"
gpg --import piu-apt-privada.asc
gpg --quick-set-expire <IMPRESSÃO_DIGITAL> 5y
gpg --armor --export-secret-keys <IMPRESSÃO_DIGITAL> | gh secret set APT_GPG_PRIVATE_KEY -R Magnopiro-oficial/piu.
```

Quem já instalou precisa baixar a chave de novo (o primeiro comando da lista acima), porque o arquivo
em `/etc/apt/keyrings` guarda a validade antiga.

---

## 2. AppImageHub

### Regras (lidas em 13/11/2026 no README de AppImage/appimage.github.io)

- O PR adiciona **um único arquivo** em `data/`, com **uma linha**: o endereço do repositório
  (preferido), de uma pasta de downloads ou do próprio AppImage. No fim do endereço pode ir
  `#palavra` para escolher um "canal".
- O nome do arquivo é o nome do app no `.desktop` (`Name=Piu`), sem versão, arquitetura nem extensão:
  `data/Piu`. Não existe nenhuma entrada parecida hoje.
- O AppImage precisa: baixar sem login; ser do tipo 2 (SquashFS); rodar na versão mais antiga do
  Ubuntu LTS ainda suportada (o teste roda em `ubuntu-22.04`); passar no `appdir-lint.sh` (um único
  `.desktop` válido no `desktop-file-validate`, com `Icon` e `Categories`, e `.DirIcon`); abrir sem
  internet e mostrar a janela principal em até 30 s, em inglês, no X11; tema claro, a não ser que o
  sistema peça escuro. AppStream (`usr/share/metainfo/*.appdata.xml`) é recomendado, não obrigatório.

### O arquivo proposto: `packaging/appimagehub/Piu`

```
https://github.com/Magnopiro-oficial/piu.#desktop
```

Por que o `#desktop`: o repositório publica Android, Desktop, Provider e Node. Sem canal, o teste pega
o release mais novo que tenha qualquer AppImage, e um dia pode ser o do Piu Provider. Com `#desktop`,
só valem releases cuja tag (`desktop-v…`) tem a palavra "desktop". Assim a entrada acompanha sozinha
as versões novas do Piu Desktop, sem mudar o arquivo. (Conferido rodando o `find-appimage.sh` deles
contra os releases de verdade.)

### Como enviar (você, pela sua conta)

1. Fork de https://github.com/AppImage/appimage.github.io.
2. Crie `data/Piu` com o conteúdo de `packaging/appimagehub/Piu` (uma linha, com quebra de linha no fim).
3. Abra o PR com o texto abaixo. O robô deles testa, comenta com uma captura de tela e dá o rótulo
   `screenshot-ok` quando passa. Se falhar, ele diz o motivo; depois de corrigir num release novo,
   comente `/retest`.

Texto do PR:

> **Add Piu**
>
> Piu is a decentralized messenger that works without internet: messages hop between nearby devices
> over Bluetooth, local Wi-Fi and radio, end-to-end encrypted. Piu Desktop pairs with the Android app
> or creates its own identity.
>
> - Upstream: https://github.com/Magnopiro-oficial/piu. (AGPL-3.0)
> - I am the maintainer of the project.
> - The repository publishes several products (Android, Desktop, Provider, Node) as separate releases,
>   so the entry uses the `#desktop` channel: only `desktop-v*` releases are considered, and the
>   AppImage is `Piu-<version>-linux-x86_64.AppImage`.

### O que o AppImage atual (desktop-v0.1.4) passa e o que falta

Veja o resultado do teste local no fim deste documento. O que não dá para provar daqui é o
teste real deles (roda no GitHub Actions deles, com firejail e sem rede).

---

## Como foi testado (13/11/2026)

<!-- preenchido com as saídas do laboratório -->
