# Publicar o Piu no APKPure

Guia para o dono do projeto. Escrito em 13/11/2026 para o Piu 0.1.5 (versionCode 6).

O APKPure é uma loja de Android que distribui o próprio APK que você envia, sem assinar de novo. Por isso quem instala por lá recebe o mesmo app do GitHub, do site, do Uptodown e do Aptoide, e pode atualizar por qualquer um deles sem perder dados.

O que só você pode fazer: criar a conta, entrar nela, enviar o arquivo e responder ao e-mail da revisão. Nenhum agente faz esses passos.

> **Aviso sobre este guia.** O site do APKPure bloqueia a leitura automática (as páginas `apkpure.com/submit-apk`, `apkpure.com/developer.html` e a ajuda do console responderam "403 Forbidden" ao agente que escreveu este texto). Os passos abaixo vêm do que os buscadores mostram dessas páginas e de um guia de terceiros de 2020. Os nomes dos botões podem ter mudado: se algo estiver diferente na tela, siga a tela e anote aqui o que mudou.

## O que já se sabe sobre o envio

- Aceita arquivo `.apk` ou `.xapk` de até 2000 MB (o do Piu 0.1.5 tem 27 MB).
- Toda versão passa por revisão feita por pessoas da equipe do APKPure antes de aparecer no site.
- O APKPure diz que, se o app não for aprovado em 3 dias úteis, vale reler as regras deles.
- Atualização: sempre na mesma ficha do app (mesmo nome e mesmo endereço no APKPure). Não crie uma ficha nova para cada versão.
- Dúvidas: `developer@apkpure.com`.

## Antes de começar, separe

