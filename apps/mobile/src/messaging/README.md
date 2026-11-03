# Mensagens reais (`src/messaging`)

Liga o [protocolo](../protocol/README.md) ao app: contatos pelo QR, sessões cifradas, fila store-and-forward e o transporte por perto. É TypeScript puro e testado no Node (`npm test`).

## Como uma mensagem anda

1. **Contato.** A pessoa mostra **Meu código** e você escaneia (ou cola o código). O cartão (`card.ts`, versão 2) traz as chaves públicas, o nome (só na identidade pública), a validade de 24 h e um **código de convite de uso único**, tudo assinado. Assinatura errada, cartão vencido ou dados a mais são recusados. As primeiras mensagens levam o código; quem gerou o QR aceita cada convite uma vez e recusa quem chega sem convite válido (`Messenger.issueInvite`).
2. **Envio.** O texto é cifrado na sessão Double Ratchet daquele contato, dentro de um envelope selado. O envelope entra na fila do roteador, já com o atraso aleatório e o preenchimento, se você ligou esses ajustes de Privacidade.
3. **Antes de sair do aparelho**, o estado das sessões é gravado (cifrado). Assim, mesmo depois de um travamento, uma chave de mensagem nunca é usada duas vezes.
4. **Caminho.** O envelope vai para cada vizinho conectado. Quem não é o destino só guarda e repassa, se estiver com o Modo nó ligado, e não consegue ler nada.
5. **Chegada.** O destino confere integridade, autenticidade, validade e repetição, decifra e responde com um **recibo dentro da sessão**. Os relays não distinguem o recibo de uma mensagem comum. Quando o recibo chega, a mensagem passa a "entregue" e sai da fila.

| Estado na conversa | Quando |
|---|---|
| criada → aguardando | cifrada e na fila |
| encaminhada | saiu deste aparelho para um vizinho |
| entregue | o recibo cifrado do destino voltou |

## Pedidos de conversa

Se alguém que escaneou o seu QR escreve primeiro, a conversa aparece marcada como **pedido** ("confira o código"). Ela só deixa de ser pedido quando você responde. Há um limite de 50 pedidos pendentes, contra enxurradas.

## O que fica salvo no aparelho

As sessões, a fila própria, os contatos, os ids de envelopes já vistos (contra replay depois de reabrir o app) e os ids de mensagens já mostradas. Tudo vai no `piu:v1:msg.state`, cifrado com AES-256-GCM pela chave do cofre do sistema.

## Aparelho de teste

No navegador e no Expo Go não há Bluetooth. Por isso, o transporte simulado traz um **aparelho de teste**: um segundo Piu completo (chaves próprias e o mesmo `Messenger`) que responde cada mensagem com um eco. Use **Nova conversa → Escanear código → Usar o aparelho de teste**. Ele não existe no transporte nativo.

## Ainda falta

- **Celulares de verdade:** o caminho foi testado no Node (`__tests__/messenger.test.ts`: entrega, relay, Modo nó, reabrir o app, replay, identidade anônima, chaves trocadas) e no navegador. Falta o teste em celulares com o módulo nativo.
- **Envelopes grandes no Bluetooth:** o transporte nativo já fatia em blocos; a fragmentação do protocolo (`fragment.ts`) será necessária para LoRa.

## Arquivos (FUN-009)
Oferta com nome, tamanho, tipo e SHA-256; blocos de 12 KB dentro da sessão, cada um confirmado (janela de 8 sem confirmação); pausar e retomar continuam de onde parou; envelopes de arquivo marcados como mídia (nunca por LoRa); o destino monta, confere o SHA-256 e confirma. Limite de 50 MB. Só de contatos aceitos.

## Grupos, canais e comunidades (`groups.ts`)
- Estado do grupo com revisão e versão de chave; só admins mudam, e o estado vai a cada membro pela sessão 1:1 (autenticado). Não aceita revisão antiga nem chave mais velha.
- Mensagens no envelope de grupo com a chave da versão atual; o roteador só abre mensagem de quem ainda é membro e pode publicar (canal e comunidade: admins, e moderadores se o canal permitir).
- Remover troca a chave para os demais; quem saiu é avisado e apaga o grupo. Sair avisa os admins, que trocam a chave.
- Convite do grupo: link `piug:` com o cartão assinado do admin e um código que vale 7 dias e até 50 usos; com "Aprovar quem entra", o pedido espera um admin.
- Comunidade: lista os grupos e canais criados nela; membros da comunidade pedem para entrar sem precisar de convite.
- Canal privado e secreto: o inscrito recebe só admins, moderadores e a si mesmo, mais o total. Ids e chaves dos outros inscritos ficam com os admins.
- "Quem pode convidar: Todos os membros" (só grupo): o membro indica contatos aos admins, que conferem a regra; o convidado aceita o primeiro estado só dos admins que quem o indicou apontou.
- Aparelho revogado: o aviso assinado vai também aos admins dos meus grupos; um admin por grupo troca a chave, uma vez por aviso.

## Conversa (mensagens diretas)
- Prazo de 48 h sem rota (`MESSAGE_TTL_SEC`), o mesmo na tela da rota e no banner de mensagem expirada.
- Confirmação de leitura (`r`) e "digitando…" (`ty`), dentro da sessão, só com os ajustes de Privacidade ligados. "digitando…" não entra na fila, vale 15 s e não publica prova de entrega (não gera crédito).
- Mensagens temporárias: o prazo (`e`, 24 h ou 7 dias) vai na mensagem e na oferta de arquivo; os dois aparelhos apagam no prazo.

## Créditos (`credits.ts`)
Estimativa dividida entre os relays conhecidos até o aparelho; validado e não liquidado expira em 180 dias; horário do recibo arredondado para a hora antes de assinar (`protocol/receipts.ts`).

