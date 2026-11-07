# Auditoria final — `apps/mobile` (06/11/2026)

Escopo: linhas do celular no `CHECKLIST.md` (1, 3, 4, 5, 6, 8, 9, 10, 13, 14, 16, 20, 21, 22, 23, 27, 28, 31), placeholders, nova passada de segurança no app inteiro, testes e build. Nada foi commitado; nada foi enviado à Mainnet; a senha da chave de release não foi usada (sem `assembleRelease`).

Legenda: **I** implementado e testado · **P** parcial · **N** não implementado · **F** com falhas · **E** depende de infraestrutura/decisão externa.

## 1. Requisitos (celular)

Prova de render: servidor web do Expo (`expo start --web`, porta 8099). Todas as rotas alcançáveis a partir das abas (68 caminhos, inclusive com ids inexistentes) e as duas galerias de desenvolvimento (`/__dev/node?id=N1…N10c`, 39 telas; `/__dev/pontos?id=P1…P9`, 25 telas) foram abertas uma a uma num iframe, com `console.error` e `window.onerror` capturados. Resultado: **0 erros de console, 0 telas em branco** (ver seção 4).

| # | Item | Status | Prova |
|---|---|---|---|
| 1 | Design zip 1 (QR animado do Receber, segurar para assinar, cena de pagamento, pareamento QR do Desktop, contagem da carteira) | I | `ui/QrWave.tsx` (respeita `reduceMotion`), `ui/HoldToSign.tsx` usado em `WalletSheets`/`NodeViews`/`PhoneNode`, `ui/PayScene.tsx`, `app/link-desktop.tsx`; `walletMotion.test.ts`; aba Carteira renderiza sem erro |
| 3 | Login do Desktop pelo celular ("Conectar ao computador", redirecionamento em Aparelhos) | I | `profile.row.desktop`; `devices.tsx` desvia QR `piu-link:` para `/link-desktop`; `desktopLink.test.ts` |
| 4 | Carteira Enviar/Receber (contatos, valor, chips, QR em onda) | I | `ui/WalletSheets.tsx`; `walletSend.test.ts`, `walletSelection.test.ts`, `walletTransfer.test.ts` |
| 5 | Leitor de QR no Enviar; animação do QR do Receber | I | botão de leitura em `WalletSheets` (`onScan`/`scanning`); `QrWave`. Câmera real: só no aparelho (checklist abaixo) |
| 6 | Endereço Lunes nos contatos (payload `wa`, só públicos aceitos) | I | `messenger.ts` (`wa`: contato público aceito, `used === 'public'`, ≤ 64 chars, `isLunesAddress`); `messenger.test.ts` |
| 8 | Fontes empacotadas | I | `expo-font` no `app.json` + `useFonts(FONT_FILES)` em `_layout.tsx` (Geist/Geist Mono locais) |
| 9 | Revisão de design tela a tela | P | Galerias N1–N10c e P1–P9 renderizam sem erro; as telas antigas do Piu 9 (`pn.m2b.*`, `pn.m3.*`, `pn.connect.*`…) não são mais usadas (chaves removidas). Comparação pixel a pixel com `design/handoff` não refeita nesta passada |
| 10 | AppSec (OWASP) sem mudança de protocolo | I | `docs/seguranca/auditoria-2026-11-06/mobile-site.md` (A-01…B-07 corrigidos) + seção 3 abaixo |
| 13 | Biometria presa ao cofre com migração | I | `lib/phraseVault.ts`, `lib/vault.ts`, `app/vault-recover.tsx`; `phraseVault.test.ts`; `docs/seguranca/biometria-cofre.md`. Leitura com biometria real: só no aparelho |
| 14 | SHA-256 no envio do APK (tela e página Wi-Fi Direct) | I | `ui/ApkIntegrityCard.tsx`, `lib/wifiShare.ts`, `lib/pointPage.ts`, `ApkIntegrity.kt`; `apkIntegrity.test.ts`, `pointPoster.test.ts` |
| 16 | Modo nó no celular (100 LUNES, 3 avais, antifraude) | I + E | `lib/phoneNodeCore.ts` (`PHONE_NODE_BOND = '100'`), `protocol/phoneNode.ts`; `phoneNodeCore.test.ts`, `phoneNode.test.ts`, `phoneNodeView.test.ts`. **E:** `BOND_ADDRESS = null` → N3a mostra estado específico (ver seção 2) |
| 20 | Transações e provas pela malha até gateway | I + E | `protocol/carry.ts` (tetos 512 B/12 KB/120 chars), `lib/walletCarry.ts`, `lib/carryGateway.ts`; `carry.test.ts`, `walletCarry.test.ts`, `carryGateway.test.ts`, `evidenceCarry.test.ts`. **E:** `VALIDATOR_PROOF_PK = null`, `VALIDATOR_INBOX_URL = null` → linha N10 "Validador ainda não configurado" |
| 21 | Telas do modo nó e malha (Piu 11, N1–N10) | I | `/__dev/node` 39 estados sem erro; rotas `provider/phone/*`, `wallet/mesh`, `wallet/transit` renderizam (transit sem transferência volta para a Carteira) |
| 22 | Transporte Wi-Fi local (LNNP) fase 1 | I (teste em aparelho pendente) | `transport/lan/*`, `modules/piu-lan` (Kotlin compila); `lan.test.ts` (teste instável corrigido, seção 2), `lanBridge.test.ts` |
| 23 | Pontos Piu fase 2 + telas P1–P9 | I | `/__dev/pontos` 25 estados sem erro; rotas `point/*` renderizam; `pointCore.test.ts`, `pointPoster.test.ts`; página local endurecida (seção 3) |
| 27 | Nova auditoria de segurança + correções | I | seção 3 |
| 28 | Testes unitários/integração/build | I | seção 4 |
| 31 | APK 0.1.1 assinado + teste no A31 | E | versão conferida e travada por teste (seção 4); `assembleRelease` fica com quem tem a senha |

