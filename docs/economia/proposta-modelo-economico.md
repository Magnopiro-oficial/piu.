# Proposta de modelo econômico da carteira LUNES

> **Status: proposta para decisão da Lunes, não decisão final.** O documento de requisitos (seção 18.2) deixa em aberto "orçamento de recompensas, limites, taxas, frequência e critérios de liquidação". Este texto propõe regras e valores iniciais, explica cada escolha e lista o que precisa ser decidido. Os valores marcados como **[decidir]** são sugestões. Antes de valer de verdade, tudo deve passar pelas simulações de ataque da Fase 8 (seção 15).

## 1. Princípios (do documento de requisitos)

1. **Recompensa só por utilidade comprovada** (seção 11): retransmissão de mensagens **de terceiros** que **chegaram ao destino**. Tempo ligado, capacidade anunciada ou declarações do próprio nó não rendem nada.
2. **A comunicação não depende da blockchain** (11.2): os créditos se acumulam offline e são liquidados depois, quando houver conexão com a Lunes Mainnet.
3. **Nada de conversa na blockchain** (11.2): só liquidação. As carteiras são separadas da identidade social e da identidade do nó (seção 9; no app, `deriveWalletSeed`).
4. **Risco residual aceito** (11.1): não existe prova perfeita de retransmissão física. O desenho combina evidências independentes e limita o ganho de quem frauda.

## 2. Quatro fontes de LUNES no app

| Fonte | Quem recebe | Valor proposto | Vem de |
|---|---|---|---|
| **Créditos de rede** | quem retransmite mensagens de terceiros | parcela de um orçamento por época (seção 3) | fundo de recompensas da rede |
| **Bônus de boas-vindas** | pessoa nova | **10 LUNES** [decidir], liberados após 7 dias de uso | fundo de crescimento |
| **Distribuição por convite** | quem convidou | **25 LUNES** [decidir], pagamento único por pessoa ativa 7 dias (não é mensal) | fundo de crescimento |
| **Convite pago (Por perto)** | quem recebe o pedido de conversa | 1, 3, 5 ou 10 LUNES, escolhido por quem recebe | carteira de quem convida (não é emissão) |

Os valores 10 e 25 são os do design. Eles devem ser confirmados ou ajustados de acordo com o preço do LUNES e com o tamanho dos fundos.

## 3. Créditos de rede

### 3.1 O que gera crédito

Um **envelope de terceiros** que este nó repassou e que **teve entrega comprovada** gera crédito. A comprovação combina três evidências:

- o **recibo de retransmissão**, assinado pela chave técnica do nó (`receipts.ts`);
- a **prova de entrega**: o destino revela o `ackSecret`, que só existe dentro do conteúdo cifrado e não identifica quem é o destino;
- a **auditoria por amostragem**: desafios de retransmissão feitos por outros nós. Um nó reprovado é bloqueado e perde o que ainda não foi pago.

Envelopes do próprio nó, duplicados ou vencidos não geram crédito. Recibos acima do teto por envelope são rejeitados.

### 3.2 Recompensa por entrega, dividida entre os relays

**Proposta:** cada entrega comprovada vale **1 unidade de entrega**, multiplicada pelo peso de tamanho e de meio (tabela abaixo). Essa unidade é **dividida igualmente entre os relays** que apresentaram recibo válido.

| Tamanho do envelope (já com preenchimento) | Peso |
|---|---|
| até 256 B | 1,0 |
| até 1 KB | 1,2 |
| até 4 KB | 1,5 |
| até 16 KB | 2,0 |
| até 32 KB | 2,5 |

| Meio do salto | Multiplicador [decidir] | Motivo |
|---|---|---|
| Bluetooth LE, Wi-Fi Direct | 1,0 | padrão |
| Wi-Fi Mesh, Ethernet | 1,0 | padrão |
| LoRa | 1,5 | alcance e custo do equipamento; só mensagens pequenas |

**Por que dividir em vez de pagar cada relay:** com pagamento por relay, quem coloca nós falsos (Sybil) no caminho ganha mais a cada salto inventado. Com divisão, o total por entrega é fixo, e salto falso não aumenta o bolo; só tira parte dele dos relays honestos. Os tetos por envelope (8 relays) e por nó e dia continuam valendo.

### 3.3 Orçamento por época, e não valor fixo por crédito

**Proposta:**

- uma **época = 1 semana** [decidir];
- a Lunes define um **orçamento de recompensas por época** (`B` LUNES) [decidir];
- no fim da época, `valor da unidade = B ÷ total de unidades validadas na época`;
- cada nó recebe `unidades validadas × valor da unidade`, até o **teto de 2% do orçamento por nó por época** [decidir].

Com isso, o gasto total fica previsível (nunca passa de `B`), e tráfego artificial não aumenta a emissão: ele só dilui a parte de quem frauda e de quem é honesto ao mesmo tempo, o que limita o retorno do ataque. Na carteira, o app mostra "créditos estimados" (pela época anterior) e "créditos validados", como pede a seção 6 dos requisitos.

**Exemplo ilustrativo** (números de exemplo, não proposta de orçamento): com `B = 10.000 LUNES`/semana e 2.000.000 de unidades validadas na semana, cada unidade vale 0,005 LUNES. Um nó que ajudou em 6.000 entregas de 1 KB, cada uma com 2 relays, recebe 6.000 × 1,2 ÷ 2 × 0,005 = **18 LUNES**.

### 3.4 Estados e liquidação

