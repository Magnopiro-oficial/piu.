# Auditoria final — Piu Desktop (`apps/desktop`), 06/11/2026

Escopo: `apps/desktop/**` (o código do celular que o desktop importa foi só lido). Nenhum dado real foi lido:
testes em pastas temporárias, interface com ponte `window.piu` falsa, app empacotado num perfil separado
(`PIU_PROFILE=smoke`, `--use-mock-keychain`). `~/Library/Application Support/Piu` não foi aberto (data de
modificação conferida antes e depois: 11:43, intacta) e nenhum item do Keychain foi criado ou lido.
Nada foi commitado.

Legenda: **I** implementado e testado · **P** parcial · **N** não implementado · **F** com falhas · **E** depende de infraestrutura/decisão externa.

## 1. Requisitos (linhas do CHECKLIST que tocam o Desktop)

| # | Requisito | Status | Prova |
|---|---|---|---|
| 1 | Melhorias de design (QR em onda do Receber, pareamento QR, contagem da carteira) | I | `test/qrWave.test.ts`; telas Entrada, Carteira e Conversas renderizadas nos dois temas (seção 4) |
| 2 | Assinatura das versões (SHA256SUMS + GPG; ad-hoc no Mac) | E | Atualizador confere GPG + SHA-256 (`test/updater.test.ts`); `releaseKey.ts` vazio → a tela diz "verificação indisponível" e só abre a página da versão. Pacote local: `codesign` = `Signature=adhoc`, `Identifier=net.piu.desktop` |
| 3 | Login do Desktop pelo celular | I | `test/desktopLink.test.ts` (vetores do celular), `test/desktopLinkServer.test.ts`; a linha "Conectar outro aparelho" agora aponta para esse caminho |
| 4 | Carteira Enviar/Receber (contatos, valor, chips, QR) | I | `test/walletSend.test.ts`, `test/paymentJournal.test.ts`, `test/coreWallet.test.ts`; o desktop nunca assina (sem sr25519/sign no processo principal: grep), Enviar vira pedido ao celular |
| 6 | Endereço Lunes nos contatos (`wa`, só públicos aceitos) | I | `test/coreWallet.test.ts` ("compartilha o endereço derivado com contato público aceito"), `test/desktopLink.test.ts` (`lunesAddress`) |
| 7 | QR do Receber igual ao do login | I | mesmo componente `RealQr` + `qrWave` |
| 8 | Fontes empacotadas | I | 42 arquivos Geist/Geist Mono em `dist/renderer/assets` (CSP `font-src 'self'`); ja/zh/ar/hi usam a fonte do sistema (renderizam, ver capturas) |
| 9 | Revisão de design tela a tela | I | 18 telas × 5 combinações (claro/escuro, pt-BR/en/ar/ja) sem erro de console nem chave vazando |
| 10 | AppSec (OWASP) | I | seção 5 |
| 12 | Assinatura Apple/Windows por variáveis | E | `electron-builder.signing.cjs`; decisão de 06/11: lançar sem certificados |
| 17 | Itens "em breve" das Configurações | I | seção 2; teste `nenhum texto da interface fica fora do dicionário` e grep sem "em breve" |
| 18 | Telas D1–D4 / E1–E5 | I | `test/appLock.test.ts`, `lockPassword`, `storageUsage`, `updater`, `guardian.test.ts`; capturas de bloqueio, ponto Piu, armazenamento |
| 20 | Transações e provas pela malha até gateway | P | `CarryGateway` ligado em `mesh.ts` só com `PIU_GATEWAY=1`; o ponto Piu mostra o papel Gateway. Pacotes de evidência: sem caixa do validador (E) |
| 26 | Perfil e configurações sem "em breve", 11 idiomas, tema claro/escuro | I | seções 2–4 |
| 27 | Nova auditoria de segurança + correções | I | seção 5 |
| 28 | Testes unitários, integração, build, instalação | I | seção 6 |

## 2. Placeholders eliminados

Antes: 13 `<Soon/>`/"em breve" e 5 toasts "chega numa próxima versão". Agora: zero. Cada um virou função real ou estado honesto e específico.