## 2. Placeholders

Busca: `em breve`, `soon`, `breve`, `TODO`, `FIXME`, controles `disabled` sem ação, em `src/app`, `src/ui`, `src/lib`, `src/state` e nos 33 dicionários.

| Onde | Antes | Depois |
|---|---|---|
| Idioma → "Traduzir mensagens recebidas" | chave desligada, sem ação, "· Em breve" | **removida** (não há modelo de tradução local no pacote). `lang.note` reescrita nos 11 idiomas: não promete mais tradução ("Mensagens nunca são enviadas a um servidor para tradução.") |
| N3a (folha da caução sem endereço) | título "Caução em breve" | "Endereço da caução ainda não publicado" (11 idiomas); corpo já dizia o motivo; botão segue desligado de propósito, com o motivo na mesma folha |
| M1/N2 requisito "Programa de caução" | "Ainda não abriu · em breve" | "Não abriu · endereço da caução não publicado" (11 idiomas) |
| `lib/pointWifi.ts` (comentário) | "a tela mostra em breve" | descreve os erros reais (`unavailable`, `permission`, `busy`, `unsupported`, `failed`) |

Controles desligados que ficaram (estado honesto, com motivo na própria tela): N3a "Pagar caução" (sem `BOND_ADDRESS`), N10 "Enviar" (sem validador / mensageiro abrindo), N7 "Aguardando a caução" (prazo de devolução correndo). Nenhum TODO/FIXME em código de interface.

**Bloqueados por infraestrutura externa (E):**
- `BOND_ADDRESS` (`lib/phoneNodeCore.ts`) = `null` → N3a / requisito "programa".
- `VALIDATOR_PROOF_PK` (`protocol/proof.ts`) = `null` e `VALIDATOR_INBOX_URL` (`lib/carryConfig.ts`) = `null` → N10 "Validador ainda não configurado"; provas v2 não seladas.
- Chave GPG (site/desktop) — fora do celular.

**Chaves i18n mortas removidas:** 193 chaves × 11 idiomas (2.112 linhas) — `pn.m1.*`, `pn.m2.*`, `pn.m2b.*`, `pn.m2e1/2.*`, `pn.m3.*`, `pn.m3e/v.*`, `pn.m4.*`/`m4v`, `pn.m5.*`, `pn.m6.*`/`m6b`/`m6e`, `pn.hold.*`, `pn.connect.*`, `pn.notif.title/body`, `pn.relaying`, `provConnect.phone.*`, `provConnect.sendPkg`, `common.soon`, `common.on`, `common.copied`, `lang.translate*`, `backup.noLock`, `wallet.sendSheet.*` antigas, entre outras. Critério: a chave não aparece literal em nenhum `.ts/.tsx` fora dos dicionários (inclusive testes e galerias), nem como `k:chave`, nem coberta por prefixo dinâmico (`` `pn.req.${k}` ``, `` `alertCat.${id}` ``…). Paridade dos 11 idiomas: `i18n.test.ts` passa.

**Teste instável corrigido:** `transport/__tests__/lan.test.ts` "dois celulares no mesmo Wi-Fi… nome curto". Causa: `hintWaitMs: 30` — sob carga (suíte inteira), o prazo vencia antes do `NODE_HINT` chegar e o aviso `up` saía sem nome. O motor já avisa **assim que** o nome chega (`engine.announce` no `NODE_HINT_FRAME`), então o teste agora usa prazo de 5 s só nesse caso: o `up` com nome não depende mais de corrida de relógio. Asserções iguais. Conferido: 15 execuções isoladas + 18 execuções do arquivo em paralelo (6 por vez) — 0 falhas.

