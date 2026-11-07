# Relatório final — auditoria, conclusão e integração (05–07/11/2026)

Status usados: **I** implementado e testado · **P** parcial · **E** depende de algo externo (documentado, não declarado pronto).
Detalhe por item em [CHECKLIST.md](CHECKLIST.md); detalhe por produto em [mobile.md](mobile.md), [desktop.md](desktop.md),
[core-node-provider.md](core-node-provider.md) e [site.md](site.md).

## 1. O que foi auditado

As 31 atividades de 05–06/11, cobrindo:
- design;
- carteira;
- login do Desktop;
- assinatura das versões;
- AppSec;
- prova de entrega v2;
- biometria;
- modo nó;
- malha até o gateway;
- Wi-Fi local;
- Pontos Piu;
- página "A rede";
- fluxograma;
- Desktop sem itens pendentes.

Mais os ajustes de 07/11: convite, regra única de limites, Desktop 0.1.1, página de Ajuda, textos do celular e do Provider em 11 idiomas sem prometer LUNES, pacotes do Piu Node (.ipk e .deb) e Provider 0.1.2.

## 2. Implementado e testado (I)

- **24 das 31 linhas estão em I.** Destaques:
  - carteira Enviar/Receber no celular e no Desktop (o Desktop nunca assina);
  - frase presa à biometria, com migração e recuperação;
  - SHA-256 no envio do APK;
  - telas N1–N10 e P1–P9;
  - Desktop com bloqueio (senha do Piu e Touch ID), atualizações com GPG e SHA-256, guardião, 11 idiomas e tema claro/escuro;
  - painel do Piu Node com gateway;
  - página "A rede" no ar.
- **Regra única (07/11).** Guardião e Ponto Piu aceitam até 1 GB e até 7 dias, com padrão de 512 MB e 7 dias, igual no celular e no Desktop. Mais que isso não faz sentido: um envelope vale no máximo 7 dias no protocolo (`MAX_TTL_SEC`). O celular oferecia até 4 GB e 30 dias e foi corrigido; um ponto salvo com valores antigos volta ao padrão.
- **Modo nó.** Valores reais em código, validador, protótipos e docs: caução de 100 LUNES, 3 avais, 7 dias e até 5 avais por mês. Os protótipos e briefings antigos diziam 10 LUNES e 2 avais.
- **Site.** O cartão de distribuição agora diz "pagamento único por convite, até 20 convidados por mês". Antes parecia 20 LUNES por mês por amigo.

## 3. Parcial (P)

- **#9 Revisão de design do celular.** As telas renderizam sem erro, mas a comparação pixel a pixel com `design/handoff` não foi refeita.
- **#31 APK 0.1.1.** Está assinado (certificado `595bdc6a…`), conferido (versão 0.1.1, código 2, sem RECORD_AUDIO, SYSTEM_ALERT_WINDOW nem c2dm) e publicado. Falta o teste no A31, porque a depuração sem fio estava desligada.
  - O APK 0.1.2 (07/11, código 3, mesmo certificado) traz a regra única do Ponto Piu, a tela "Conectar ao computador" em 11 idiomas e os textos sem prometer LUNES. Também falta o teste no A31.

## 4. Não implementado (N)

Nenhum item do checklist.

Os guias de Ajuda que dependem de comandos inexistentes, como os de rádio do piu-node, foram tratados à parte; ver `docs/ajuda/ANALISE.md`.

## 5. Falhas encontradas e corrigidas nesta rodada

- **Desktop não abria empacotado.** O openpgp virava `{}` no bundle CJS. Corrigido em `build.mjs` com `test/bundle.test.ts`.
- **CI quebrado ao chegar na `main`:**
  - os testes do celular liam `android/`, que não é versionado (agora pulam sem a pasta);
  - o piu-node usa o settlement nos testes, e o CI não o instalava;
  - o Mac sem certificado quebrava o electron-builder (`CSC_LINK=""`);
  - o runner `macos-14` foi aposentado (agora `macos-15`).
- **Textos do site que prometiam demais:**
  - "Todos assinados";
  - a carteira offline;
  - iPhone e App Store;
  - "Como ganho LUNES";
  - "Wi-Fi Mesh";
  - mensagens guardadas por 7 dias (o certo é 48 h);
  - o convite.

## 6. Segurança

- **Auditoria AppSec (OWASP) de todo o ecossistema.** Relatórios em `docs/seguranca/auditoria-2026-11-06/`, com a seção "Correções aplicadas".
- **Nova passada final:**
  - 16 achados no núcleo, 14 corrigidos ou mitigados com teste;
  - no celular, achados novos corrigidos (mobile.md §3).
- **Desktop 0.1.1 (07/11):**
  - a interface sai de file:// para `piu-app://app/`, que serve só arquivos de `dist/renderer` com a CSP no cabeçalho;
  - o fuse `GrantFileProtocolExtraPrivileges` foi desligado (confirmado com `@electron/fuses read`);
  - "Apagar tudo" pede confirmação nativa no processo principal, em 11 idiomas, para que um renderer comprometido não apague nada sozinho.