| Item | Antes | Agora |
|---|---|---|
| Idioma (10 idiomas) | "em breve" | **Implementado**: camada i18n real (seção 3), seleção "Do sistema" + 11 idiomas, troca na hora (menu, bandeja, notificações e erros do processo principal também) |
| Formato de data e números | "do sistema" fixo | **Implementado**: Do idioma / 1.234,56 / 1,234.56 (`prefs.region`), com exemplo ao vivo |
| Primeiro dia da semana | "em breve" | **Removido**: nenhuma tela usa calendário (o celular também não tem o ajuste) |
| Corretor ortográfico | interruptor travado ligado | **Implementado** (`prefs.spellcheck`, `setSpellCheckerEnabled`). No Linux: "indisponível", porque o Chromium baixaria dicionários da CDN do Google; o download foi bloqueado em todas as plataformas |
| Traduzir mensagens recebidas | "em breve" | **Honesto**: "indisponível — precisaria de um modelo de tradução neste computador; o Piu não manda mensagens a servidores de tradução" (o celular também não traduz) |
| Alertas de emergência | "só no celular" | **Implementado**: `communityAlert` do mensageiro ligado em `mesh.ts` → `core.ts` → aviso nativo (`main.ts`). Graves furam o Não perturbe, Atenção não; comunidade silenciada e o ajuste desligado calam; bloqueado, o aviso diz só "Alerta da comunidade · Abra o Piu para ver"; janela em foco vira aviso dentro do app. Novo ajuste `notifAlerts` |
| Pedidos de conversa por perto | "em breve" | **Honesto**: "só no celular". Por perto (visibilidade por 1 h, convite pago, taxa, reserva) só existe no celular e o design do desktop não tem essa tela; o computador não anuncia presença, então nunca recebe esses pedidos |
| Conectar outro aparelho | "em breve" | **Decisão de segurança, estado honesto** ("pelo celular"): outro computador entra pelo celular (Aparelhos → Conectar ao computador), que já existe e é seguro (X25519 + cert pinado + 3 palavras). Um computador vincular outro exigiria copiar a chave de identidade (não há chave por aparelho, regra 1.1); restaurar a frase em dois lugares cria cópias que não sincronizam. Não implementado de propósito |
| Bluetooth | interruptor "(em breve)" | **Honesto**: "só no celular" + motivo. Alternativas avaliadas: Web Bluetooth é só central e exige seletor a cada conexão; `@abandonware/noble` (central) e `bleno` (periférico, sem suporte no macOS recente) são módulos nativos por SO/arquitetura, sem auditoria; sem periférico dois computadores nunca se acham |
| Baixar mídia / Limpar cache de mídia | "em breve" ×2 | **Honesto**: uma linha "Fotos e arquivos · só texto" (o desktop troca só texto; não há mídia nem cache). Toast do clipe: "envie fotos e arquivos pelo celular" |
| Buscar na conversa | toast "próxima versão" | **Implementado**: barra de busca na conversa (filtra o que está neste computador, contador com plural, Esc fecha) |
| Convidar para grupo | toast "próxima versão" | **Implementado**: `groupInviteCandidates`/`addGroupMembers` (só contatos aceitos da mesma identidade, fora do grupo, não bloqueados) — `test/coreGroups.test.ts` |
| Sair do grupo / Deixar o canal | toast "próxima versão" | **Implementado**: `leaveGroup` (avisa os admins, esquece a chave, apaga a conversa daqui), com confirmação — `test/coreGroups.test.ts` |
| Créditos de rede (Carteira) | "em breve" | **Honesto**: "—" e "Créditos dependem do validador da rede, que ainda não está na Mainnet: nada é contado nem prometido" (E: chave do validador) |
| Bloqueados "Valer em todos os aparelhos" | "ainda não sincroniza" | **Honesto**: com identidade própria o computador não divide contatos com outro aparelho; vinculado, a lista é a do celular |

Restam como "só no celular"/"indisponível" (impossíveis hoje no desktop): Bluetooth, tradução local, Por perto, mídia/arquivos. Bloqueados por infraestrutura externa: chave GPG de release (atualização conferida), validador (créditos, pacotes de evidência), APK conferido para "Guardião + app".

## 3. Idiomas (i18n)

