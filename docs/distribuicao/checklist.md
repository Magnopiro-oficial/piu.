# Checklist de distribuição do app Piu (Android)

Dois canais, decididos em 04/11/2026: **lojas** (Google Play; App Store depois) e **P2P** (o app passa de celular para celular por Bluetooth ou Wi-Fi Direct, regra 6.1 do [mapa de regras](../regras/mapa-regras-negocio.md)). Marque cada item antes de mandar uma versão para fora da equipe.

## 1. Assinatura de release

Atualizado em 08/11/2026. Desde a 0.1.0 o APK sai assinado com a chave de release do Piu, que fica fora do repositório (`~/piu-release-key/piu-release.jks` na máquina de quem publica). O plugin `apps/mobile/plugins/releaseSigningGradle.js` lê o caminho e a senha de `PIU_RELEASE_STORE_FILE` e `PIU_RELEASE_STORE_PASSWORD`. Sem elas, qualquer tarefa de release **falha**, em vez de cair no `debug.keystore` público (auditoria 2026-11-06, M-03).

- [x] Chave de assinatura do app Android gerada e guardada fora do repositório (é outra chave, não a de release dos pacotes do `piu-node`: ver [chave-de-release.md](../seguranca/chave-de-release.md)).
- [x] O build de release usa essa chave, e o `debug.keystore` não assina release.
- [x] Impressão digital SHA-256 do certificado registrada: `595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31`. Ela está no site (`apps/site/src/lib/androidRelease.ts`) e no app (`apps/mobile/src/lib/apkIntegrity.ts`), e um teste confere que as duas são iguais.
- [ ] Na Play: ativar o **Play App Signing** (a Google guarda a chave do app; a Lunes guarda só a de upload).
- [ ] **ID final do app** (`expo.android.package` no `app.json`, hoje `net.piu.app`). Mudar o ID depois de publicar cria outro app.

## 2. Cada versão

- [ ] Subir `expo.version` (ex.: 0.1.1) e o `versionCode` do Android (sempre maior que o anterior, senão o Android recusa a atualização).
- [ ] `git pull --ff-only` na `main` (outros agentes publicam direto nela).
- [ ] Testes: `npm test` e `npx tsc --noEmit` em `apps/mobile`, todos passando.
- [ ] Gerar **AAB** para a Play e **APK universal** (uma peça só) para o P2P e para o site: quem instala pela Play recebe o app em partes e não consegue repassar (o app avisa com `ERR_SPLIT_APK`).
- [ ] Conferir a assinatura do APK e do AAB com a chave de release (item 1).
- [ ] Anotar o SHA-256 do APK universal.
- [ ] Gerar o APK com `scripts/build-apk.sh`, em `apps/mobile`. O script confere sozinho (com `unzip -l`) que o APK só tem `lib/arm64-v8a/` e sai com erro se aparecer outra arquitetura; o APK reprovado é renomeado para `app-release-REPROVADO.apk`. Não usar `-PreactNativeArchitectures=...` para o APK oficial.
- [ ] Segunda linha, à mão: conferir que o APK copiado só tem `arm64-v8a` (o comando abaixo não pode mostrar nada).

```bash
unzip -l ~/piu-release-0.1.5/Piu-0.1.5.apk | grep -E 'lib/(x86|x86_64|armeabi-v7a)/'
```

Por que o `x86_64` entrou na 0.1.1 a 0.1.4: o build era feito com `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64` (receita anotada na memória dos agentes, para rodar também no emulador). Essa opção vence o `reactNativeArchitectures` do `gradle.properties`, que na época era o padrão do Expo (as quatro arquiteturas; o `buildArchs` só entrou na 0.1.5). O `npx expo run:android --variant release` desta versão do Expo não passa arquiteturas (só o debug usa as do aparelho). Desde a 0.1.5 há três travas: `buildArchs` no `app.json`; o plugin `apps/mobile/plugins/withReleaseAbi.js`, que em todo build que não seja só de debug troca a lista de arquiteturas por `arm64-v8a` (mesmo com `-PreactNativeArchitectures`) e ainda tira do release as bibliotecas de outras arquiteturas; e a conferência do script. Conferido em 11/11/2026 com um build de teste (chave descartável) passando `-PreactNativeArchitectures=arm64-v8a,x86_64` de propósito: o APK saiu só com `lib/arm64-v8a/`.
- [ ] Depois do `npx expo prebuild`, olhar o `git diff apps/mobile/package.json`: o prebuild troca os scripts `android` e `ios` para `expo run:android` e `expo run:ios`. Desfazer essas duas linhas (`expo start --android` e `expo start --ios`).

### Tamanho do APK (desde a 0.1.5)

Medido em 11/11/2026 com um APK de teste local: 47,0 MB na 0.1.4 e 26,0 MB na 0.1.5. O que mudou, tudo com fonte em `apps/mobile` (o `npx expo prebuild` leva para `android/`):

