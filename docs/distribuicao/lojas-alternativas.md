# Piu: lojas fora do Google Play e da App Store (situação em 13/11/2026)

**Resumo:** vale publicar o Piu em várias lojas. As que dão mais retorno com menos trabalho, e que aceitam o Piu como ele está hoje, são: **winget** (Windows), **Obtainium** e **APKPure** (Android), **AppImageHub** e um **repositório apt próprio** (Linux). Essas se somam ao Uptodown, ao Aptoide e ao Flathub, que já estavam no plano.

O **F-Droid** é a loja com o público mais parecido com o do Piu, mas hoje **não aceita o app**. O Piu usa três peças do Google (Nearby, Firebase e ML Kit), e o F-Droid não aceita isso. Para entrar, é preciso fazer uma versão do app sem nada do Google.

Várias lojas esbarram em dois pontos:
- **A carteira LUNES.** Ela obriga a ter uma empresa na Microsoft Store e bloqueia o nome no Snap.
- **A Verificação de Desenvolvedor do Google (ADV).** Ela vale no Brasil desde 30/09/2026 para a Galaxy Store e a Xiaomi GetApps.

Há uma contradição que só você pode resolver: ficar "fora do Google" e, ao mesmo tempo, publicar na Samsung e na Xiaomi. Essas duas lojas exigem uma conta no Google, que custa US$ 25 e pede seu documento de identidade. Pelo plano que o Google anunciou, a partir de 2027 isso vai valer para qualquer APK instalado fora de loja.

## Tabela por loja

Legenda: ✅ vale agora · 🟡 vale depois de resolver algo · ❌ não vale ou não aceita hoje. **(NC)** = não consegui confirmar.

### Android

| Loja | Vale a pena? | O que você faz | O que o agente faz | Bloqueios | Esforço | Alcance |
|---|---|---|---|---|---|---|
| **Uptodown e Aptoide** (já no plano) | ✅ | Envia pela sua conta (já planejado) | Ficha pronta em docs/distribuicao/lojas.md. Deixar a pasta de capturas em pt-BR igual à de en-US (hoje são 4 contra 8) e apagar os arquivos .DS_Store | Nenhum hoje. Em 2027, quando a regra do Google valer no mundo todo, vai precisar do cadastro no Google | Baixo | Médio |
| **Obtainium** (não é loja: o app baixa as atualizações direto do GitHub) | ✅ | Nada. Só aprova o PR no diretório da comunidade, se quiser | Quase tudo: link e botão "Get it on Obtainium" no README, configuração com filtro para baixar só o APK do Android (o mesmo repositório publica Desktop, Node e Provider) e PR no diretório da comunidade | Nenhum. Só cuidar para que ele não baixe o arquivo errado | Baixo | Pequeno a médio, mas o custo é quase zero |
| **APKPure** | ✅ | Cria a conta e envia | Monta o pacote de envio: APK com SHA-256 conferido, textos pt-BR/en, capturas e o texto de prova de que você é o dono | Revisão manual sem critério claro. O site bloqueou a leitura automática, então as regras sobre cripto e bateria são **(NC)** | Baixo | Médio no mundo |
| **F-Droid** | 🟡 Vale muito, mas só depois de uma versão sem Google | Cria a conta no GitLab, abre o pedido de inclusão (MR) e responde aos revisores | Cria a versão sem Google: tira o Nearby (o Piu já tem BLE próprio), tira o Firebase, troca o leitor de QR do ML Kit por ZXing e tira o Install Referrer. Também escreve a receita de build, testa no ambiente do F-Droid e redige o pedido | Hoje entram no APK 4 peças do Google, que a política proíbe. O código do Android é gerado pelo `expo prebuild` e não fica no git, então a receita de build precisa gerar esse código. Pode receber o aviso de "anti-feature" se a carteira depender de um nó RPC fixo (dá para resolver deixando o nó configurável). A revisão leva de semanas a meses **(NC, é estimativa)** | Alto | Alto para o público de privacidade e P2P |
| **IzzyOnDroid** | ❌ por enquanto | Decidir se aceita declarar o uso de IA no código | Nada, até você decidir | A política atual rejeita apps feitos com IA, e o pedido obriga a declarar. O repositório tem commits "Co-Authored-By: Claude". Esconder isso também leva à rejeição. O APK de 27,3 MB está perto do limite de cerca de 30 MB | Baixo, mas tende a ser rejeitado | Médio |
| **Huawei AppGallery** | 🟡 Opcional | Cria conta de pessoa física, com documento e comprovante bancário em inglês | Adapta a ficha, escreve as notas ao revisor (Bluetooth só com consentimento, permissões mínimas, carteira não custodial) e testa o app sem Google Play Services | Precisa da versão sem Google: celulares Huawei não têm os serviços do Google, então o Nearby e o Firebase falham. O revisor pode pedir documentos por causa da carteira **(NC)**. Não exige a verificação do Google (ADV) | Médio | Baixo no Brasil |
| **Samsung Galaxy Store** | 🟡 Só se você aceitar Google e empresa | Precisa de empresa com D-U-N-S, porque pessoa física não pode publicar app. Também precisa do cadastro no Google (US$ 25 e documento) | Adapta a ficha, escreve as notas sobre as permissões e a carteira, confere o requisito de páginas de 16 KB e monta um checklist | Exige empresa. A Samsung suspendeu a validação do D-U-N-S em 17/10/2026. O Google (ADV) é obrigatório no Brasil. Não há regra pública sobre cripto e bateria, então fica a critério do revisor **(NC)**. Não sei se um MEI serve **(NC)** | Alto | Alto no papel; uso real menor |
| **Xiaomi GetApps** | 🟡 Só depois de confirmar que aceita pessoa física do Brasil | Mandar e-mail a overseas-dev@xiaomi.com, fazer a conta e o cadastro no Google (ADV) | Redige o e-mail, adapta a ficha e escreve um guia para o usuário liberar o Piu nas restrições de bateria do HyperOS | Não está confirmado que aceita pessoa física do Brasil **(NC)**. A política sobre cripto é desconhecida **(NC)**. O Google (ADV) é obrigatório. O HyperOS fecha apps em segundo plano, o que pode derrubar o relay | Médio | Médio a alto no Brasil |
| **Accrescent** | ❌ | Nada | Nada | Não aceita novos desenvolvedores, sem previsão de reabrir | — | Pequeno |
| **APKMirror** | ❌ por enquanto | Talvez, no futuro, mandar um e-mail | Redige o e-mail, se você quiser | A curadoria recusa a maioria dos apps novos sem reputação | Baixo | Alto, mas a chance de entrar é baixa |
| **Amazon Appstore** | ❌ Descartar | — | — | A Amazon encerrou a loja em celulares Android em 20/08/2025. Ela só existe em tablets Fire | — | Nulo |

