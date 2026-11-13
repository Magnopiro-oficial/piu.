# Piu Provider: funcionamento e configurações didáticas (13/11/2026)

**Ramo:** `fix/provider-config-didatica` (saído da `main` em `a8fa721`), sem push.
**O que foi testado:** o app Piu Provider para computador (Electron, `apps/provider-desktop`), com o `piu-node` embutido e o painel (`apps/provider-panel`), rodando de verdade neste Mac. Cada percurso subiu o app, clicou na tela, leu a API do nó e derrubou tudo no fim (janela da fila, com registro no `coord`). Pasta de dados separada, sem tocar no Piu Provider instalado.
**Antes × depois:** o "antes" é o código da `main` (cópia por `git archive`); o "depois" é este ramo.

**Resultado: APROVADO COM RESSALVAS.** Os fluxos principais funcionam. Corrigi 3 defeitos e reescrevi os textos das Configurações nos 11 idiomas. As ressalvas estão em "O que ficou de fora".

## 1. Estado de cada fluxo (rodando de verdade)

| Fluxo | Antes | Depois | Evidência |
|---|---|---|---|
| Abrir o app, subir o nó e entrar sozinho (pareamento automático) | ✅ | ✅ | `GET /api/session` → 200; janela em `https://localhost:8420/` |
| Visão geral, Equipamentos, Malha, Gateway, Ganhos, Carteira | ✅ abrem com dados reais (zerados, sem vizinhos) | ✅ | capturas 01 a 06 |
| Mudar banda e espaço nas Configurações | ✅ chega ao motor | ✅ | `relay.limits` passa de 50 Mbps/8 GB para 100 Mbps/16 GB |
| **Espaço para guardar mensagens** | ⚠️ a tela diz "8 GB", mas o nó guarda no máximo **256 MB** | ✅ a tela avisa "Na prática, este nó guarda até 256 MB" | `store.maxBytes = 268435456` com 8 GB **e** com 16 GB |
| Desligar e religar "Aceitar arquivos e mídia" | ✅ | ✅ | motor: `media` true → false → true |
| Exportar backup (pede senha) | ✅ abre | ✅ | captura 09 |
| Fechar diálogos com Esc (código, senha, restaurar) | ❌ o diálogo de backup fica aberto e bloqueia o resto da tela | ✅ os 4 diálogos fecham | no "antes", todos os passos seguintes falharam com "outro elemento intercepta o clique" |
| Trocar a chave, restaurar backup | ✅ abrem (o "antes" só foi testado até o bloqueio do Esc) | ✅ | capturas 10 e 11 |
| Parear celular sem confirmação recente | ✅ pede o código do equipamento | ✅ | `403` da API e o diálogo "Confirme no equipamento" |
| Ajuda da página, troca de idioma, tela de celular (390 px) | — (bloqueado pelo Esc) | ✅ | capturas 13, 14 e 15 |
| Menu Nó → Copiar endereço (só este computador) | ✅ `https://localhost:8420` | ✅ | o endereço responde (401 sem sessão, como deve) |
| **Menu Nó → Copiar endereço (rede local ligada)** | ❌ copia `https://piu-node.local:8420`, que **não abre**: `ENOTFOUND` | ✅ copia `https://imac-de-lucas.local:8420`, que abre | ninguém anuncia `piu-node.local` neste Mac (`dscacheutil` vazio); `imac-de-lucas.local` resolve |

Rede local, depois: ✅ o app copia `https://imac-de-lucas.local:8420`, que responde (`HTTP 401`, pede sessão, como deve). `piu-node.local` continua dando `ENOTFOUND`, e nenhum texto o promete mais.

## 2. O que foi corrigido (com testes antes do código)

1. **Teto real do espaço guardado** (`apps/provider-panel/src/lib/limits.ts`). O nó guarda no máximo o menor entre a escolha, as regras do equipamento e a memória que ele reserva (`PIU_LNNP_MEMORY_MB`, 256 MB por padrão). A tela agora diz o valor real e o motivo. Faz o mesmo com a banda, quando as regras do equipamento pedem menos.
2. **Esc nos diálogos** (`components/Pair.tsx`). Código do equipamento, senha do backup e restaurar backup eram os únicos sem Esc.
3. **Endereço na rede local** (`apps/provider-desktop/src/lan.ts`). O app passa a usar o nome do computador em `.local` (que o macOS e o avahi já anunciam) e os IPs. Nenhum texto, em nenhum idioma, promete `piu-node.local`. O teste antigo que exigia `piu-node.local:8420` foi trocado.
4. **Nome do português.** Em pt-BR e pt-PT, a lista de idiomas mostrava "Portuguese · Brazil".

## 3. Configurações: como estavam e como ficaram