1. **O APK oficial**: `Piu-0.1.5.apk`, do release [`android-v0.1.5`](https://github.com/Magnopiro-oficial/piu./releases/tag/android-v0.1.5). Nunca um build de teste.
2. **Confira o arquivo** antes de enviar (no Terminal, na pasta onde ele está):

   ```bash
   shasum -a 256 Piu-0.1.5.apk
   ```

   Tem que aparecer `f7b1cc285bc9ae5fe39f2a4cf71539e923887f81aa52d42b2566029be5ef6e5d`. Se aparecer outro valor, não envie.

3. **Os textos e imagens** da pasta `apps/mobile/fastlane/metadata/android/` (tabela abaixo).

## Passo a passo

1. **Criar a conta de desenvolvedor.** Acesse https://apkpure.com/submit-apk (ou https://apkpure.com/developer.html) e crie a conta do console de desenvolvedor. Use o e-mail do projeto, não um pessoal, se possível.
2. **Adicionar o app.** No console, abra o menu e entre em **Manage Apps** (Gerenciar apps).
   - Se o Piu **ainda não** estiver no APKPure: clique em **Add Application** (Adicionar aplicativo). Informe:
     - Nome do pacote: `net.piu.app`
     - Nome do app: `Piu` (sem nomes de outras marcas no título)
   - Se o Piu **já** aparecer no APKPure (alguém pode ter enviado antes): use **Claim Apps** (Reivindicar apps) e mande a prova de propriedade da seção "Prova de propriedade" abaixo.
3. **Detalhes do app (App Details).**
   - Tipo: **App** (não jogo).
   - Categoria: **Comunicação** (Communication).
   - Ícone: `apps/mobile/fastlane/metadata/android/pt-BR/images/icon.png` (512 × 512 px).
   - Classificação de conteúdo: responda ao questionário com o que está em "Perguntas sobre conteúdo" abaixo.
   - Política de privacidade: `https://github.com/Magnopiro-oficial/piu./blob/main/PRIVACY.md` (em inglês). Se houver campo para português: `https://github.com/Magnopiro-oficial/piu./blob/main/PRIVACIDADE.md`.
   - Site: `https://github.com/Magnopiro-oficial/piu.`
4. **Textos e imagens (Edit Details).** Copie cada campo do arquivo indicado na tabela. Preencha primeiro em inglês (o idioma principal do APKPure) e, se o console deixar adicionar idioma, repita em português.
5. **Enviar o APK (Manage Versions).** Clique em **Select Files**, escolha `Piu-0.1.5.apk`, cole o texto de novidades (`changelogs/6.txt`) e clique em **Upload**. Espere a verificação do arquivo terminar, atualize a página e confirme o envio.
6. **Mandar para revisão.** Clique em **Submit for Review** (Enviar para revisão). O resultado chega por e-mail ou aparece no console.
7. **Depois de aprovado, confira.** Baixe o Piu pelo próprio APKPure e rode:

   ```bash
   shasum -a 256 Piu-0.1.5.apk
   ```

   Tem que dar o mesmo SHA-256 do passo "Confira o arquivo". Se der outro valor, o APKPure mudou o arquivo: avise o projeto antes de divulgar o link.

## De qual arquivo copiar cada campo

Todos os arquivos ficam em `apps/mobile/fastlane/metadata/android/`. Inglês em `en-US/`, português em `pt-BR/`.

| Campo no APKPure | Arquivo | Inglês (en-US) | Português (pt-BR) |
|---|---|---|---|
| Nome do app (App Name) | `title.txt` | Piu: offline messenger | Piu: mensageiro sem internet |
| Descrição curta (Short Description) | `short_description.txt` | 70 caracteres | 69 caracteres |
| Descrição longa (Long Description) | `full_description.txt` | cerca de 2.300 caracteres | cerca de 2.400 caracteres |
| Novidades (What's New) | `changelogs/6.txt` | 8 linhas | 8 linhas |
| Ícone (App Icon) | `images/icon.png` | 512 × 512 px | o mesmo |
| Capturas de tela (Screenshots) | `images/phoneScreenshots/1.png` a `4.png` | 4 imagens | 4 imagens |

Observações:

- **Nome do app**: se o campo for só "nome", use `Piu`. O texto depois dos dois-pontos é para lojas que mostram um subtítulo.
- **Capturas de tela**: use as da pasta do idioma que você está preenchendo. As capturas estão sendo refeitas por outra pessoa; use a versão que estiver na `main` do GitHub no dia do envio.
- **Banner (App Banner, 1024 × 500 px)**: o guia de 2020 cita esse campo. O projeto **não tem** essa imagem ainda. Se o console exigir, peça uma ao design (fundo escuro `#0A0A0A` com o logo de `design/brand/icon-1024.png`) antes de enviar.
- **Vídeo**: opcional, pode deixar em branco.

## Prova de propriedade

Só é pedida se o Piu já estiver no APKPure enviado por outra pessoa (botão **Claim Apps**) ou se a revisão perguntar quem é o dono. Mande este texto (em inglês, que é o idioma do suporte deles), com o seu nome no fim:

```text
Hello APKPure team,

I am the maintainer of Piu (package net.piu.app), a free and open-source (AGPL-3.0) messenger.

Proof of ownership:
- Source code and official releases: https://github.com/Magnopiro-oficial/piu.
- Official APK for this version: https://github.com/Magnopiro-oficial/piu./releases/tag/android-v0.1.5
  File: Piu-0.1.5.apk
  SHA-256 of the file: f7b1cc285bc9ae5fe39f2a4cf71539e923887f81aa52d42b2566029be5ef6e5d
- Every Piu release is signed with the same key. Signing certificate: O=piu.
  Certificate SHA-256: 59:5B:DC:6A:2D:57:4F:EC:59:F0:F7:81:EB:9D:8D:47:9A:84:F4:90:7D:70:40:5F:83:B4:B1:E5:78:B7:FF:31
  (check with: apksigner verify --print-certs Piu-0.1.5.apk)

The APK I am uploading is byte-for-byte the one published on GitHub. Only APKs signed with this certificate are official.

Regards,
<seu nome>
```

Se pedirem uma prova que só o dono consegue dar (por exemplo, um texto ou arquivo no repositório do GitHub), anote exatamente o que pediram e peça para o projeto preparar. Não mande a chave de assinatura nem a senha dela para ninguém, nunca.

## Perguntas sobre conteúdo

Respostas para o questionário de classificação e para a revisão. Responda sempre com a verdade: o APKPure pode instalar o app e conferir.

**Anúncios?** Não.

**Compras dentro do app?** Não.

**Coleta de dados?** O Piu não tem servidor próprio e não coleta dados. Conversas, contatos e a carteira ficam no celular, cifrados. Com internet, a carteira consulta os servidores públicos da rede Lunes para mostrar saldo (detalhes em `PRIVACY.md`).

**Conversa entre usuários?** Sim. Mensagens cifradas de ponta a ponta, sem moderação central (não há servidor no meio).

**Carteira de criptomoeda?** Sim. Se perguntarem, use este texto:

> The app includes a non-custodial wallet for LUNES, the coin of the Lunes Network. Keys are created and kept only on the user's device; transactions are signed on the phone. The app does not hold user funds, does not sell, buy or exchange cryptocurrency, has no trading, no ICO and no rewards paid today. It only shows balance and history and sends LUNES the user already owns.

Em português, se o formulário for em português:

> O app tem uma carteira não custodial de LUNES, a moeda da rede Lunes. As chaves são criadas e ficam só no aparelho; as transações são assinadas no celular. O app não guarda dinheiro de ninguém, não compra, não vende e não troca criptomoeda, não tem negociação nem oferta de moeda, e hoje não paga recompensas. Ele só mostra saldo e histórico e envia LUNES que a pessoa já tem.

## Permissões: o que responder

Se a revisão perguntar por que o Piu pede cada permissão:

| Permissão | Para que serve no Piu | Texto para colar |
|---|---|---|
| Bluetooth (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`) e dispositivos Wi-Fi por perto (`NEARBY_WIFI_DEVICES`) | Encontrar celulares por perto e trocar mensagens sem internet, por Bluetooth e Wi-Fi Direct. É a função principal do app. | Piu is an offline messenger: Bluetooth and nearby Wi-Fi are how phones find each other and exchange encrypted messages without internet. The scan is declared "neverForLocation". |
| Localização (só até o Android 12) | O Android antigo exige essa permissão para procurar aparelhos Bluetooth. O Piu não lê a localização. No Android 13 ou superior ela nem é pedida. | Location is declared only up to Android 12 (maxSdkVersion 32), because those versions require it for Bluetooth scanning. The app never reads the device location. |
| Serviço em primeiro plano, tipo "dispositivo conectado" (`FOREGROUND_SERVICE_CONNECTED_DEVICE`) | Modo nó e "receber com o app fechado": o celular continua passando mensagens pela malha com um aviso fixo na barra de notificações. | A foreground service of type connectedDevice keeps the Bluetooth/Wi-Fi Direct links open so the phone can receive and relay messages with the app closed. It always shows a persistent notification and the user can turn it off. |
| Serviço em primeiro plano, tipo "microfone" (`FOREGROUND_SERVICE_MICROPHONE`) e microfone (`RECORD_AUDIO`) | Chamada de voz cifrada continua com a tela bloqueada. | Used only during an encrypted voice call, so audio keeps working with the screen locked. |
| Ignorar otimização de bateria (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) | Só é pedida quando a pessoa liga "receber com o app fechado". Sem ela, o Android pode desligar o Piu em segundo plano e as mensagens só chegariam ao abrir o app. | Requested only when the user turns on "receive with the app closed". Without it, battery savers kill the relay service and messages only arrive when the app is opened. The user can say no. |
| Iniciar com o aparelho (`RECEIVE_BOOT_COMPLETED`) | Religar o serviço de mensagens depois de reiniciar o celular ou de atualizar o app. O cofre de chaves só abre depois do primeiro desbloqueio. | Restarts the relay service after a reboot or app update, so messages keep arriving. It does not run before the first unlock. |
| Tela cheia (`USE_FULL_SCREEN_INTENT`) | Mostrar a chamada recebida sobre a tela bloqueada, como o telefone faz. | Shows an incoming voice call over the lock screen. |
| Câmera | Ler o QR de contato de quem está com você. | Used only to scan a contact's QR code. |
| Notificações | Avisar de mensagens e chamadas. | Message and call alerts. |

O Piu **não** pede: contatos do telefone, SMS, chamadas telefônicas, arquivos de todo o aparelho, instalar outros apps ou sobrepor outros apps (`SYSTEM_ALERT_WINDOW` está bloqueada no `app.json`).

## A cada versão nova

1. Gere e publique o APK no GitHub como sempre (`docs/distribuicao/publicar-0.1.5.md`).
2. No console do APKPure, abra a ficha do Piu → **Manage Versions** → envie o APK novo com o `changelogs/<versionCode>.txt` da versão.
3. Depois da aprovação, baixe pelo APKPure e confira o SHA-256 contra o do release do GitHub.
