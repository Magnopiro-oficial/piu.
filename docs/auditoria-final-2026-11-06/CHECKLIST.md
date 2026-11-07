# Auditoria final — checklist das atividades de 05–06/11/2026

Status: **I** implementado e testado · **P** parcial · **N** não implementado · **F** implementado com falhas · **E** depende de infraestrutura/decisão externa (documentado, não aprovado).
A coluna "Prova" registra como foi comprovado (teste, build, render comparado com o protótipo, teste em aparelho).

| # | Atividade | Produto | Status | Prova / pendência |
|---|---|---|---|---|
| 1 | Melhorias de design (zip 1): animações PT/EN do site, seção Desktop, QR animado do Receber, segurar para assinar, cena de pagamento, pareamento QR do Desktop, contagem da carteira | Site, Mobile, Desktop | I | mobile.md §1, desktop.md §1, site.md §1; telas renderizadas sem erro |
| 2 | Assinatura das versões desktop: SHA256SUMS com GPG, assinatura .deb/.AppImage, ad-hoc no Mac | Desktop, Provider | E | SHA256SUMS.txt em toda versão (conferido pelo sync-release); Mac ad-hoc; assinatura GPG espera a chave (não gerada) |
| 3 | Login do Desktop pelo celular (texto "Conectar ao computador", redirecionamento em Aparelhos) | Desktop, Mobile | I | desktopLink.test.ts (celular e Desktop); teste com aparelho pendente (#31) |
| 4 | Carteira Enviar/Receber conforme especificação (contatos, valor 5, chips, QR em onda) | Desktop, Mobile | I | walletSend/paymentJournal/coreWallet; o Desktop nunca assina |
| 5 | Leitor de QR no Enviar do celular; animação do QR do Receber | Mobile | I | WalletSheets + QrWave; câmera real só no aparelho (#31) |
| 6 | Endereço Lunes nos contatos (payload `wa`, só públicos aceitos) | Mobile, Desktop | I | messenger.test.ts, coreWallet.test.ts |
| 7 | QR do Receber do Desktop igual ao do login; rolagem discreta | Desktop | I | mesmo RealQr + qrWave |
| 8 | Fontes empacotadas em todos os apps | Todos | I | Geist local em celular, Desktop e site (CSP font-src self) |
| 9 | Revisão de design tela a tela (celular, Desktop, painel do Provider) | Todos | P | Desktop 18 telas × 5 combinações; celular galerias N/P sem erro; comparação pixel a pixel do celular não refeita |
| 10 | Auditoria AppSec (OWASP), correções sem mudança de protocolo | Todos | I | docs/seguranca/auditoria-2026-11-06 + correções aplicadas |
| 11 | Prova de entrega v2 do liquidante + correções do consultor | Core/Settlement, Mobile, Node | I + E | 76/76 no settlement, demo ponta a ponta; ativação espera VALIDATOR_PROOF_PK |
| 12 | Assinatura Apple/Windows preparada por variáveis | Desktop, Provider | E | Preparado por variáveis; decisão 06/11: lançar sem certificados (Mac ad-hoc, Windows sem assinatura); site explica "abrir mesmo assim" |
| 13 | Biometria presa ao cofre com migração | Mobile | I | phraseVault.test.ts; leitura com biometria real pendente (#31) |
| 14 | SHA-256 no envio do APK (tela e página Wi-Fi Direct) | Mobile | I | apkIntegrity.test.ts, pointPoster.test.ts |
| 15 | Site: downloads de fonte única, segurança, instalação, verificação, textos honestos | Site | I | releases.json via sync-release (Android 0.1.1, Desktop, Provider 0.1.1 publicados 07/11); textos honestos; convite = pagamento único |
| 16 | Modo nó no celular: lógica, antifraude, regras do desenho (100 LUNES, 3 avais…) | Mobile, Settlement, Node | I + E | 100 LUNES, 3 avais, 7 dias em app, validador, desenho e docs; endereço da caução (E) |
| 17 | Itens "em breve" das Configurações do Desktop | Desktop | I | grep sem "em breve"; teste de dicionário |
| 18 | Telas do Desktop D1–D4 / E1–E5 (bloqueio, atualizações, bloqueados, armazenamento, guardião) | Desktop | I | appLock, lockPassword, storageUsage, updater, guardian tests |
| 19 | Painel do Piu Node com gateway (E3) | Provider/Node | I | 24 verificações por curl + painel no navegador (core-node-provider.md §19) |
| 20 | Transações e provas pela malha até gateway | Mobile, Node, Desktop, Settlement | I + E | gateway.test.ts celular→relay→gateway→Lunes simulada; Desktop gateway só com PIU_GATEWAY=1; caixa do validador (E) |
| 21 | Telas do modo nó e malha no celular (Piu 11, N1–N10) | Mobile | I | /__dev/node 39 estados sem erro |
| 22 | Transporte Wi-Fi local (LNNP) no celular — fase 1 | Mobile | I | lan.test.ts; teste com Desktop no mesmo roteador pendente (#31) |
| 23 | Pontos Piu — lógica fase 2 + telas Piu 13 (P1–P9) | Mobile | I | /__dev/pontos 25 estados; limite único 1 GB · 7 dias (padrão 512 MB) desde 07/11 |
| 24 | Página "A rede" no site | Site | I | /rede PT e EN no ar desde 06/11 (b4e5692) |
| 25 | Fluxograma da rede publicado | Docs | I | main b9bb979 |
| 26 | Desktop: perfil e configurações sem "em breve", idiomas (11), tema claro/escuro | Desktop | I | desktop.md §2–4; "Avisar quando sair versão nova" ligado de fábrica (07/11) |
| 27 | Nova auditoria de segurança de todo o ecossistema + correções | Todos | I | 16 achados novos no núcleo, 14 corrigidos; Desktop: fuse de file:// desligado e confirmação nativa ao apagar tudo (07/11) |
| 28 | Testes unitários, integração, E2E, build, instalação | Todos | I + E | Todos os testes locais e CI verdes; instalação: Desktop baixado do GitHub abre no Mac; aparelho pendente |
| 29 | Consolidação na `main` (sem force push, preservando trabalho existente) | Git | I | main com commits por componente, merge e9f0627, sem force push, branches preservadas |
| 30 | Auditoria pós-merge | Todos | I | CI da main verde (mobile, piu-node, settlement, desktop, provider, site, OpenWrt); releases publicados |
| 31 | APK 0.1.1 assinado + teste real no A31 com Desktop no mesmo roteador | Mobile, Desktop | P | APK 0.1.1 assinado (cert 595bdc6a…) e publicado; teste no A31 pendente (depuração sem fio desligada) |