- Núcleo `src/shared/i18n/core.ts` (mesmo desenho do celular: `t`, `tIn`, plural CLDR por `Intl.PluralRules`, `{vars}`, região). `LANGS` idêntico ao do celular — teste compara item a item com `apps/mobile/src/i18n/core.ts`.
- pt-BR de referência em 9 áreas (`src/shared/i18n/pt-BR/*.ts`): **1.182 chaves** (renderer + processo principal: menu, bandeja, notificações, diálogos nativos, erros que viram toast).
- 10 dicionários completos (`pt-PT, en, es, fr, de, it, ja, zh, ar, hi`), tipados como `FullDict` (chave a mais ou a menos não compila). 248 textos por idioma reaproveitados do celular onde o pt-BR é idêntico; o resto traduzido.
- `test/i18n.test.ts` (7 testes): mesmos idiomas do celular; mesmas chaves, variáveis e forma (plural/texto) em todos; nenhum idioma é cópia do pt-BR; **nenhum texto em português solto no JSX** das telas; preferência validada no `setPrefs`; troca de idioma no processo principal; região.
- Árabe: `dir="rtl"` e `lang` na raiz; conferido nas capturas. Datas e números por `fmtDate`/`fmtNumber` (antes `toLocale*('pt-BR')` fixo).
- Ajustes no que veio do celular para o contexto do desktop: `common.done` (en "Done", de "Fertig", fr "Terminé", ja "完了"…) e `settings.unblock.action` ("Unblock", não "Unlock").

## 4. Tema claro/escuro e varredura das telas

Harness Playwright (`scratchpad/pw/final.mjs`, ponte falsa) em 18 telas (Entrada, Conversas, Detalhes de contato e de comunidade, Carteira, Ponto Piu, Bloqueio e as 11 páginas de Ajustes) × claro pt-BR, escuro pt-BR, escuro en, claro ar, claro ja: **0 erros de página/console, 0 chaves ou `{var}` vazando no texto visível**; `data-piu-theme` correto em todas. Cores fixas no renderer só nos cartões de QR/cartaz (branco de propósito, para leitura). Interações (`interact.mjs`): trocar idioma (UI vira inglês e grava `setPrefs`), região, alertas, corretor, busca na conversa (1 resultado), convidar (`groupInviteCandidates` → `addGroupMembers`) e sair (`leaveGroup`) — todos ✓.

## 5. Segurança (re-auditoria do app inteiro)

| ID | Sev. | Achado | Correção | Reteste |
|---|---|---|---|---|
| F-01 | **Crítica** (disponibilidade) | `dist/main.cjs` caía ao carregar: o openpgp chama `createRequire(import.meta.url)` e, em CommonJS, o esbuild troca `import.meta` por `{}` → `TypeError` e caixa "App threw an error during load". O app (dev e empacotado) não abria; os testes passavam porque rodam em ESM (tsx) | `build.mjs`: `define import.meta.url` + banner com `pathToFileURL(__filename)` | `test/bundle.test.ts` (novo); app empacotado sobe com renderer, rede e GPU, cria o cofre no perfil de teste |
| F-02 | Baixa | Com o Piu bloqueado, o evento `guardian` ainda ia ao renderer (o QR do ponto leva a senha do Wi-Fi) | Regras de bloqueio extraídas para `src/main/lockGate.ts`; `guardian` entra nos eventos ocultos | `test/lockGate.test.ts` (novo) |
| F-03 | Baixa (privacidade) | Corretor do Chromium baixa dicionários Hunspell da CDN do Google (Linux; idiomas fora do corretor nativo no Windows) | `setSpellCheckerDictionaryDownloadURL` para pasta local inexistente; corretor desligado no Linux | manual (código em `hardenSession`) |
| F-04 | Baixa/Info | `app.asar` levava 55 MB de `node_modules` de produção que nunca rodam (main/preload/renderer são empacotados) | `files: "!node_modules/**/*"` | asar 58 MB → 10 MB, só `dist/` + `package.json`; app sobe |
| F-05 | Info | Teste do app instalado sem tocar nos dados reais era impossível | `PIU_PROFILE=<[a-z0-9-]{1,24}>` → pasta `Piu-<nome>` e nome do app próprios (outro item de cofre). Não dá acesso ao perfil normal | `test/security.test.ts` |
| F-06 | Baixa (aberto) | `eraseAll` só tem a confirmação do renderer (sem confirmação nativa) | não alterado: o renderer é confiável (CSP, sandbox, sem `innerHTML`); recomendação: diálogo nativo como em `revealPhrase` | — |
| F-07 | Baixa (aberto, conhecido) | Fuse `GrantFileProtocolExtraPrivileges` ligado (renderer por `file://`, módulos ES precisam dele) | migrar para `protocol.handle('app')` e desligar o fuse | — |
| F-08 | Info (aberto) | Sem hardened runtime/notarização (sem Developer ID) | E | — |