### Windows

| Loja | Vale a pena? | O que você faz | O que o agente faz | Bloqueios | Esforço | Alcance |
|---|---|---|---|---|---|---|
| **winget** | ✅ **Melhor custo-benefício** | Aprovar a abertura do PR público e aceitar o termo da Microsoft (CLA) com sua conta GitHub. Não precisa de conta Microsoft | Escreve e valida os arquivos de descrição do pacote (Desktop e Provider), confere que o instalador funciona sem janelas e cria uma automação que atualiza o pacote a cada versão nova | O .exe não tem assinatura digital. As regras permitem, mas o Windows pode mostrar um aviso de segurança ao instalar. Falta testar a instalação e a desinstalação sem janelas | Baixo | Alto (vem no Windows 10/11) |
| **Chocolatey** | 🟡 Depois do winget | Cria a conta e a chave de API, ou guarda a chave como secret no GitHub | Monta o pacote, os scripts e a automação | Moderação humana de dias a semanas. O antivírus pode marcar o .exe sem assinatura | Médio | Médio (empresas e TI) |
| **Scoop, bucket próprio** | 🟡 Baixa prioridade | Aprovar a criação do repositório | Escreve o pacote e a atualização automática | O bucket oficial Extras pede 100 estrelas ou 50 forks, e o Piu tem 1 estrela, então hoje só o próprio é viável | Baixo | Baixo |
| **Microsoft Store** | ❌ Hoje não, por causa da carteira | Só daria com uma empresa (D-U-N-S e domínio próprio) | Gera o pacote MSIX e escreve a ficha | A política 10.2.6 exige conta de empresa para carteira de cripto. Uma conta de pessoa física seria reprovada | Alto | Alto, mas depende de ter empresa |

### Mac