- **Só `arm64-v8a`** (`buildArchs` do `expo-build-properties` no `app.json`). O `x86_64` só servia a emulador e pesava 14,9 MB. O release nunca leva `x86_64`, nem com `-PreactNativeArchitectures` (plugin `withReleaseAbi`). Para testar em emulador x86_64, use um build de debug (`npx expo run:android` com o emulador ligado, ou `./gradlew assembleDebug -PreactNativeArchitectures=x86_64`). Na Play, o AAB continua sendo o caminho.
- **Pacote JS comprimido** (`enableBundleCompression` no `app.json`): de 7,9 MB para 2,9 MB dentro do APK. O custo é abrir o app um pouco mais devagar (o pacote é descomprimido na memória); medir em aparelho antes de publicar.
- **Sem reanimated, worklets e gesture-handler**: o app não usa. Saem do nativo pelo `expo.autolinking.exclude` do `package.json` e do JS pelo `metro.config.js`. Para voltar a usar um deles, tire o nome dos dois lugares.
- **`shrinkResources` fica desligado.** Ligado, ele economiza cerca de 1 MB, mas apaga `res/raw/piu.wav` (o som da notificação, que o Android procura pelo nome). Só religar junto com um `keep.xml` que preserve esse som, e com teste de notificação em aparelho.

## 3. Teste em aparelho real antes de liberar

Pelo menos dois Android diferentes (hoje: Galaxy A31 com Android 12 e um Poco).

- [ ] Instalação nova e **atualização por cima** da versão anterior (dados e conversas continuam).
- [ ] Abertura animada, troca de telas e "reduzir movimento".
- [ ] Chat: o teclado não cobre a caixa de mensagem.
- [ ] Piu no modo Som (em "Ouvir o piu" e ao receber); mudo no vibrar e no silencioso.
- [ ] Notificação com o app **fechado**: "Testar com o app fechado" e uma mensagem real; tocar no aviso abre a tela certa; número no ícone zera ao abrir.
- [ ] Convite: QR e link (colar em Nova conversa quando o link não abrir).
- [ ] Enviar o Piu por **Bluetooth** e por **Wi-Fi Direct** para um celular sem o app, e o outro instala.
- [ ] Os dois celulares **trocam mensagens** sem internet, nos dois sentidos, com o app em segundo plano.
- [ ] Carteira (esconder saldo) e pareamento com o Piu Provider.
- [ ] **Chamada de voz** entre os dois celulares, sem internet: com o app aberto, em segundo plano e com a tela bloqueada. Atender, recusar ("Mensagem" e "Em 10 min") e desligar. O som segue nos dois sentidos depois de bloquear a tela.
- [ ] **Chamada com o Piu Desktop** no mesmo Wi-Fi, nos dois sentidos.
- [ ] **Rádio LoRa**, se houver placa: conectar, mandar texto curto e ver o "via LoRa" na mensagem (roteiro em [testar-radio-piu.md](../hardware/testar-radio-piu.md)).
- [ ] Aviso de versão nova (Perfil → Versão do Piu) aponta para a versão publicada.

## 4. Canal das lojas

- [ ] Conta da Lunes no Play Console.
- [ ] Ficha: descrição, capturas de tela do app, ícone (`apps/mobile/assets/icon.png`), política de privacidade.
- [ ] "Segurança dos dados": o Piu não coleta dados no servidor; declarar o uso de Bluetooth, dispositivos por perto e localização (só até o Android 12).
- [ ] Justificar as permissões sensíveis: serviço em primeiro plano do tipo "dispositivo conectado" (Modo nó) e `REQUEST_INSTALL_PACKAGES`, se for usada.
- [ ] Teste interno → teste fechado → produção.
- [ ] Preencher `expo.extra.storeLinks.android` (e `.ios`, quando houver) no `app.json`: o convite passa a levar o link da loja sozinho.

## 5. Canal P2P e site

- [ ] O botão "Baixar" do site (`apps/site`, seção `#baixar`) aponta para o **APK universal assinado** (ex.: GitHub Releases), com o SHA-256 do arquivo e a impressão digital do certificado ao lado. Nunca um APK assinado com a chave de debug.
- [ ] Instruções curtas no site: permitir "instalar apps desconhecidos" e conferir a impressão digital.
- [ ] Enviar o Piu de celular para celular (Convidar → "Está longe ou ainda não tem") mostra a mesma impressão digital do site (`595bdc6a…78b7ff31`).
- [ ] Conferência da cópia na primeira abertura (regra 6.3): assinatura, SHA-256 e lista de revogação. Depende da Lunes.

## 6. Pendências conhecidas (04/11/2026)

- [ ] Mensagens só aparecem ao abrir o app (em investigação: o Android pode estar segurando o Piu em segundo plano).
- [ ] O canal Nearby entre os dois celulares falha ao conectar; a conversa funcionou por outro meio.
- [ ] O Poco ainda não recebeu a versão nova.