## 3. Segurança (app inteiro)

Achados anteriores (A-01…B-07) continuam corrigidos; conferido de novo no render: `/restore` e `/migrate` com identidade existente voltam para `/` (A-01). `npm audit --omit=dev`: 0 high, 0 critical (8 moderate, cadeia de ferramentas do Expo).

### Novos achados desta passada

| ID | Severidade | Local | Problema | Correção | Reteste |
|---|---|---|---|---|---|
| F-01 | Média | `modules/piu-app-share/…/PiuAppShareModule.kt` (`serve`, página do ponto :8766 e Wi-Fi Direct :8765) | Uma thread por conexão **sem teto** e `readLine()` **sem limite**: qualquer visitante da rede do ponto (aberta por definição) derrubava o app abrindo conexões ou mandando uma linha sem fim (memória) | Teto de 12 conexões (`Semaphore`; acima disso fecha na hora); linha de pedido lida byte a byte até 1 KB (mais longa = descartada); `soTimeout` 15 s mantido | `compileReleaseKotlin` OK; comportamento real no A31 (checklist) |
| F-02 | Baixa | idem `startLanShare` + `lib/pointWifi.ts` | O IP do `bind` vinha do JS sem conferência: `0.0.0.0` exporia a página em todas as interfaces (inclusive dados móveis); nome em vez de IP faria DNS | JS: `pointPageBindOk(ip)` (só IPv4 RFC 1918 canônico) antes de chamar o nativo; Kotlin: regex IPv4 + `Inet4Address.isSiteLocalAddress`, porta 1024–65535, erro `ERR_BIND` | `pointPoster.test.ts` (+1: aceitos/recusados) |
| F-03 | Baixa | idem `apkCopy` | Nome do arquivo vai no `Content-Disposition`; só tirava diretório (`File(name).name`), não CR/LF/aspas | Nome precisa casar `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.apk$` (é o que `apkShareName` gera) | compila; nomes atuais passam (`Piu-0.1.1.apk`) |
| F-04 | Baixa | idem cabeçalhos | Só CSP básica | CSP com `frame-ancestors 'none'; form-action 'none'; base-uri 'none'` + `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` nas duas respostas; 404 com `nosniff` | compila |
| F-05 | Baixa (processo) | `app.json` | Sem `android.versionCode`: um `expo prebuild` voltaria o `build.gradle` para `versionCode 1`, e o Android recusaria o APK novo por cima do 0.1.1 (versionCode 2) | `android.versionCode: 2` no `app.json`; `package.json`/lock 0.1.1 | `releaseSigning.test.ts` (+1: app.json = build.gradle = package.json) |

### Conferido sem achado novo

- **Frase/cofre:** frase só no item com biometria (`unlockPhrase`), chaves do dia separadas; migração com estados intermediários testada (`phraseVault.test.ts`); `restore` não troca frase existente sem `replace` (`identityGuard.test.ts`).
- **Assinatura:** `checkedSigned` confere o hash do extrínseco assinado contra a cotação; transferência pela malha usa era imortal + trava de nonce (`walletCarry.test.ts`); pedido de pagamento do Desktop (`parseDesktopPayment`) valida id UUIDv4, SS58 de origem e destino, valor com regex e expira em 120 s; a tela exige gesto + biometria e confere `expectedFrom` (`desktopPayment.test.ts`).
- **LAN (`piu-lan`):** TCP preso ao IP do Wi-Fi (ou do hotspot), UDP com `Network.bindSocket`; teto de conexões (4–128), fila de envio 512 KB, quadro ≤ limite do handshake, datagrama ≤ 64 B e 100/s, fila mDNS 32 e 30 resoluções/min.
- **Falsificação de `NODE_HINT`:** um vizinho na mesma rede pode anunciar o nome curto de outro (`piu-xxxxxx`) e o enlace dele entra no mesmo vizinho lógico (`transport/multi.ts`). Efeito: desvio/descarte de envelopes de **um salto** para esse vizinho (disponibilidade). Não abre conteúdo (envelopes cifrados ponta a ponta, recibos de entrega continuam pendentes e o reenvio segue). O mesmo já vale para o nome no anúncio BLE. **Baixa, aceito** — fechar exige amarrar o nome à chave do nó (mudança de protocolo, fora do escopo).
- **Payloads novos:** `wa` (público aceito, ≤ 64, SS58 Lunes), `ar` (`p` hex 64, `createdAt` do futuro vira agora), `av` (assinatura conferida e `phonePk` tem de ser o meu), `ns` (inteiro ≥ 0, só afeta a elegibilidade exibida; o validador decide), carga tipo 5 (tetos acima, `decodeCarryItem` recusa fora do limite).
- **Deep links:** só `piu://` (`BROWSABLE`); onboarding/restauração bloqueados com identidade; `?send=`/`wallet/mesh?dest=&amount=` só preenchem a folha — assinar exige segurar + biometria (Info: um link pode pré-preencher destino; a pessoa vê o destino antes de segurar).
- **Manifesto de release** (`processReleaseManifest`): sem `usesCleartextTraffic`, `allowBackup="false"`; `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` e `c2dm.RECEIVE` fora; BLE/Wi-Fi com `neverForLocation`, localização só até API 32. Exportados: `MainActivity` (launcher + `piu://`) e componentes de biblioteca protegidos por permissão de sistema (`c2dm.SEND`, `EXPOSURE_CALLBACK`, `DUMP`).
- **Notificações:** `present()` troca título/corpo por texto genérico conforme a prévia; canais Android com `lockscreenVisibility`.
- **Logs:** nenhum `console.*` com segredo (só `piuSound`); Kotlin só loga falhas de BLE/serviço.