| Loja | Vale a pena? | O que você faz | O que o agente faz | Bloqueios | Esforço | Alcance |
|---|---|---|---|---|---|---|
| **Homebrew, tap próprio** | 🟡 Baixa prioridade | Aprovar a criação do repositório | Escreve a receita de instalação, a atualização automática e o guia para liberar o app no Gatekeeper | É possível hoje. O alcance é pequeno | Baixo | Baixo |
| **Homebrew oficial** | ❌ | Precisaria pagar a conta Apple (US$ 99/ano), o que vai contra o plano de ficar fora da Apple | Configura a notarização (o projeto já está preparado para isso) | Desde 1/9/2026 o Homebrew recusa apps sem notarização da Apple, e o Piu não é notarizado. Também exige popularidade (225 estrelas ou 90 forks) | Alto | Alto |

### Linux

| Loja | Vale a pena? | O que você faz | O que o agente faz | Bloqueios | Esforço | Alcance |
|---|---|---|---|---|---|---|
| **Flathub** (já em andamento) | ✅ | Tirar as capturas de tela no Linux. Uma pessoa precisa escrever o manifesto, porque o Flathub proíbe manifesto feito por IA | Corrigir a versão no metainfo (0.1.2 → 0.1.4) e o link errado do repositório (lunes-platform → Magnopiro-oficial) | As capturas atuais são desenhos que mostram funções que o Desktop não tem | Médio | O maior do Linux |
| **AppImageHub** | ✅ | Abrir o PR (um arquivo de uma linha) | Confere as regras: abrir em inglês e tema claro, rodar no Ubuntu antigo, validar os arquivos. Prepara o arquivo `data/Piu` | Só x86_64. O app precisa abrir em inglês e tema claro, o que falta conferir. A versão de Ubuntu exigida é **(NC)** | Baixo | Baixo a médio |
| **Repositório apt próprio** (GitHub Pages) | ✅ Principalmente para o Piu Node | Gerar a chave GPG e guardá-la como secret | Faz quase tudo: a automação de publicação e a página "apt install piu". Pode fazer o mesmo para o OpenWrt | A chave precisa ser bem guardada. O GitHub Pages tem limite de 1 GB e de cerca de 100 GB/mês | Baixo | Médio (atualização automática para quem já usa) |
| **Snap Store** | ❌ Hoje não | — | Poderia gerar o pacote snap | Desde 2024 a Canonical recusa nomes de snap ligados a carteira de cripto e exige "Verified Publisher" para apps financeiros | Médio | Alto, mas o pedido tende a ser negado |
| **AUR (Arch)** | ❌ Hoje não | — | Pode deixar os arquivos de pacote prontos | O cadastro de contas novas está fechado desde a onda de malware de 2026. Não achei data de reabertura **(NC: o site bloqueou a leitura automática)** | Baixo | Pequeno |
| **Feed oficial do OpenWrt** | 🟡 Mais tarde | Abrir e defender o PR em seu nome, com nome e e-mail reais e declarando o uso de IA | Reescrever a receita de build no padrão do OpenWrt e testar | A regra proíbe contribuição feita por agente sozinho. O responsável pelo pacote tem de ser uma pessoa. Falta testar num roteador real. Os revisores devem pedir mais tempo de projeto | Alto | Nicho |

## Ordem recomendada

**Onda 1: agora, sem bloqueio e quase sem trabalho seu**
1. Uptodown e Aptoide (já no plano). Antes de enviar, igualar as capturas pt-BR/en e apagar os .DS_Store.
2. **winget** (Windows): só precisa da conta GitHub e do seu ok no PR.
3. **Obtainium**: botão no README, sem cadastro.
4. **APKPure**: uma conta e um envio.
5. **AppImageHub** e **repositório apt próprio** (Desktop e Node no Linux).
6. Terminar o **Flathub** (as capturas no Linux são o que trava hoje).

**Onda 2: precisa de trabalho técnico, mas sem barreira de empresa ou de Google**
1. **Versão do Android sem Google.** É o maior investimento e abre o **F-Droid** e a **Huawei AppGallery**. Também melhora o Piu em celulares sem Google e reduz a coleta de dados do Google (hoje o Firebase entra no APK mesmo com o push desligado).
2. **Chocolatey**, mais o tap do Homebrew e o bucket do Scoop, se quiser cobrir os usuários técnicos.
3. Começar a fazer o build do Android num servidor do GitHub (CI) em vez de no seu computador. Isso ajuda o F-Droid e a confiança no app.