| Estado | Significado |
|---|---|
| pendente | recibo aceito; aguardando prova de entrega ou auditoria |
| validado | entrega comprovada, dentro dos tetos e sem reprovação |
| rejeitado | duplicado, sem entrega até o TTL, acima do teto ou reprovado em auditoria (mostra o motivo) |
| pago | incluído num lote liquidado na Mainnet |

- **Frequência:** um lote por época, quando a época fecha e o nó tem conexão [decidir].
- **Mínimo para liquidar:** 5 LUNES [decidir], para que a taxa de transferência não consuma o crédito. Abaixo disso, o valor passa para a época seguinte.
- **Validade:** créditos validados que não forem liquidados em 180 dias expiram [decidir], para não acumular passivo eterno.
- **Carência contra fraude:** o crédito validado só entra num lote 1 época depois. Assim, uma reprovação em auditoria ainda alcança o que não foi pago.
- **Antes de implementar** (11.2): validar na Mainnet real os endpoints, o método de transferência, os decimais, as taxas, a finalização e os limites.

## 4. Bônus de boas-vindas e distribuição por convite

São as maiores portas para **Sybil** (criar pessoas falsas para receber bônus). Proposta de critérios, todos obrigatórios:

| Critério | Bônus de boas-vindas (10) | Distribuição por convite (25) |
|---|---|---|
| Instalação original verificada (assinatura Lunes) | sim | sim |
| Identidade criada e com backup feito | sim | sim |
| Confirmada pessoalmente por pelo menos 1 contato (código de segurança) | sim | sim |
| 7 dias de uso com tráfego real (mensagens trocadas com 3 ou mais contatos distintos) | sim | sim |
| Instalação confirmada por 2 nós independentes do convidador | não | sim |
| Teto por convidador | não se aplica | **20 convidados por mês e 100 no total** [decidir] |
| Fundo | fundo de crescimento com teto mensal [decidir] | o mesmo |

Quando o fundo de crescimento do mês acaba, novos bônus ficam "reservados" e são pagos no mês seguinte, por ordem. Isso evita prometer o que não existe. Um convidador com muitos convidados reprovados (por exemplo, mais de 30%) perde o direito a novas distribuições [decidir].

## 5. Convite pago (Por perto)

- **Quem define o valor** é quem **recebe** pedidos (1, 3, 5 ou 10 LUNES). É um filtro contra abordagens indesejadas, não uma fonte de renda da rede.
- O valor fica **reservado** na carteira de quem convida. Se o convite for **aceito**, o valor vai para quem aceitou. Se for **recusado** ou ninguém responder em **24 h**, ele volta para quem convidou.
- **Taxa da rede: 0%** na primeira versão [decidir]. Cobrar taxa aqui desestimula o uso e cria a impressão de que a Lunes lucra com encontros.
- Recusar em silêncio não avisa quem convidou; o valor volta em 24 h. "Bloquear e denunciar" devolve o valor e bloqueia novos pedidos daquela identidade.

## 6. Antifraude: ameaça → controle

| Ameaça | Controles propostos |
|---|---|
| Sybil (muitos nós falsos no caminho) | recompensa por entrega dividida; teto de 8 relays por envelope; teto por nó e época; auditoria por amostragem |
| Tráfego artificial (mandar mensagens para si mesmo pela própria malha) | orçamento por época (dilui o retorno); teto por nó; **[decidir]** limite de entregas elegíveis por instalação verificada, por meio de tokens anônimos (estilo Privacy Pass), para não expor quem fala com quem |
| Colusão (vários nós combinando recibos) | auditorias cruzadas entre nós sem vínculo; análise de grafo de recibos no validador (ainda não implementada) |
| Encaminhamento circular | limite de saltos, deduplicação por id e "não devolve a quem enviou", já no roteador |
| Recibo falso | assinatura da chave do nó; prova de entrega obrigatória; carência de 1 época |
| Fazenda de convites | critérios da seção 4; teto por convidador; 2 nós independentes confirmando a instalação |
| Repetição de pagamento | id do envelope + nó como chave única; lote liquidado registra os ids pagos |

## 7. Privacidade

- O validador vê o **id do envelope**, o **hash do segredo de entrega** e a **chave técnica do nó**. Ele não vê remetente, destino nem conteúdo.
- A carteira que recebe é separada da identidade social e da identidade do nó. O vínculo nó → carteira deve ser **por lote de liquidação** [decidir], para não criar um histórico público de quem retransmitiu onde.
- Horários dos recibos são arredondados para a hora antes de sair do aparelho [decidir], contra correlação por horário.

## 8. Decisões pendentes (para a Lunes)

1. Orçamento `B` por época e de onde vem: emissão, tesouraria ou taxas.
2. Duração da época e frequência de liquidação.
3. Valores do bônus de boas-vindas e da distribuição por convite, e o teto mensal do fundo de crescimento.
4. Multiplicador do LoRa e tabela de pesos por tamanho.
5. Teto por nó (% do orçamento) e por convidador.
6. Mínimo para liquidar e validade dos créditos.
7. Taxa sobre convites pagos (proposta: 0%).
8. Adotar ou não tokens anônimos por instalação contra tráfego artificial.
9. Validação técnica da Lunes Mainnet: decimais, taxas, finalização e limites.

## 9. Próximos passos sugeridos

1. Decidir os itens da seção 8.
2. **Simular ataques** (Fase 8): uma malha simulada com nós honestos, Sybil e em colusão, medindo quanto do orçamento cada estratégia captura. O `ContributionLedger` e o roteador já rodam no Node e servem de base para essa simulação.
3. Implementar o validador de contribuições e a liquidação em lote somente depois disso (Fase 9).
4. Pedir revisão econômica externa junto com a revisão de segurança (NFR-007: "economia sujeita a revisão e testes").
