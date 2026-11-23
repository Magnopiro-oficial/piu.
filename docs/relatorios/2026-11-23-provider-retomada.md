# Piu Provider: onde parou (23/11/2026)

Parada pedida pelo dono para aliviar o computador. Este documento diz o que existe, o que foi provado e por onde voltar.

## Onde está o trabalho

- **Ramo:** `fix/provider-config-didatica`, saído da `main` em `a8fa721`.
- **Worktree:** `/Users/lucas/Documents/Projetos_DEV/piu-wt-provider`.
- **Push:** não feito. A regra do dono é não publicar nada sem ele pedir; na parada de 23/11 a confirmação ficou pendente com ele.
- **Relatório completo:** [2026-11-13-provider-configuracoes.md](2026-11-13-provider-configuracoes.md) (seção 7 para esta rodada).

## Commits do ramo, do mais antigo ao mais novo

| Commit | Assunto | Estado |
|---|---|---|
| `97b9517` | Esc fecha os diálogos de código, senha e restaurar | validado no app (13/11) |
| `cfd7a43` | Configurações didáticas nos 11 idiomas | validado no app (13/11) |
| `f38af47` | Rede local copia um endereço que abre | validado no app (13/11) |
| `e1665a7` | Relatório de 13/11 | — |
| `cedc77e` | Espaço em MB reais e cada mensagem gravada em disco | validado: suíte pela fila e app de verdade (23/11) |
| `1604e6c` | Nome do arquivo de cada mensagem não revela qual é | validado: suíte pela fila e app de verdade (23/11) |
| `11fe2b2` | Menus no idioma do app, "Salvo" só quando muda, aviso nas regras dos equipamentos | suíte pela fila ok; "Salvo" visto no app; **menus e aviso das regras não vistos na tela** |
| `7532546` | Avisos de teto não usam leitura velha do nó | **não validado no app**; testes do painel ok |
| `01aec9e` | Lista de equipamentos em MB abaixo de 1 GB | **não validado no app**; testes do painel ok |
| (este) | Relatório atualizado e este documento | — |

## Números da última verificação

- Pela fila, sobre `11fe2b2`: painel 155/155, app desktop 22/22, `piu-node` 149/152 (as 3 falhas já existem na `main`), tipos sem erro nos três, builds ok.
- Direto (leve), sobre `01aec9e`: painel 179/179, `tsc -b` sem erro.
- App de verdade, três etapas, sobre o build de `11fe2b2`: todas passaram. Saída em [tres-etapas-2026-11-23.txt](2026-11-13-provider/tres-etapas-2026-11-23.txt).

## Pendências

1. Rodar a suíte completa e o build sobre `01aec9e` (os dois últimos commits só mexem no painel).
2. Abrir o app e conferir: (a) ao trocar o espaço ou a banda, nenhum aviso errado aparece; (b) a lista de Equipamentos mostra "0 de 256 MB"; (c) o aviso de 512 MB aparece nas regras de um equipamento e no assistente; (d) os menus do macOS estão em português.
3. Decidir com o dono o push do ramo e a abertura do PR.
4. Descobrir por que o `_electron.launch` do Playwright parou de completar (não bloqueia: o roteiro novo conecta pela porta de depuração).

## Primeiro passo da volta

Os roteiros de teste ficavam em `/private/tmp`, que é apagado de tempos em tempos, e **não estão no repositório**. Para refazer a verificação do item 2:

1. Build: `cd apps/provider-desktop && npm run build:panel && npm run build` (pela fila: `~/.claude/bin/test-queue run "piu: provider build" -- ...`).
2. Abrir o app com uma pasta de dados separada, sem tocar no Piu Provider instalado: `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --user-data-dir=<pasta temporária> --remote-debugging-port=9339`, com `PIU_LNNP_DISCOVERY=` vazio. Registrar a porta 8420 no `coord` e encerrar com `kill -TERM` (o app leva mais de 5 s para fechar, porque grava antes de sair).
3. Conferir os quatro pontos do item 2 em Configurações e Equipamentos. Para ler o motor: `GET /api/relay` (campos `store.maxBytes` e `limits.effective.stoMB`).

Para repetir a prova da conversão do arquivo antigo, é preciso também uma cópia da `main` (`git archive a8fa721 apps/provider-desktop apps/piu-node apps/provider-panel`), com `node_modules` apontando para os da worktree, e um segundo nó (`startRelay` do `piu-node`, com `peers: ['127.0.0.1:8422']`) mandando uma mensagem `sealDirect` para uma pessoa ausente.

## Trabalho ligado, em outro ramo

- **Estudo UHF/VHF:** ramo `docs/estudo-uhf-vhf`, commit `18498fd`, `docs/estudos/2026-11-23-comunicacao-uhf-vhf.md`. Sem push. O dono decidiu não implementar nada do estudo agora. A sessão do estudo chegou a começar um adaptador KISS antes de ser parada; o que existir fica no ramo dela, marcado como não validado.