**Onda 3: depende de uma decisão sua**
- **Fazer o cadastro no Google (ADV), US$ 25 e documento?** Habilita a Galaxy Store e a GetApps no Brasil e protege todos os APKs quando a regra valer no mundo todo, em 2027. Contradiz em parte a ideia de ficar "fora do Google".
- **Abrir ou usar uma empresa com D-U-N-S?** Habilita a Galaxy Store e a Microsoft Store.
- **Declarar o uso de IA?** O IzzyOnDroid tende a rejeitar mesmo assim. O OpenWrt aceita, desde que você conduza o PR.
- Quando reabrirem ou houver tração: AUR, Accrescent, APKMirror, Homebrew oficial e Scoop Extras.

**Não vale:** Amazon (a loja acabou para celulares), Snap e Microsoft Store enquanto o app tiver a carteira e não houver empresa, e Accrescent (fechado).

## Pendências do repositório que valem para várias lojas
- Corrigir `homepage` e `repository` (que apontam para lunes-platform/piu.) em apps/desktop/package.json e apps/provider-desktop/package.json.
- Atualizar o metainfo para 0.1.4.
- Tirar "Google Play; App Store depois" de docs/distribuicao/checklist.md, porque essas lojas saíram do plano.
- O domínio piu.net, que garantiria os nomes `net.piu.app` e `net.piu.desktop`, não existe. A verificação de domínio vai ser exigida pelo Accrescent e pode ser exigida por outras lojas.

## Não confirmado
- Se a Galaxy Store aceita MEI e quando volta a validar o D-U-N-S.
- Se a Xiaomi aceita pessoa física do Brasil.
- As regras de cripto e de bateria na Galaxy Store, GetApps, APKPure e APKMirror.
- Se e quando o AUR reabre o cadastro.
- O plano grátis da Cloudsmith em 2026.
- Qual Ubuntu o AppImageHub exige.
- O prazo de revisão do F-Droid.

## Arquivos principais
- /Users/lucas/Documents/Projetos_DEV/piu/docs/distribuicao/lojas.md
- /Users/lucas/Documents/Projetos_DEV/piu/docs/distribuicao/checklist.md
- /Users/lucas/Documents/Projetos_DEV/piu/docs/distribuicao/flathub.md
- /Users/lucas/Documents/Projetos_DEV/piu/apps/mobile/modules/piu-transport/android/build.gradle
- /Users/lucas/Documents/Projetos_DEV/piu/apps/mobile/fastlane/metadata/android/

## Principais fontes
- F-Droid: https://f-droid.org/docs/Inclusion_Policy/ e https://f-droid.org/docs/Anti-Features/
- IzzyOnDroid: https://izzyondroid.org/docs/general/AppInclusionPolicy/
- Accrescent: https://accrescent.app/docs/guide/getting-started/new-app.html
- Verificação de Desenvolvedor do Google: https://developer.android.com/developer-verification
- Galaxy Store: https://developer.samsung.com/galaxy-store/faq.html e https://forum.developer.samsung.com/t/upload-an-android-app-game-as-a-private-seller/41239
- Xiaomi GetApps: https://global.developer.mi.com/document?doc=accountRegistration.becomeADeveloper
- Huawei AppGallery: https://developer.huawei.com/consumer/en/doc/30202
- Amazon: https://developer.amazon.com/apps-and-games/blogs/2025/02/upcoming-changes-to-amazon-appstore-for-android-devices-and-coins-program
- APKPure: https://apkpure.com/submit-apk
- APKMirror: https://www.apkmirror.com/faq/
- winget: https://learn.microsoft.com/en-us/windows/package-manager/package/windows-package-manager-policies
- Scoop: https://github.com/ScoopInstaller/Extras/blob/master/.github/ISSUE_TEMPLATE/package-request.yml
- Chocolatey: https://docs.chocolatey.org/en-us/community-repository/moderation/
- Microsoft Store: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies
- Homebrew: https://docs.brew.sh/Acceptable-Casks
- Snap: https://forum.snapcraft.io/t/policy-restricting-sensitive-snap-categories-to-trusted-publishers/47797
- AUR: https://linuxiac.com/arch-linux-blocks-new-aur-registrations-amid-malware-cleanup/
- AppImageHub: https://github.com/AppImage/appimage.github.io
- OpenWrt: https://raw.githubusercontent.com/openwrt/packages/master/CONTRIBUTING.md
- packagecloud: https://packagecloud.io/pricing