| Onde | Antes | Depois |
|---|---|---|
| Subtítulo da página | "Limites e políticas aplicados a todos os equipamentos" (não é verdade com o nó real: vale só para este) | "Quanto este nó empresta para a rede, o que ele aceita passar e a segurança da sua conta" |
| Limites deste nó | "Valem no nó que serve este painel…" | "Quanto deste equipamento fica para passar mensagens de outras pessoas…" |
| Banda para a rede | dica solta "para terceiros" | "Padrão: 50 Mbps" + "Velocidade máxima da sua rede local que as mensagens de outras pessoas podem usar. Menos banda, menos disputa com o seu uso." |
| Armazenamento para terceiros | dica "mensagens cifradas" | **Espaço para guardar mensagens**, "Padrão: 8 GB", o que é, e o aviso do teto real |
| Horário de operação | dica "hora deste nó" | "Padrão: Sempre" + "Fora desse horário, este equipamento para de passar mensagens de outras pessoas. Vale o relógio dele." |
| Salvar | salvava sozinho, sem nenhum sinal | "Salvo neste nó · agora" depois que o nó confirma |
| Política de tráfego | "O que este nó aceita retransmitir" | **Tipos de mensagem aceitos** |
| Aceitar arquivos e mídia | "Só por Wi-Fi e cabo; nunca por LoRa" | "Fotos, áudios e arquivos de outras pessoas. Pesam mais que texto e nunca vão por rádio LoRa. Desligado, só passa texto." |
| Priorizar alertas | "Sempre ativo para envelopes de prioridade alta" | "Avisos urgentes passam na frente das outras mensagens. Fica sempre ligado." |
| Acesso a este painel | "Disponível só na rede local…" (por padrão, nem na rede: só neste computador) | "Navegadores e aparelhos com este painel aberto. Ele nunca fica aberto para a internet." |
| Identidade de operador | "Assina seus equipamentos. Separada da sua identidade de conversa." | Diz para que serve e por que fazer backup: sem ele, se o equipamento quebrar, perde-se o controle dos outros |
| Rotacionar chaves | "Rotacionar chaves" e "nunca rotacionada" | **Trocar a chave**, "nunca trocada", e o diálogo diz *quando* usar: "se achar que alguém copiou a chave ou o backup" |
| App: Permitir acesso pela rede local | prometia `https://piu-node.local:8420` | mostra o endereço que funciona, por ex. `https://imac-de-lucas.local:8420` |

Todos os textos mudaram nos 11 idiomas (pt-BR, pt-PT, en, es, fr, de, it, ja, zh, ar, hi). O alemão segue o "Sie" e o chinês o "您", como o resto do painel.

![Configurações antes](2026-11-13-provider/configuracoes-antes.jpg)
![Configurações depois](2026-11-13-provider/configuracoes-depois.jpg)
![No celular, 390 px](2026-11-13-provider/configuracoes-celular.jpg)

## 4. Suítes

| Suíte | Resultado |
|---|---|
| Painel (`vitest`) | 130 de 130 passam (5 arquivos), `tsc -b` sem erro |
| App desktop (`node --test`) | 19 de 19 passam, `tsc --noEmit` sem erro |
| Build do painel e do processo principal | ok |
| `piu-node` (não mexi nele) | 142 de 145. As 3 falhas já existem na `main`: `src/lunes` difere de `apps/mobile/src/lib` (rodar `node scripts/sync-lunes.mjs`) e 2 testes que importam `apps/settlement` sem as dependências instaladas (`@noble/ciphers`) |

Vermelho antes do verde: os testes novos falharam primeiro (painel: 26 falhas; desktop: `lan.test.ts` sem o módulo) e passaram depois do código.

## 5. O que ficou de fora (ressalvas)

- **4/8/16 GB continuam como opções**, mas com 256 MB de memória reservada nenhuma delas muda nada hoje. Decisão do dono: (a) trocar as opções por valores que o nó cumpre, (b) aumentar `PIU_LNNP_MEMORY_MB` no app, ou (c) passar a guardar em disco. Por enquanto a tela só diz a verdade.
- **Menus do macOS em inglês** ("Edit", "Services", "Hide Piu Provider"): são os menus padrão do Electron, que não seguem o idioma do app. O menu "Nó" e os diálogos já estão traduzidos.
- **"Salvo neste nó" aparece ao abrir a página**: o painel regrava os ajustes logo depois de lê-los (comportamento que já existia). É inofensivo, mas é uma gravação a mais.
- **"Limitar remetentes desconhecidos" e "Só comunidades que sigo"** seguem desligadas com "Ainda sem efeito nesta versão" (decisão de produto pendente, como já estava).
- Não testei a bandeja do Linux, o Windows nem o pareamento com um celular de verdade.

## 6. Janelas de teste

| Janela | O que rodou | Resultado |
|---|---|---|
| 1 | testes vermelhos + 1ª tentativa do app | vermelho confirmado; o app não abriu (Electron não baixado na instalação; copiei o binário 45.2.1 do checkout principal) |
| 2 e 3 | antes/depois + suítes | achados do teto de 256 MB, do Esc e do `piu-node.local` |
| 4 | suítes + 4 percursos | suítes verdes; a janela de 35 min acabou no último percurso |
| 5 | rede local, depois | endereço novo abre (401); Esc fecha os 4 diálogos também com a rede local ligada |

Nas janelas 4 e 5, o aviso "janela estourada" sai depois do fim do roteiro (o relógio da fila só é encerrado ali); o roteiro já tinha terminado. Em todas: porta 8420 liberada, nenhum Electron sobrando, registro no `coord` removido.
