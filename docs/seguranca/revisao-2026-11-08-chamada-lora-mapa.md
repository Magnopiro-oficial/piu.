# Revisão de segurança: chamada de voz, rádio LoRa e Mapa da rede (08/11/2026)

## Escopo

Branch `feat/chamada-de-voz`. Cobre tudo o que difere de `origin/main`:
- chamada de voz no celular e no Piu Desktop, inclusive com o app fechado no Android;
- rádio LoRa (Meshtastic e rádio do Piu por RNode) e cota de cargas;
- Mapa da rede.

Foi uma revisão só de leitura, feita por um revisor independente e depois conferida no código. Não houve teste em aparelho.

## Corrigidos

| Sev. | Achado | Correção | Teste |
|---|---|---|---|
| Crítica | **Pedido forjado ligava sozinho.** Uma resposta "pode ligar" a um pedido que o aparelho nunca fez punha o pedido na espera. O aparelho ligava sozinho, e o microfone abria quando o contato "aceitava". | O serviço guarda os pedidos que **eu** mandei (id, contato, prazo de 7 dias). Só aceita a resposta do mesmo contato, no prazo, e uma vez só. | `callService.test.ts`: resposta forjada; resposta que vale uma vez |
| Alta | **Outro app podia atender pela Activity.** A Activity principal é exportada. Outro app abria a Activity com a ação "answer" e o id da chamada, e quem liga escolhe esse id. Além disso, a Activity relê a Intent que a criou a cada volta para a frente. | Cada notificação leva uma senha aleatória (`OpenTokens`) presa à ação e à chamada. A senha do "Atender" vale uma vez, e a Intent perde os extras da chamada depois de lida. O serviço ignora um convite com id de chamada já recebido do mesmo contato. | `OpenTokensTest.kt`; `callService.test.ts` (id repetido) |
| Média | **Nome do contato sobre o bloqueio.** Com a pré-visualização "Nunca", o nome continuava aparecendo na tela sobre o bloqueio. | Com a tela bloqueada e "Nunca", a tela da chamada mostra "Piu". | — (só tela) |
| Média | **Toque sem limite e chave guardada à toa.** Um contato fazia tocar sem limite, e a chave de cada convite ficava guardada até mesmo com a resposta "ocupado". | Até 5 convites do mesmo contato a cada 10 min; os seguintes ouvem "ocupado" sem tocar. A chave só fica se a chamada ficou com a máquina. As memórias têm teto. | `callService.test.ts` (quem liga sem parar) |
| Baixa | **Microfone liberado durante o toque (Desktop).** O processo principal liberava o microfone com a chamada ainda tocando. | Só libera na caixa "pre", chamando e em curso. | — |
| Baixa | **Anúncio "PN" repetido do ar.** Um anúncio repetido renovava a presença do Super Node, e com a lista cheia saía o primeiro nó da lista, não o que estava calado há mais tempo. | Só um anúncio mais novo renova o nó. Com a lista cheia, sai o calado há mais tempo. | `nodeBeacon.test.ts` |
| — | **Tela sobre o bloqueio sem rede de segurança nativa.** As flags de tela sobre o bloqueio dependiam do JS para desligar. | Rede de segurança nativa: passados 90 s sem o aviso "Em chamada" no ar, as flags desligam. | — |
| — | **Rascunho escrito por link.** O parâmetro `?draft=` aceitava qualquer texto: um link deixava uma frase pronta para a pessoa enviar. | Só aceita a chave `decline`; o texto sai do app. | `callChat.test.ts` |

## Aceitos (com motivo)

- **Bit `live` no cabeçalho.** Quem repassa o envelope vê que é sinal de chamada. É o preço de não gastar o LoRa com sinal ao vivo. O bit é autenticado: alterado, o envelope é descartado. Antes de o enlace ser escolhido, os quadros de voz também vão a todos os vizinhos diretos, já cifrados.
- **Cota de cargas do LoRa.** No ar não há como saber quem mandou, então o balde é um só para a malha aberta: 30 de rajada e 120 por hora. Detalhes em `docs/hardware/testar-radio-piu.md`.
- **Anúncio "PN".** A assinatura prova só a posse da chave, então qualquer um pode se anunciar como Super Node. O mapa não promete mais que isso: o Super Node aparece como `piu.` seguido de 4 letras da chave.
- **"Conectar" no mapa.** Mostra redes cujo nome começa com "Piu · …". O nome de uma rede não é autenticado. O conteúdo continua protegido pelo LNNP, mas o aparelho entra na rede local de quem criou o ponto. A folha do ponto diz que o motivo de estar no mapa é só o nome.
- **Lembrete "Em 10 min".** O texto é montado na hora de agendar, conforme a pré-visualização daquele momento. Bloquear o contato nos 10 minutos seguintes não cancela o lembrete.

## Falta (precisa de aparelho)

- Tela cheia e toque com o app fechado, e o microfone com a tela bloqueada, no Android 12, 13 e 14+.
- Atender, recusar e desligar pela notificação.
- Chamada entre celular e Piu Desktop.
- Roteiro em `docs/distribuicao/checklist.md`, item 3.
