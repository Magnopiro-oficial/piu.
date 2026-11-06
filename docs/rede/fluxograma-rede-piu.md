# Fluxograma da rede de comunicação Piu

Como uma mensagem, uma transação e uma recompensa andam pela rede Piu — do celular de quem escreve até quem recebe, sem depender de
internet nem de servidor central. Os diagramas usam [Mermaid](https://mermaid.js.org/) e aparecem desenhados direto no GitHub.

**Legenda de estado** (o que está no código hoje × o que está a caminho):

| Marca | Significado |
|---|---|
| ✅ | Implementado e testado |
| 🧪 | Implementado, ainda sem teste em aparelho real ou desligado por padrão |
| 🔜 | Desenho validado, implementação em andamento ou planejada |

Parte do código descrito aqui (marcas 🧪 e 🔜, e os documentos de economia, carteira e pontos Piu) ainda está em desenvolvimento
e entra no repositório nas próximas versões.

Documentos de referência: [especificação LNNP v1](../lnnp/especificacao-v1.md) ·
[mensagens](../../apps/mobile/src/messaging/README.md) · [prova de entrega v2](../economia/prova-de-entrega-v2.md) ·
[modo nó no celular](../economia/no-celular.md) · [transações pela malha](../carteira/transacoes-pela-malha.md) ·
[pontos Piu com roteadores](pontos-piu-roteadores.md).

---

## 1. Visão geral: quem participa e em que camada

```mermaid
flowchart TB
  subgraph C0["Camada 0 · Direto (sem infraestrutura)"]
    P1["Celular A"] <-->|"Bluetooth LE ✅"| P2["Celular B"]
    P2 <-->|"Nearby: Bluetooth → Wi-Fi Direct ✅"| P3["Celular C"]
  end

  subgraph C1["Camada 1 · Rede local (qualquer Wi-Fi, sem internet)"]
    R["Roteador Wi-Fi comum<br/>(só leva pacotes IP)"]
    D["Piu Desktop ✅"] <-->|"LNNP UDP+TCP ✅"| R
    N["Piu Node ✅"] <-->|"LNNP UDP+TCP ✅"| R
    P4["Celular D"] <-->|"LNNP pelo Wi-Fi 🔜"| R
  end

  subgraph C2["Camada 2 · Pontos Piu 🔜"]
    PM["Ponto multiplicador<br/>roteador comum"]
    PG["Ponto guardião<br/>celular/PC/Node que guarda e repassa"]
  end

  subgraph C3["Camada 3 · Espinha dorsal"]
    LORA["LoRa · Super Node ✅"]
    MESH["Malha OpenWrt 802.11s 🔜"]
    MOV["Pessoas em movimento<br/>(store-and-forward) ✅"]
  end

  subgraph C4["Camada 4 · Gateways (opcional)"]
    GW["Aparelho com internet<br/>publica na Lunes 🧪"]
    LUNES[("Lunes Mainnet")]
    VAL["Validador de recompensas 🧪"]
  end

  P3 <-->|"ponte: Bluetooth + Wi-Fi ao mesmo tempo 🔜"| P4
  R --- PM
  R --- PG
  N <--> LORA
  N <--> MESH
  P1 -. "leva mensagens cifradas" .-> MOV
  N --> GW
  GW --> LUNES
  GW --> VAL
```

Princípios que valem em todas as camadas:
- **Tudo cifrado de ponta a ponta.** Relays, roteadores e pontos só veem bytes opacos e um cabeçalho mínimo.
- **Identidade técnica ≠ identidade social ≠ carteira.** O nó usa chaves próprias (que giram) e nunca a identidade das conversas.
- **Sem servidor central.** Descoberta local, confiança pelas chaves; a internet é só mais um caminho, nunca obrigatório.

---

## 2. A vida de uma mensagem (ponta a ponta)

```mermaid
sequenceDiagram
  autonumber
  actor Ana
  participant AA as App da Ana
  participant RA as Relay 1 (qualquer aparelho)
  participant RB as Relay 2
  participant AB as App do Bruno
  actor Bruno

  Note over Ana,Bruno: Antes: Ana lê o QR do Bruno (cartão assinado, válido 24 h, convite de uso único) ✅
  Ana->>AA: escreve "oi"
  AA->>AA: cifra na sessão Double Ratchet do Bruno ✅
  AA->>AA: envelope selado (remetente escondido), id, destino lógico,<br/>prioridade, TTL ≤ 7 dias, saltos, ackHash = H(segredo) ✅
  AA->>AA: grava o estado da sessão cifrado ANTES de enviar ✅
  AA->>RA: envelope (Bluetooth / Nearby / LAN)
  Note right of RA: Não lê nada. Guarda até vencer<br/>e repassa quando surge vizinho ✅
  RA->>RA: assina recibo de retransmissão (chave do nó do dia) ✅
  RA->>RB: envelope (saltos − 1)
  RB->>AB: envelope
  AB->>AB: confere integridade, autenticidade, validade e repetição ✅
  AB->>Bruno: mostra "oi"
  AB-->>AA: recibo de entrega DENTRO da sessão (indistinguível de mensagem) ✅
  AB-->>RB: prova de entrega v2 selada para o validador (só com a chave do validador configurada) 🧪
  AA->>Ana: "entregue" ✅
```

Estados que a Ana vê: **criada → aguardando → encaminhada → entregue**.

---

## 3. Enlace entre dois vizinhos (LNNP v1)

```mermaid
flowchart TD
  A["Nó liga o transporte"] --> B{"Meio"}
  B -->|"LAN"| C["Anúncio UDP de 18 bytes a cada 5 s<br/>broadcast :8423 (não autenticado: só dica) ✅"]
  B -->|"LAN, broadcast filtrado"| C2["mDNS _piu._udp 🔜 · varredura leve 🔜 · vizinho fixo host:porta ✅"]
  B -->|"Bluetooth / Nearby"| C3["Descoberta do próprio meio ✅"]
  B -->|"LoRa / USB"| C4["KISS pela porta serial ✅"]
  C --> D{"Minha etiqueta é menor?"}
  C2 --> D
  D -->|"não"| W["Espera o outro conectar"]
  D -->|"sim"| E["Abre TCP (limites: discagens por IP, handshakes pendentes) ✅"]
  C3 --> F
  C4 --> F
  E --> F["HELLO 0x01: versões, chave do nó, capacidades (TLV)"]
  F --> G["AUTH 0x02: assinatura Ed25519 da chave do nó<br/>anti-replay e anti-downgrade ✅"]
  G --> H{"Versões e suítes em comum?"}
  H -->|"não"| X["Fecha (erro de versão)"]
  H -->|"sim"| I["Chaves do enlace: uma por sentido,<br/>XChaCha20-Poly1305, nonce por contador ✅"]
  I --> J["Quadros: envelopes, recibos de retransmissão,<br/>registros do operador, cargas para gateway"]
```

---

## 4. O que um relay faz com cada envelope (store-and-forward)

```mermaid
flowchart TD
  IN["Envelope chega de um vizinho"] --> T{"Balde de fichas do vizinho tem ficha?"}
  T -->|"não"| DROP1["Descarta (limite por vizinho) ✅"]
  T -->|"sim"| V{"Cabeçalho válido? versão conhecida?"}
  V -->|"não"| DROP2["Descarta (formato desconhecido é ignorado:<br/>é assim que versões antigas convivem) ✅"]
  V -->|"sim"| S{"Id já visto?"}
  S -->|"sim"| DROP3["Descarta (deduplicação) ✅"]
  S -->|"não"| E{"Vencido? TTL > 7 dias?"}
  E -->|"sim"| DROP4["Descarta ✅"]
  E -->|"não"| ME{"É para mim?"}
  ME -->|"sim"| OPEN["Abre: Double Ratchet → mensagem,<br/>ou carga para gateway (tipo 5) 🧪"]
  ME -->|"não"| NODE{"Modo nó / retransmissão ligada?"}
  NODE -->|"não"| DROP5["Não guarda dados de terceiros"]
  NODE -->|"sim"| LIM{"Cabe nos limites?<br/>espaço · quantidade · banda de terceiros ·<br/>200 MB/dia e bateria > 30% no celular-nó 🧪"}
  LIM -->|"não"| EVICT["Sai primeiro o de menor prioridade<br/>e que vence antes ✅"]
  LIM -->|"sim"| STORE["Guarda (cifrado em repouso)"]
  EVICT --> STORE
  STORE --> RC["Na 1ª cópia: assina recibo de retransmissão ✅"]
  RC --> FWD{"Surgiu vizinho?"}
  FWD -->|"sim"| SEND["Repassa: saltos − 1, nunca de volta a quem mandou,<br/>no máximo maxCopies, mídia nunca por LoRa ✅"]
  FWD -->|"não"| WAIT["Espera até vencer"]
  WAIT --> FWD
```

---

## 5. Como o celular escolhe o caminho

```mermaid
flowchart LR
  ENV["Envelope a enviar"] --> SZ{"Tamanho e bateria"}
  SZ -->|"pequeno ou bateria baixa"| BLE["Bluetooth LE<br/>~10 kB/s, menor consumo ✅"]
  SZ -->|"grande"| NB["Nearby: sobe para Wi-Fi Direct<br/>~500 kB/s ✅"]
  SZ -->|"conectado a um Wi-Fi com nós Piu"| LAN["LNNP pela rede local 🔜"]
  BLE --> OUT["Todos os vizinhos conectados"]
  NB --> OUT
  LAN --> OUT
  OUT --> BR["Ponte: o que chega por um meio<br/>pode seguir por outro 🔜"]
```

---

## 6. Recompensas: da entrega comprovada ao pagamento 🧪

Desligado por padrão: só liga com a chave do validador, o cadastro dos operadores e o endereço da caução definidos.

```mermaid
flowchart TD
  subgraph APARELHOS["Na malha"]
    R1["Relay assina recibo<br/>(nó do dia + certificado do operador)"]
    PR["Destino assina prova v2 com pseudônimo<br/>(H(segredo) = ackHash do remetente) e sela para o validador"]
  end
  R1 --> EV["Arquivo de evidências"]
  PR --> EV
  EV -->|"compartilhado à mão ✅"| INB
  EV -->|"pela malha até um gateway 🧪"| INB["Caixa de entrada do validador<br/>carimba 'visto pela primeira vez'"]
  INB --> CL["Fechamento da época"]
  CL --> C1{"Nó registrado?<br/>operador admitido, não revogado"}
  C1 -->|"não"| Z["Não rende (ruído)"]
  C1 -->|"sim"| C2{"Prova confere com o recibo<br/>de um nó registrado?"}
  C2 -->|"não"| Z
  C2 -->|"sim"| C3{"Conflito ou excesso (> 8 recibos)?"}
  C3 -->|"sim"| AUD["Audita: tira operadores com > 1 recibo;<br/>se persistir, ninguém ganha"]
  C3 -->|"não"| CAP["Tetos: por nó, por operador (2%),<br/>celular ≤ caução/4 por época;<br/>redistribui o excedente"]
  AUD --> CAP
  CAP --> LOT["Lote amarrado ao estado do validador (stateHash)"]
  LOT --> PAY["Diário com fsync → pagamento na Lunes<br/>(nunca o mesmo pagamento duas vezes)"]
```

### 6.1 Celular como nó que rende 🧪

```mermaid
flowchart LR
  A["Ativar 'Do celular'<br/>(requisitos: carteira, backup, espaço, sem economia de bateria)"] --> B["Caução de 100 LUNES<br/>(segurar para assinar)"]
  B --> C["7 dias seguidos com certificado do dia<br/>(gerado no próprio celular, sem internet)"]
  C --> D["3 avais de contatos verificados pessoalmente,<br/>no modo nó há mais de 7 dias, de 2 raízes diferentes"]
  D --> E["Habilitado: rende por entregas comprovadas<br/>(teto ≤ 25 LUNES por época)"]
  E --> F["Sair: devolução da caução 7 dias depois"]
```

---

## 7. Transação LUNES sem internet (carga pela malha) 🧪

```mermaid
sequenceDiagram
  autonumber
  participant W as Carteira (sem internet)
  participant M as Malha (relays)
  participant G as Gateway (tem internet)
  participant L as Lunes Mainnet

  W->>W: assina a transferência (era imortal, nonce da última leitura ≤ 7 dias)
  W->>W: bloqueia novos envios até resolver (proteção contra gastar duas vezes)
  W->>M: carga tipo 5 para "qualquer gateway",<br/>remetente descartável (não liga à identidade de mensagens)
  M->>G: store-and-forward (TTL 7 dias, limites por enlace)
  G->>L: envia os mesmos bytes (idempotente pelo hash)
  L-->>G: no pool / em bloco / finalizada / recusada
  G-->>M: recibo para o remetente descartável
  M-->>W: recibo (só uma DICA: qualquer relay poderia forjar)
  Note over W,L: Quando a carteira volta a ter internet, ela mesma confere na Lunes<br/>(bloco canônico ou varredura) e só então marca "confirmada"
```

---

## 8. Vínculo celular ↔ Piu Desktop ✅

```mermaid
sequenceDiagram
  participant D as Piu Desktop
  participant P as Celular
  D->>D: QR piu-link:1 (host, chave, segredo, hash do certificado), renova a cada 30 s
  P->>D: lê o QR em Perfil → Conectar ao computador e abre wss com certificado fixado
  D-->>P: handshake; os dois mostram 3 palavras
  Note over D,P: No Desktop: escolher a 3ª palavra entre 4 opções (confirmação real, não só "são iguais")
  P-->>D: espelho cifrado (XChaCha20): conversas, contatos, endereço Lunes
  Note over D: O Desktop nunca assina transação: pagamentos pedidos pelo Desktop são aprovados no celular
```

---

## 9. Ponto Piu com roteador Wi-Fi comum 🔜

```mermaid
flowchart TD
  S["Dono: 'Criar ponto Piu'"] --> N{"Rede"}
  N -->|"rede de visitante ou roteador dedicado"| T
  N -->|"sem roteador"| HS["Celular velho cria a própria rede (hotspot local)"] --> T
  T["Teste automático (do lado da rede Piu)"] --> T1{"Aparelhos se enxergam?"}
  T1 -->|"não (isolamento de clientes)"| FIX["Instrução: liberar visitante↔visitante,<br/>ou usar roteador dedicado / hotspot"]
  T1 -->|"sim"| T2{"Rede de casa inalcançável?"}
  T2 -->|"não"| BLOCK["Não ativa: a rede de casa ficaria exposta"]
  T2 -->|"sim"| LV["Nível: multiplicador · guardião ·<br/>guardião + distribuição do app · gateway (opcional)"]
  LV --> ON["Ativar com um toque"]
  ON --> QR["QR de Wi-Fi padrão + cartaz"]
  QR --> VIS["Visitante: notificação e aviso no app<br/>'Ponto Piu por perto — entrar?'"]
  VIS --> USE["Celulares trocam mensagens pelo ponto;<br/>quem está no ponto e no Bluetooth faz a ponte"]
  ON --> PAINEL["Painel: atividade, aparelhos atendidos (só contagem),<br/>guardadas/repassadas, espaço, pausar, encerrar"]
```

O roteador comum **não precisa de firmware novo**: ele só leva pacotes IP entre os aparelhos. Guardar mensagens é papel do
**guardião**; o Piu Node em roteador **OpenWrt** junta as duas coisas e ainda pode formar malha com roteadores vizinhos.

---

*Este documento descreve o estado do código em 06/11/2026. Atualize as marcas ✅ 🧪 🔜 sempre que uma parte mudar de estado.*
