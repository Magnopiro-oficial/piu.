# Piu: onde paramos (23/11/2026)

Documento de retomada. O trabalho no fundo foi encerrado a pedido do dono em 23/11/2026. Nada novo deve começar até ele chamar.

## O que está publicado

| Produto | Versão | Onde |
|---|---|---|
| Piu para Android | 0.1.5 (versionCode 6) | release `android-v0.1.5`, site, Obtainium (botão no README e no site) |
| Piu Desktop | 0.1.4 | release `desktop-v0.1.4`, site |
| Piu Node | 0.1.2 | release `node-v0.1.2`, site |
| Piu Provider | 0.1.3 | release `provider-v0.1.3` (o trabalho novo não foi publicado) |

A `main` está em `973a937` (merge do PR #107).

## O que avançou desde a 0.1.4

- **App fechado recebe mensagens e chamadas** (PR #93). Transporte, mensageiro, conversas e alertas saíram da árvore React para `apps/mobile/src/core/`. O `PiuRelayService` sobe a tarefa Headless `PiuCore`, volta sozinho e pulsa com a tela apagada. Validado pelo dono no Galaxy A31 e no Poco.
- **Tom de chamando e aviso de falha na chamada**, e **QR do convite de grupo em tela cheia** (PR #93). Validado pelo dono nos dois celulares.
- **Pedido de bateria e Inicialização automática no primeiro uso** (PR #93).
- **Lojas, onda 1** (PR #107): winget, repositório apt no GitHub Pages, AppImageHub, Obtainium e guia do APKPure. Pesquisa completa em `docs/distribuicao/lojas-alternativas.md`.

## Validado e não validado

**Validado**
- Suítes na época do PR #93: mobile 1095/1095, desktop 264/264, tsc e compilação Kotlin.
- APK 0.1.5: assinatura `O=piu.`, só arm64-v8a, SHA-256 `f7b1cc285bc9ae5fe39f2a4cf71539e923887f81aa52d42b2566029be5ef6e5d`.
- Site publicado com as três versões e o botão do Obtainium.
- PR #107: 9 testes do script apt, build do site, filtros do Obtainium contra a API real, manifestos do winget contra os schemas 1.28.0.

**Não validado**
- App fechado: gasto de bateria em 1 hora, volta do serviço depois de `am kill` e de reiniciar o celular, troca de Wi-Fi com o app fechado.
- winget: `winget validate` e instalação num Windows. O robô da Microsoft testa no pedido.
- apt: instalação num Linux de verdade. O teste em container foi interrompido.
- Obtainium num aparelho real.
- APKPure: o painel bloqueou a leitura automática; o guia veio de fontes indiretas.

## Pendências, em ordem

1. **winget:** o pedido [microsoft/winget-pkgs#487310](https://github.com/microsoft/winget-pkgs/pull/487310) está aberto. O dono precisa aceitar o termo da Microsoft com um comentário (texto em `docs/distribuicao/winget.md`). Depois, acompanhar o robô e o moderador. Para as próximas versões irem sozinhas, criar o secret `WINGET_TOKEN`.
2. **Uptodown e Aptoide:** o dono estava enviando a 0.1.5 pelo painel. Os arquivos estão em `~/Piu-para-lojas`. No Uptodown há uma 0.1.4 antiga "Pending review" que deve ser apagada ou substituída.
3. **Chave GPG do apt:** gerar e guardar no secret `APT_GPG_PRIVATE_KEY` (`docs/distribuicao/linux-apt-appimagehub.md`). Sem ela, o site é publicado sem `/apt/`.
4. **AppImageHub:** abrir o pedido com `packaging/appimagehub/Piu`.
5. **APKPure:** criar a conta e enviar o APK (`docs/distribuicao/apkpure.md`).
6. **Piu Provider:** ramo `fix/provider-config-didatica` (Configurações didáticas, espaço em MB reais, uma mensagem cifrada por arquivo). Falta PR, revisão, merge e, se for publicar, tag e release. Relatório em `docs/relatorios/` desse ramo.
7. **Flathub:** parado à espera de capturas do Piu Desktop rodando no Linux. O manifesto precisa ser escrito por uma pessoa.
8. **Estudo UHF/VHF:** ramo `docs/estudo-uhf-vhf`. Há um começo de adaptador KISS no ramo `feat/piu-node-tnc-kiss`, não validado.
9. **Onda 2 das lojas:** versão do Android sem bibliotecas do Google (Nearby, Firebase, ML Kit, Install Referrer), que abre o F-Droid e a Huawei.
10. **Diretório do Obtainium:** só com 35 estrelas e 4 meses de repositório (a partir de 01/03/2027).

## Ramos de trabalho

| Ramo | Estado |
|---|---|
| `fix/app-fechado-chamada-qr` | mergeado (PR #93) |
| `feat/lojas-onda-1` | mergeado (PR #107) |
| `fix/provider-config-didatica` | local, sem PR |
| `docs/estudo-uhf-vhf` | local, sem PR |
| `feat/piu-node-tnc-kiss` | local, não validado |
| `docs/retomada-2026-11-23` | este documento |

No checkout principal (`/Users/lucas/Documents/Projetos_DEV/piu`) há arquivos sem commit que são de outro trabalho (Flathub e atualizador do Desktop): `apps/desktop/src/main/updater.ts`, `apps/desktop/test/updater.test.ts`, `phoneScreenshots`, `.github/workflows/ci-flatpak.yml`, `packaging/flatpak/`, `docs/distribuicao/flathub.md` e `docs/seguranca/auditoria-2026-11-09.md`. Não foram tocados.

## Cuidados que valem na volta

- Testes e builds pesados só pela fila: `~/.claude/bin/test-queue run "piu: <o quê>" -- <cmd>`.
- O Colima sobe containers antigos de outros projetos. Não pausar nem parar containers que não são do teste. Em 23/11 um agente pausou três deles e foi interrompido; nenhum ficou pausado.
- A senha da chave do APK é digitada só pelo dono, num comando único no terminal (`docs/distribuicao/publicar-0.1.5.md`).
- O Obtainium filtra pelo título do release: ele precisa conter "Android" e o arquivo precisa se chamar `Piu-X.Y.Z.apk`.

## Primeiro passo da volta

Ver o estado do pedido do winget (#487310) e do envio ao Uptodown/Aptoide. Depois, abrir o PR do ramo `fix/provider-config-didatica`.
