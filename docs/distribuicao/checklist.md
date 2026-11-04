# Checklist de distribuição do app Piu (Android)

Dois canais, decididos em 04/11/2026: **lojas** (Google Play; App Store depois) e **P2P** (o app passa de celular para celular por Bluetooth ou Wi-Fi Direct, regra 6.1 do [mapa de regras](../regras/mapa-regras-negocio.md)). Marque cada item antes de mandar uma versão para fora da equipe.

## 1. Bloqueia tudo: assinatura de release

Hoje o APK sai assinado com o `debug.keystore` padrão do React Native (`apps/mobile/android/app/build.gradle`, `signingConfigs.debug`). Essa chave é pública: qualquer pessoa consegue gerar uma "atualização" do Piu que o Android aceita por cima da verdadeira. **Não distribua fora da equipe enquanto isto estiver aberto.**

- [ ] A Lunes gera a **chave de upload/assinatura do app Android** (é outra chave, não a de release dos pacotes do `piu-node`: ver [chave-de-release.md](../seguranca/chave-de-release.md)) e guarda como as outras chaves: cópias cifradas, nunca no repositório nem com agentes.
- [ ] Na Play: ativar o **Play App Signing** (a Google guarda a chave do app; a Lunes guarda só a de upload).
- [ ] O build de release usa essa chave (EAS credentials ou `signingConfigs.release` lendo de variáveis de ambiente), e o `debug.keystore` deixa de assinar release.
- [ ] **ID final do app** (`expo.android.package` no `app.json`). Hoje só existe o `net.piu.app` local, de teste. Mudar o ID depois de publicar cria outro app.
- [ ] Registrar a **impressão digital SHA-256 do certificado** (`apksigner verify --print-certs`). Ela vai para o site e para a conferência da cópia (regra 6.3).

## 2. Cada versão

- [ ] Subir `expo.version` (ex.: 0.1.1) e o `versionCode` do Android (sempre maior que o anterior, senão o Android recusa a atualização).
- [ ] `git pull --ff-only` na `main` (outros agentes publicam direto nela).
- [ ] Testes: `npm test` e `npx tsc --noEmit` em `apps/mobile` (hoje: 251 passando).
- [ ] Gerar **AAB** para a Play e **APK universal** (uma peça só) para o P2P e para o site: quem instala pela Play recebe o app em partes e não consegue repassar (o app avisa com `ERR_SPLIT_APK`).
- [ ] Conferir a assinatura do APK e do AAB com a chave de release (item 1).
- [ ] Anotar o SHA-256 do APK universal.

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
- [ ] Enviar o Piu de celular para celular (Convidar → "Está longe ou ainda não tem") mostra a mesma impressão digital (hoje a tela de compartilhar usa um valor de exemplo: ver [chave-de-release.md](../seguranca/chave-de-release.md)).
- [ ] Conferência da cópia na primeira abertura (regra 6.3): assinatura, SHA-256 e lista de revogação. Depende da Lunes.

## 6. Pendências conhecidas (04/11/2026)

- [ ] Mensagens só aparecem ao abrir o app (em investigação: o Android pode estar segurando o Piu em segundo plano).
- [ ] O canal Nearby entre os dois celulares falha ao conectar; a conversa funcionou por outro meio.
- [ ] O Poco ainda não recebeu a versão nova.