Conferido sem achado novo: `contextIsolation`, `sandbox`, `nodeIntegration:false`, `webviewTag:false`, DevTools só fora do pacote; `enableSandbox()`; CSP estrita (`connect-src 'none'`); todo request do renderer fora da pasta do app é cancelado; navegação/redirect/webview/janelas bloqueados; `openExternal` só na allowlist; IPC só do quadro principal com URL do renderer + allowlist de métodos; com bloqueio só 6 métodos passam; novos IPCs de hoje (`groupInviteCandidates`, `addGroupMembers`, `leaveGroup`) validam tipo, tamanho e pertença no núcleo; `setPrefs` com allowlist (`lang`, `region`, `spellcheck`, `notifAlerts` com valores da lista — testes). Atualizador: nome do pacote por regex + URL igual ao prefixo de download do repositório, assinatura OpenPGP com impressão digital fixada, pacote na lista assinada, SHA-256 e tamanho na gravação, pasta 0700/arquivo 0600, instalação só a pedido. Guardião: semente própria do ponto cifrada com a chave do cofre, sondas só de conexão, sem leitura da senha do Wi-Fi do sistema. Logs: só fora do pacote, nenhum segredo. Fuses no pacote: RunAsNode off, cookies cifrados, NODE_OPTIONS e `--inspect` off, integridade do asar e só-asar on.

Dependências: `npm audit --omit=dev` no desktop = **0**. Com dev: 6 moderadas (cadeia `electron-builder` → `minimatch`/`glob`, só no build). `apps/mobile --omit=dev`: 8 moderadas (`glob`/`minimatch` do ferramental Expo; o desktop empacota só `@noble`/`@scure`/protocolo de lá) — para o dono do mobile. openpgp 6.3.1 fixado.

## 6. Testes e empacotamento

- `npm run typecheck`: sem erros. `npm test`: **196/196** (antes 181; novos: i18n ×7, lockGate ×2, bundle, alerta da comunidade na malha, convidar/sair do grupo, política e texto de alertas ×2, PIU_PROFILE). Inclui `lnnpLanPhone.test.ts` (desktop ↔ motor do celular).
- `npm run build`: ok (renderer 1,34 MB, 364 kB gzip — dicionários inclusos).
- `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dir` → `scratchpad/final-desktop/mac/Piu.app`: ad-hoc, `net.piu.desktop`, `icon.icns` + `assets/icon.png`, `NSLocalNetworkUsageDescription` presente, fuses conferidos. `artifactName` `Piu-<versão>-<so>-<arch>.<ext>` bate com `pickAsset` do atualizador.
- Smoke do app instalado: `PIU_PROFILE=smoke PIU_HIDE_WINDOW=1 PIU_LNNP_PORT=0 PIU_LNNP_DISCOVERY_PORT=off PIU_POINT_PORT=0 Piu --use-mock-keychain` → processo vivo, 3 auxiliares (renderer/GPU/rede), `Piu-smoke/vault/datakey.bin` criado, sem diálogo de erro; nenhum item "Piu-smoke Safe Storage" no Keychain; perfil apagado depois.

## 7. Bloqueios reais que restam

1. Chave GPG de release vazia (`releaseKey.ts`): atualização fica em "verificação indisponível" (E).
2. Validador/caixa de evidências e endereço da caução: créditos de rede e pacotes de evidência do gateway (E).
3. Developer ID / Authenticode: hardened runtime, notarização, SmartScreen (E, decisão de 06/11).
4. APK conferido baixável pelo desktop para "Guardião + app" (não feito).
5. Mídia/arquivos no desktop (só texto), Por perto e alertas na lista da comunidade (o desktop avisa, mas não lista nem publica alertas) — escopo de produto.
6. Bluetooth e tradução local — sem caminho seguro no Electron hoje.