## 4. Testes e build

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npm test` (mobile) | **590/590** (antes 588; +1 página do ponto, +1 versão), rodando junto com o servidor web e o render das galerias (máquina carregada) |
| `node --test lan.test.ts` 6× em paralelo, 3 rodadas | 18/18 sem falha |
| `:app:compileReleaseKotlin :app:processReleaseManifest --offline -PallowDebugSignedRelease` | BUILD SUCCESSFUL |
| `expo export --platform android` | bundle Hermes 7,3 MB gerado; conteúdo das galerias (`src/dev/*Gallery.tsx`) ausente do bundle (só os nomes das funções de rota, que redirecionam para `/`) |
| Navegação web (68 rotas + 64 telas de galeria) | 0 erros de console, 0 telas em branco |
| `apps/desktop` `npm test` | 186/188: as 2 falhas são de `test/i18n.test.ts` do **próprio Desktop** (`src/shared/i18n`, "pt-PT sem dicionário"), trabalho em andamento de outro agente; nada importa os arquivos do celular alterados aqui |
| Versão | `app.json` 0.1.1 / `versionCode 2` = `build.gradle` 0.1.1 / 2 = `package.json` 0.1.1 (travado por teste) |

## 5. Teste real no A31 (checklist curto)

1. Instalar o APK 0.1.1 por cima do 0.1.0 (sem desinstalar): abre, conversas e carteira intactas.
2. Cofre: Backup pede biometria do sistema; trocar biometria → `/vault-recover` aparece.
3. Carteira: Receber (QR em onda), Enviar lendo QR com a câmera, segurar para assinar, cena de pagamento.
4. Desktop no mesmo roteador: "Conectar ao computador" (QR), pedido de pagamento do Desktop até "finalizado".
5. LAN: `docs/rede/teste-lan-celular.md` seções 1–3 e 8 (com e sem internet no roteador).
6. Ponto Piu com distribuição: abrir `http://<ip>:8766/` em outro celular, baixar o APK, conferir SHA-256; abrir ~20 abas ao mesmo tempo → o app do guardião continua respondendo (F-01).
7. Enviar o Piu por Wi-Fi Direct e Bluetooth (regressão do `apkCopy`/cabeçalhos).
8. Som do piu, teclado do chat, bloqueio de captura só no chat.
9. Modo nó: N1 → folha da caução mostra "Endereço da caução ainda não publicado".

## 6. Arquivos alterados

Nenhum arquivo sincronizado com `piu-node`/`settlement` (protocol/, lib/lunes*) foi alterado; nenhum arquivo importado pelo Desktop foi alterado. Lista:

- `apps/mobile/app.json`, `package.json`, `package-lock.json` (versão)
- `apps/mobile/modules/piu-app-share/android/src/main/java/expo/modules/piuappshare/PiuAppShareModule.kt`
- `apps/mobile/src/lib/pointPage.ts`, `src/lib/pointWifi.ts`
- `apps/mobile/src/app/language.tsx`
- `apps/mobile/src/i18n/{ar,de,en,es,fr,hi,it,ja,pt-BR,pt-PT,zh}.ts`, `src/i18n/piu11/*.ts`, `src/i18n/pontos/*.ts`
- testes: `src/lib/__tests__/pointPoster.test.ts`, `src/lib/__tests__/releaseSigning.test.ts`, `src/transport/__tests__/lan.test.ts`
