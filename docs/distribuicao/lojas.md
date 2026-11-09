# Uptodown e Aptoide

Lojas de Android que aceitam o APK assinado com a chave oficial (`O=piu.`, SHA-256 do certificado `595bdc6a…78b7ff31`), o mesmo do GitHub e do site. Quem instala por uma delas atualiza por cima das outras sem perder dados.

## Antes de enviar
- APK final de release (nunca um build de diagnóstico nem assinado com a chave de debug).
- Conferir: `apksigner verify --print-certs Piu-X.Y.Z.apk` mostra `O=piu.` e o SHA-256 acima.
- Atualizar `apps/mobile/fastlane/metadata/android/*/changelogs/<versionCode>.txt`.

## Ficha (mesmos arquivos nas duas lojas)
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
- Classificação indicativa: responder ao questionário da loja. O app tem conversa entre usuários e carteira de criptomoeda (LUNES); não tem anúncios nem compras dentro do app.
- Política de privacidade: https://github.com/Magnopiro-oficial/piu./blob/main/PRIVACIDADE.md (em inglês: `PRIVACY.md`).
- Site / código: https://github.com/Magnopiro-oficial/piu.
- Licença: AGPL-3.0, gratuito.

## Envio
A conta de desenvolvedor é criada e usada pela pessoa responsável pelo projeto (nunca por um agente).
- **Uptodown**: programa para desenvolvedores do Uptodown; criar a ficha do app, enviar o APK e preencher os campos acima.
- **Aptoide**: Aptoide Connect (área de desenvolvedor); mesmo processo.

Cada nova versão: enviar o APK novo e o texto de `changelogs/<versionCode>.txt`.
