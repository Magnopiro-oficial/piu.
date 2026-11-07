# Auditoria final — checklist das atividades de 05–06/11/2026

Status: **I** implementado e testado · **P** parcial · **N** não implementado · **F** implementado com falhas · **E** depende de infraestrutura/decisão externa (documentado, não aprovado).
A coluna "Prova" registra como foi comprovado (teste, build, render comparado com o protótipo, teste em aparelho).

| # | Atividade | Produto | Status | Prova / pendência |
|---|---|---|---|---|
| 1 | Melhorias de design (zip 1): animações PT/EN do site, seção Desktop, QR animado do Receber, segurar para assinar, cena de pagamento, pareamento QR do Desktop, contagem da carteira | Site, Mobile, Desktop | | |
| 2 | Assinatura das versões desktop: SHA256SUMS com GPG, assinatura .deb/.AppImage, ad-hoc no Mac | Desktop, Provider | | GPG: chave ainda não gerada (E) |
| 3 | Login do Desktop pelo celular (texto "Conectar ao computador", redirecionamento em Aparelhos) | Desktop, Mobile | | |
| 4 | Carteira Enviar/Receber conforme especificação (contatos, valor 5, chips, QR em onda) | Desktop, Mobile | | |
| 5 | Leitor de QR no Enviar do celular; animação do QR do Receber | Mobile | | |
| 6 | Endereço Lunes nos contatos (payload `wa`, só públicos aceitos) | Mobile, Desktop | | |
| 7 | QR do Receber do Desktop igual ao do login; rolagem discreta | Desktop | | |
| 8 | Fontes empacotadas em todos os apps | Todos | | |
| 9 | Revisão de design tela a tela (celular, Desktop, painel do Provider) | Todos | | |
| 10 | Auditoria AppSec (OWASP), correções sem mudança de protocolo | Todos | | |
| 11 | Prova de entrega v2 do liquidante + correções do consultor | Core/Settlement, Mobile, Node | | Chave do validador (E) |
| 12 | Assinatura Apple/Windows preparada por variáveis | Desktop, Provider | | Decisão 06/11: lançar sem certificados (Mac ad-hoc, Windows sem assinatura); site mantém o passo a passo "abrir mesmo assim" |
| 13 | Biometria presa ao cofre com migração | Mobile | | |
| 14 | SHA-256 no envio do APK (tela e página Wi-Fi Direct) | Mobile | | |
| 15 | Site: downloads de fonte única, segurança, instalação, verificação, textos honestos | Site | | Releases a publicar (E) |
| 16 | Modo nó no celular: lógica, antifraude, regras do desenho (100 LUNES, 3 avais…) | Mobile, Settlement, Node | | Endereço da caução (E) |
| 17 | Itens "em breve" das Configurações do Desktop | Desktop | | |
| 18 | Telas do Desktop D1–D4 / E1–E5 (bloqueio, atualizações, bloqueados, armazenamento, guardião) | Desktop | | |
| 19 | Painel do Piu Node com gateway (E3) | Provider/Node | | |
| 20 | Transações e provas pela malha até gateway | Mobile, Node, Desktop, Settlement | | |
| 21 | Telas do modo nó e malha no celular (Piu 11, N1–N10) | Mobile | | |
| 22 | Transporte Wi-Fi local (LNNP) no celular — fase 1 | Mobile | | Teste em aparelho |
| 23 | Pontos Piu — lógica fase 2 + telas Piu 13 (P1–P9) | Mobile | | |
| 24 | Página "A rede" no site | Site | | |
| 25 | Fluxograma da rede publicado | Docs | I | main b9bb979 |
| 26 | Desktop: perfil e configurações sem "em breve", idiomas (11), tema claro/escuro | Desktop | | |
| 27 | Nova auditoria de segurança de todo o ecossistema + correções | Todos | | |
| 28 | Testes unitários, integração, E2E, build, instalação | Todos | | |
| 29 | Consolidação na `main` (sem force push, preservando trabalho existente) | Git | | |
| 30 | Auditoria pós-merge | Todos | | |
| 31 | APK 0.1.1 assinado + teste real no A31 com Desktop no mesmo roteador | Mobile, Desktop | | Senha da chave (usuário) |
