# Lojas e canais do Piu Android

Canais que distribuem o APK assinado com a chave oficial (`O=piu.`, SHA-256 do certificado `595bdc6a…78b7ff31`), o mesmo do GitHub e do site. Quem instala por um deles atualiza por cima dos outros sem perder dados.

| Canal | Como funciona | Guia |
|---|---|---|
| GitHub e site | Release `android-v*` com `Piu-X.Y.Z.apk` | [publicar-0.1.5.md](publicar-0.1.5.md) |
| Uptodown | Loja; o dono envia o APK | abaixo |
| Aptoide | Loja (Aptoide Connect); o dono envia o APK | abaixo |
| APKPure | Loja; o dono envia o APK e a equipe revisa | [apkpure.md](apkpure.md) |
| Obtainium | App que baixa direto dos releases do GitHub; nada para enviar a cada versão | abaixo |

## Antes de enviar
- APK final de release (nunca um build de diagnóstico nem assinado com a chave de debug).
- Conferir: `apksigner verify --print-certs Piu-X.Y.Z.apk` mostra `O=piu.` e o SHA-256 acima.
- Atualizar `apps/mobile/fastlane/metadata/android/*/changelogs/<versionCode>.txt`.

## Ficha (mesmos arquivos em todas as lojas)
Em `apps/mobile/fastlane/metadata/android/pt-BR/` e `en-US/`:

| Campo da loja | Arquivo |
|---|---|
| Nome | `title.txt` |
| Descrição curta | `short_description.txt` (até 80 caracteres) |
| Descrição | `full_description.txt` |
| Novidades | `changelogs/<versionCode>.txt` |
| Ícone (512 px) | `images/icon.png` |
| Capturas de tela | `images/phoneScreenshots/*.png` |

- Categoria: Comunicação.
- Classificação indicativa: responder ao questionário da loja. O app tem conversa entre usuários e carteira de criptomoeda (LUNES); não tem anúncios nem compras dentro do app. Respostas prontas para carteira e permissões em [apkpure.md](apkpure.md#perguntas-sobre-conteúdo).
- Política de privacidade: https://github.com/Magnopiro-oficial/piu./blob/main/PRIVACIDADE.md (em inglês: `PRIVACY.md`).
- Site / código: https://github.com/Magnopiro-oficial/piu.
- Licença: AGPL-3.0, gratuito.

## Envio
A conta de desenvolvedor é criada e usada pela pessoa responsável pelo projeto (nunca por um agente).
- **Uptodown**: programa para desenvolvedores do Uptodown; criar a ficha do app, enviar o APK e preencher os campos acima.
- **Aptoide**: Aptoide Connect (área de desenvolvedor); mesmo processo.
- **APKPure**: passo a passo em [apkpure.md](apkpure.md).

Cada nova versão: enviar o APK novo e o texto de `changelogs/<versionCode>.txt`. Depois da aprovação, baixar pela loja e conferir que o SHA-256 é o mesmo do release do GitHub.

## Obtainium

O [Obtainium](https://github.com/ImranR98/Obtainium) instala e atualiza apps direto dos releases do GitHub. Não há conta nem envio: o selo "Get it on Obtainium" no `README.md`, no `README.pt-BR.md` e na seção Baixar do site adiciona o Piu já configurado.

A configuração fica em [`packaging/obtainium/net.piu.app.json`](../../packaging/obtainium/net.piu.app.json) (o site lê dela; o link do README é gerado dela):

| Ajuste do Obtainium | Valor | Por quê |
|---|---|---|
| Filtrar títulos de release (`filterReleaseTitlesByRegEx`) | `Android` | O mesmo repositório publica `desktop-v*`, `node-v*` e `provider-v*`. O Obtainium não filtra pela tag: filtra pelo **título** do release (a tag só conta quando o título está vazio). |
| Filtrar APKs (`apkFilterRegEx`) | `^Piu-[0-9]+\.[0-9]+\.[0-9]+\.apk$` | Só o APK do app. Sozinho, este filtro também já barra os outros produtos. |
| Voltar a releases antigos (`fallbackToOlderReleases`) | ligado | Quando o release mais novo é do Desktop ou do Node, o Obtainium pula até o `android-v*` mais novo. |
| Ordenar por (`sortMethodChoice`) | data | |
| Certificados aceitos (`allowedSigningCertHashes`) | `59:5B:DC:…:FF:31` | Só instala APK assinado com a chave oficial, já na primeira instalação. |

**Regras para não quebrar o Obtainium a cada versão:**
- O título do release do Android tem que conter a palavra `Android` (hoje: `Piu 0.1.5 para Android`).
- O APK continua com o nome `Piu-X.Y.Z.apk`.
- Release em rascunho ou marcado como pré-release não chega a quem usa o Obtainium.

**Conferir os filtros** contra os releases reais (não precisa instalar nada):

```bash
node packaging/obtainium/check-filters.mjs --expect-tag android-v0.1.5 --expect-apk Piu-0.1.5.apk
```

Se mudar a configuração, gere o link novo com `node packaging/obtainium/check-filters.mjs --link`, troque nos dois READMEs e rode a conferência de novo (ela avisa se o link dos READMEs ficou diferente do JSON).

**Limitação:** o Obtainium roda no Android 8 ou superior. No Android 8.0 e 8.1 ele não consegue ler o certificado do APK e, com `allowedSigningCertHashes` preenchido, recusa a instalação. Quem tiver Android 8 pode apagar o campo "certificados aceitos" nas opções do app dentro do Obtainium (o próprio Android continua exigindo a mesma assinatura nas atualizações).

**Diretório da comunidade** ([apps.obtainium.imranr.dev](https://apps.obtainium.imranr.dev)): a entrada pronta é o mesmo `net.piu.app.json`, que vai em `public/data/apps/complex/` do repositório `ImranR98/apps.obtainium.imranr.dev`. Ainda **não** dá para enviar: o diretório exige repositório com pelo menos 35 estrelas no GitHub e pelo menos 4 meses de vida. O repositório do Piu foi criado em 31/10/2026 e tinha 1 estrela em 13/11/2026, então a data mais cedo é 01/03/2027, se já tiver 35 estrelas. O selo do README e do site funciona sem estar no diretório.
