# winget (loja de linha de comando do Windows)

O winget é o instalador de programas que já vem no Windows 10 e 11. Com o Piu lá, qualquer pessoa instala com um comando:

```
winget install LunesNetwork.Piu
```

e recebe as versões novas com `winget upgrade --all`. O winget não hospeda o programa: ele baixa o mesmo instalador `.exe` do release do GitHub e confere o SHA-256 antes de instalar.

## Como funciona

- O catálogo do winget é um repositório público da Microsoft no GitHub (`microsoft/winget-pkgs`). Cada versão do Piu é uma pasta com 4 arquivos de texto (manifestos) que dizem o nome, a descrição, o link do instalador e o hash dele.
- Uma versão entra no catálogo por um pedido de alteração (PR) nesse repositório. Um robô da Microsoft baixa o instalador, instala numa máquina de teste e confere tudo; depois uma pessoa da equipe do winget aprova. Leva de algumas horas a alguns dias.
- Os manifestos da primeira versão estão prontos neste repositório, em `packaging/winget/manifests/`:
  - `l/LunesNetwork/Piu/0.1.4/`: Piu Desktop 0.1.4.
  - `l/LunesNetwork/PiuProvider/0.1.3/`: Piu Provider 0.1.3 (ver "Piu Provider" abaixo antes de enviar).

## O que você faz uma única vez

### 1. Enviar a primeira versão (PR manual)

O primeiro envio é manual porque a automação só atualiza pacotes que já existem no catálogo. Quem envia copia a pasta `packaging/winget/manifests/l/LunesNetwork/Piu/0.1.4/` para o mesmo caminho dentro de `manifests/` num fork do `microsoft/winget-pkgs` e abre o PR. Um PR por pacote e por versão; nada além dos 4 arquivos.

### 2. Aceitar o CLA da Microsoft

No primeiro PR, um robô (`microsoft-github-policy-service`) comenta pedindo que você aceite o Contributor License Agreement (CLA), o termo que permite à Microsoft publicar sua contribuição. Basta responder no próprio PR com o comentário:

```
@microsoft-github-policy-service agree company="Lunes Network"
```

(Sem `company=...` se você envia em nome próprio.) Vale para todos os PRs futuros dessa conta do GitHub. Sem isso o PR não anda.

### 3. Criar o token para a automação

Depois que a primeira versão for aceita, crie um token para o GitHub abrir os próximos PRs sozinho:

1. Faça um fork de https://github.com/microsoft/winget-pkgs na organização `Magnopiro-oficial` (botão Fork). Se preferir na sua conta pessoal, crie também a variável `WINGET_FORK_USER` (passo 3 abaixo) com o nome da sua conta.
2. Em GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic):
   - Nome: `winget piu`.
   - Validade: 1 ano (anote para renovar).
   - Escopos: marque **`public_repo`** e **`workflow`**. Nada mais.
   - O tipo "fine-grained" não funciona com essa automação; tem que ser o clássico.
3. No repositório do Piu: Settings → Secrets and variables → Actions → **New repository secret**: nome `WINGET_TOKEN`, valor = o token.

O token permite escrever em repositórios públicos da sua conta. Ele fica guardado cifrado no GitHub e só é usado pelo workflow `Publicar · winget`. Se vazar, apague-o em Developer settings e crie outro.

## O que é automático

Toda vez que você **publica** um release `desktop-v*` (o rascunho que o workflow de release cria), o workflow `.github/workflows/publish-winget.yml`:

1. Lê a versão pela tag (`desktop-v0.1.5` → `0.1.5`).
2. Usa a action `vedantmgoyal9/winget-releaser` para gerar os manifestos novos a partir dos da versão anterior, com o link e o hash do novo `Piu-<versão>-win-x64.exe`.
3. Abre o PR no `microsoft/winget-pkgs` pelo seu fork. Você só acompanha; não precisa fazer nada se o robô aprovar.

Ele não faz nada (e termina sem erro) quando:
- o secret `WINGET_TOKEN` não existe (aparece só um aviso amarelo no Actions);
- o release é pré-release;
- a tag é de outro app (Android, Node).

Para reenviar uma versão já publicada: Actions → "Publicar · winget" → Run workflow → informe a tag (ex.: `desktop-v0.1.5`).

## Aviso do SmartScreen (instalador sem assinatura)

O instalador do Piu para Windows ainda não tem assinatura digital (certificado de código). Por isso:
- quem baixa o `.exe` pelo navegador vê o aviso azul "O Windows protegeu o computador" e precisa clicar em **Mais informações → Executar assim mesmo**;
- pelo winget o aviso do navegador em geral não aparece (o winget baixa o arquivo e confere o hash antes de rodar), mas isso não foi testado aqui e não é garantido. O antivírus (Defender) continua verificando o arquivo normalmente;
- o robô de validação do winget também roda o Defender no instalador. Programas sem assinatura são aceitos, mas se o Defender acusar algo o PR fica parado até a equipe do winget revisar.

A assinatura liga sozinha nos próximos releases quando os secrets de certificado existirem (ver `docs/distribuicao/assinatura.md`). Nada muda no winget: a automação pega o instalador novo, assinado ou não.

## Piu Provider

Os manifestos do Provider 0.1.3 estão prontos, mas recomendo **não enviar ainda**:
- o `apps/provider-desktop/electron-builder.yml` não define `appId`. Quando ele for definido, o Windows passa a ver o Provider como outro programa (o registro de desinstalação muda), e quem instalou pelo winget ficaria com duas cópias;
- o README do Provider ainda diz "Linux e macOS"; a versão para Windows não foi testada como as outras.

Quando o `appId` estiver fixo e o Provider para Windows testado: envie o primeiro PR do Provider (manifestos da versão daquele momento) e crie a variável de repositório `WINGET_PROVIDER` com valor `true` (Settings → Secrets and variables → Actions → Variables). A partir daí os releases `provider-v*` publicados também vão para o winget.

## Testar antes de enviar (opcional, precisa de Windows)

Num Windows 10/11 com o winget atualizado, num PowerShell como administrador:

```
winget settings --enable LocalManifestFiles
winget validate --manifest packaging\winget\manifests\l\LunesNetwork\Piu\0.1.4
winget install --manifest packaging\winget\manifests\l\LunesNetwork\Piu\0.1.4
```

O `winget validate` só existe no Windows. Fora dele, os manifestos foram conferidos contra os schemas oficiais (versão 1.28.0, a que o PR template do winget-pkgs pede hoje).