- **Abertos e documentados:**
  - o GitHub Pages ignora cabeçalhos de segurança;
  - 8 alertas moderados em dependências de desenvolvimento do celular;
  - resíduo M-N1 (abuso do gateway, mitigado por limites).

## 7. Integração entre produtos

- **Celular ↔ Desktop:**
  - pareamento com escolha da 3ª palavra;
  - endereço Lunes nos contatos;
  - pedido de pagamento ao celular.
- **Celular → relay → piu-node gateway → Lunes:** recibos voltam pela malha (`gateway.test.ts`).
- **piu-node ↔ settlement:** registro v2 lido pelo validador de verdade, nos testes e no CI.
- **Painel do Provider ↔ piu-node:** 24 verificações por `curl` e um teste no navegador.
- **Código compartilhado:** as cópias no piu-node e no settlement continuam iguais às do celular (`sync-lunes`, `sync-protocol`).

## 8. Testes

| Produto | Typecheck | Testes | Build |
|---|---|---|---|
| Celular | ok | 603/603 | APK release assinado |
| Desktop | ok | 197/197 | empacotado (Mac x64 local) e 7 instaladores no CI |
| piu-node | ok | 122/122 | ok |
| Settlement | ok | 76/76 | ok |
| Painel do Provider | ok | 99/99 | ok |
| Provider Desktop | ok | 4/4 | 7 instaladores no CI |
| OpenWrt | — | 19/19 | `.ipk` no CI |
| Linux (`.deb`) | — | 16/16 | `.deb` no CI; instalado com systemd em Debian 13 (Docker) |
| Site | ok (`astro check`) | — | ok, publicado |

Instalação:
- **Desktop 0.1.0:** baixado do GitHub, o SHA-256 confere e o app abre no Mac.
- **Desktop 0.1.1:** empacotado localmente, abre pelo `piu-app://`.
- **Celular:** pendente no A31.

## 9. Consolidação na `main`

- **Commits por componente:**
  - mobile;
  - piu-node;
  - settlement;
  - desktop;
  - provider-desktop;
  - site e painel;
  - OpenWrt;
  - CI;
  - docs.
- **Merge:** `e9f0627`, que trouxe a `main` com o site `b4e5692`. Houve dois conflitos, resolvidos mantendo a versão mais completa.
- Sem force push e sem apagar branches. As branches antigas (backup/mobile, backup/site, docs/manifesto) continuam intactas.

## 10. Depois do merge

- CI da `main` verde em todos os produtos.
- Versões publicadas:
  - Android 0.1.1 e 0.1.2 (Latest);
  - Desktop 0.1.0 e 0.1.1;
  - Provider 0.1.1 e 0.1.2 (menus em 11 idiomas);
  - Piu Node 0.1.0 (`.ipk` para OpenWrt e `.deb` para Debian/Ubuntu/Raspberry Pi OS).
- Rascunho antigo do Provider 0.1.0: feito com código anterior, preservado e sem publicar.
- O site lê os downloads de `releases.json`, gerado por `sync-release.mjs`, que confere cada SHA-256 com o `SHA256SUMS.txt`.

## 11. Bloqueios externos (E)

| Bloqueio | Efeito hoje |
|---|---|
| Endereço da caução (`BOND_ADDRESS`) | Modo nó mostra o estado "caução ainda não aberta"; nenhum celular é habilitado |
| Chave do validador (`VALIDATOR_PROOF_PK`) e caixa do validador | Provas e evidências não são enviadas; tela diz "Validador ainda não configurado" |
| Chave GPG das versões | Atualizador do Desktop diz "verificação indisponível" e só abre a página da versão |
| Certificados Apple/Windows | Decisão de 06/11: lançar sem. Mac: botão direito → Abrir. Windows: SmartScreen → Executar assim mesmo |

## 12. Próximos passos

1. Ligar a depuração sem fio no A31 (mesma rede do Mac), instalar o APK e fazer o teste real (mobile.md §5).
2. Gerar a chave GPG das versões e assinar o `SHA256SUMS.txt`.
3. Definir o endereço da caução e a chave do validador quando a Lunes abrir o programa.

## Resumo por produto

- **Main/Core** (protocolo no celular, cópias no piu-node e no settlement):
  - I, protocolo sem mudanças incompatíveis;
  - prova v2 e registro v2 prontos;
  - ativação espera as chaves (E).
- **Site:**
  - I, no ar com "A rede", Ajuda, downloads reais de quatro produtos e textos honestos;
  - página de Ajuda: ver `docs/ajuda/ANALISE.md`.
- **Desktop:**
  - I; versão 0.1.1 sem itens "em breve", 11 idiomas, tema claro/escuro;
  - fuse de file:// desligado e confirmação nativa ao apagar tudo;
  - sem certificados (decisão).
- **Provider** (piu-node, painel, Provider Desktop, OpenWrt):
  - I; gateway e painel testados ponta a ponta;
  - Provider Desktop 0.1.2 publicado;
  - Piu Node 0.1.0 publicado (`.ipk` e `.deb`); LoRa por USB experimental;
  - broadcast UDP 8423 validado com o endereço da sub-rede (num roteador de verdade, a confirmar).
- **Mobile:**
  - I no código (603 testes);
  - APK 0.1.2 publicado;
  - teste no aparelho pendente (P).
