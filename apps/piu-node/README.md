# piu-node (referência)

Nó de referência do provider para Linux (INF-006): um Home Node ou Gateway Local (seção 8 do documento) que **retransmite envelopes de verdade** pela rede local, mais a API local com o painel (`apps/provider-panel`) servido por HTTPS. Tem duas partes:

- **Motor de retransmissão LNNP v1** (`src/relay/`): descobre vizinhos na rede local, abre enlaces TCP autenticados com o handshake LNNP e passa envelopes cifrados com o roteador store-and-forward do protocolo. Especificação: [`docs/lnnp/especificacao-v1.md`](../../docs/lnnp/especificacao-v1.md).
- **Camada de acesso**: pareamento, sessão, autorização e pacotes assinados.

```bash
npm ci
npm test            # segurança (ataques simulados), retransmissão LAN, rádio LoRa simulado, cabo USB e sincronia do protocolo
npm run typecheck
npm run dev         # https://piu-node.local:8420 (painel em ../provider-panel/dist); LNNP em TCP 8422 e UDP 8423
```

## Retransmissão (LNNP v1, adapter LAN)

O que acontece quando o nó sobe:

1. **Identidade do nó**: na primeira execução, gera uma semente própria em `<data>/lnnp/node.seed` (0600) e deriva a chave Ed25519 do nó (`deriveNodeKey`). Ela não tem relação com o operador nem com a carteira.
2. **Descoberta** (Ethernet e Wi‑Fi local, INF-007): a cada 5 s, um anúncio UDP de 18 bytes vai para o broadcast da rede (porta 8423). Quem recebe conecta por TCP (porta 8422) se a sua etiqueta for menor; vizinhos fixos (`PIU_LNNP_PEERS`) são conectados e reconectados sempre.
3. **Handshake LNNP**: HELLO/AUTH assinados, negociação da maior versão comum e das capacidades (MTU, meios, relay, armazenamento, suítes, formatos de envelope). Depois, todo quadro vai cifrado. Conexão que não fala LNNP, nó fora de `PIU_LNNP_ALLOW` ou assinatura errada: recusados e contados.
4. **Encaminhamento**: cada envelope recebido entra no `Router` do protocolo, que guarda o que é de terceiros, descarta duplicatas pelo id, respeita TTL, saltos e cópias, e repassa a todos os outros vizinhos (e aos que aparecerem depois, até vencer). Envelope maior que a MTU do vizinho vai em fragmentos. O nó **nunca decifra** nada (INF-011): não tem chave social.
5. **Recibos**: na primeira cópia de cada envelope de terceiro, o nó assina um recibo de retransmissão (guardados os 1.000 mais recentes, para o validador).
6. **Reinício sem perder mensagens** (design "Reiniciar: mensagens guardadas continuam no armazenamento local"; NFR-002, FUN-012): os envelopes guardados, os ids já vistos e os recibos vão para `<data>/lnnp/relay-store.bin` a cada 30 s quando mudam (`PIU_RELAY_PERSIST_MS`) e ao desligar (`SIGINT`/`SIGTERM`, app desktop). Ao subir, voltam antes do primeiro vizinho conectar e passam de novo pelas regras do roteador (`Router.importStored`/`importSeen`): vencido por TTL ou retenção é descartado, o que não cabe no limite de armazenamento atual fica de fora (o de menor prioridade primeiro), e o mesmo envelope chegando de novo continua sendo duplicata (sem segunda entrega). Também volta a quem cada envelope já foi e quantas cópias saíram, para não repetir envio nem recibo. O arquivo é cifrado e autenticado (AES-256-GCM, chave derivada da semente do nó), 0600 numa pasta 0700, com gravação atômica; corrompido ou de outro nó, é posto de lado (`relay-store.bin.corrompido`) e o nó sobe vazio.

### Rádio LoRa e cabo USB (porta serial)
`PIU_SERIAL` liga portas seriais ao mesmo motor, além do LAN. Exemplo: `PIU_SERIAL=lora:/dev/ttyUSB0@115200,usb:/dev/ttyACM0@115200`. O protocolo no meio está descrito na seção 3.1 da especificação.

- **`lora`**: um rádio LoRa no USB, com firmware de **modem KISS** que guarda frequência, SF e banda.
  - O nó manda só mensagens pequenas: mídia nunca vai, e envelope acima de 1536 bytes fica para outro meio.
  - Cada pacote tem até 255 bytes, com confirmação e repetição.
  - O tempo no ar é calculado com `PIU_LORA_SF`, `PIU_LORA_BW_KHZ` e `PIU_LORA_CR`, que devem ser iguais aos do firmware.
  - O canal não é ocupado acima de `PIU_LORA_DUTY` % por hora.
  - Faixa (no Brasil, 915 MHz) e potência ficam no firmware e precisam seguir a regulamentação.
  - Firmwares que esperam a configuração do rádio vinda do computador (como o RNode) ainda não são suportados: essa configuração depende da placa escolhida.
- **`usb`**: outro nó ligado por cabo serial/USB, ponto a ponto. Pacotes maiores e mídia permitida.
- **Sem dependência nativa**: a porta é configurada com `stty` (no OpenWrt, o do busybox) e lida pelo laço de eventos do Node. O usuário do serviço precisa de acesso ao dispositivo (grupo `dialout`).
- **Porta ausente** (rádio desconectado) não derruba o nó: o LAN continua, e o log diz o que não abriu.
- `GET /api/relay` passa a trazer `serial`, com, por porta:
  - pacotes enviados e recebidos, repetições e perdidos;
  - tempo no ar e ocupação do canal na última hora;
  - envios adiados pelo limite.

  Cada vizinho mostra o meio (`lora`, `usb`).
- **Testes sem placa**:
  - `RadioSim` (`src/relay/radio-sim.ts`) imita o ar: alcance por par de rádios, tempo no ar, perda, colisão, half-duplex e limite de 255 bytes. Os testes cobrem multihop em linha, 25% de perda, mídia e envelope grande retidos, limite de ocupação e vizinho que reinicia.
  - O cabo USB é testado com dois pseudo-terminais reais ligados entre si.

### Limites do operador ligados ao roteador
Os ajustes do **dono do equipamento** (o primeiro operador pareado) em `PUT /api/settings` valem na hora:

| Ajuste do painel | No motor |
|---|---|
| Banda (20/50/100 Mbps) | balde de fichas em bytes/s para envelopes de terceiros (rajada de 1 s); o que não cabe fica para a próxima rodada |
| Armazenamento (4/8/16 GB) | `maxBytes` do roteador, limitado pelo teto de memória `PIU_LNNP_MEMORY_MB` (os envelopes ficam em memória enquanto o nó roda e são gravados em disco para o reinício) |
| Horário (sempre / 22h–7h / 8h–18h, hora local) | fora do horário o nó não guarda nem repassa terceiros; os vizinhos ficam sabendo por `CAPS_UPDATE` |
| Política "mídia" desligada | envelope de terceiro marcado como mídia é recusado sem guardar |

### Regras por equipamento (assistente, passo "Regras")
Cada equipamento pode ter regras próprias de banda (5/20/50 Mbps), armazenamento para terceiros (1/4/8 GB) e horário, enviadas pelo assistente em `POST /api/devices` (`limits`) ou mudadas em `PUT /api/devices/:id/limits` (`{ "clear": true }` volta só aos globais). No **próprio nó**, valem no motor na hora, junto com os limites globais ("Os limites globais de Configurações continuam valendo"): banda e armazenamento ficam com o menor dos dois e os dois horários valem ao mesmo tempo. `GET /api/relay` mostra os globais, as regras do equipamento (`limits.device`) e o que está em vigor (`limits.effective`). Nos outros equipamentos as regras ficam registradas: valem quando o Piu Node deles ler este nó (ainda não lê).

### Chave de operador, revogação e carteira do lote
- **Chave de operador** (design: "Assina seus equipamentos. Separada da sua identidade de conversa"): uma chave Ed25519 por operador, criada no primeiro pareamento e guardada em `<data>/operator/keys.json` (0600, pasta 0700, gravação atômica), fora do `state.json`. Não tem relação com a identidade de conversa, a carteira ou a chave técnica do nó. Ela assina a identidade técnica do próprio nó e a dos equipamentos vinculados a um vizinho LNNP (certificado `OPERATOR_CERT`), e a lista de revogação. `GET /api/operator` mostra a impressão digital (8 grupos de 4), quando foi criada, rotações e o último backup. Arquivo de chaves ilegível: o nó sobe mesmo assim e guarda o arquivo de lado (`keys.json.corrompido-…`), sem sobrescrever; restaure o backup cifrado.
- **Backup cifrado** (`POST /api/operator/backup`, com step-up): arquivo `piu-operador.backup`, protegido por uma senha de pelo menos 10 caracteres, com scrypt (N = 2^16) e XChaCha20-Poly1305, o cabeçalho como dado associado (o mesmo esquema do `.piu` do app). `POST /api/operator/restore` (com step-up) restaura num segundo nó: os dois passam a ser do mesmo operador e se reconhecem na malha.
- **Rotação** (`POST /api/operator/rotate`, com step-up): chave nova, assinada pela antiga. O nó assina de novo o próprio certificado, os dos equipamentos e a lista de revogação. Os outros nós do operador recebem a chave nova na próxima sincronização (o certificado leva os passos de rotação; quem confia na chave atual segue para a nova; um ramo a partir de uma chave antiga não vale). No nó que recebeu a rotação de outro, `GET /api/operator` traz `rotatedElsewhere: true`: restaure nele o backup novo.
- **Revogar** (`DELETE /api/devices/:id` de um equipamento com identidade técnica): a chave do nó entra na lista de revogação assinada pela chave de operador. No nó do dono vale na hora (o enlace com ele fecha e o handshake passa a ser recusado com `UNAUTHORIZED`, contado em `revokedRefused`), e a lista vai para os vizinhos do mesmo operador, que fazem o mesmo e repassam. Responde `{ revoked: true, appliedHere }`; sem identidade técnica, o registro só sai do painel (`204`). O que o nó aprende da malha (rotações, a lista, o próprio certificado) fica em `<data>/lnnp/operator-trust.json`. Formato e regras: `docs/lnnp/especificacao-v1.md`, seção 8.1. Limite: só alcança nós do mesmo operador; um equipamento revogado que tinha cópia da chave de operador exige rotação.
- **Evidências para o validador** (`GET /api/relay/evidence`, só o dono): os recibos guardados no formato `EvidenceFile` de `apps/settlement` (`v: 1`, binários em hex), para baixar e levar ao validador. Provas de entrega (`ackSecret`) só existem no destino; o piu-node não decifra nada, então `proofs` vem vazio.
- **Carteira do lote** (`POST /api/payout-claims`, só o dono, com step-up): o nó assina com a chave técnica dele a carteira que recebe o lote desta semana ou da próxima (`PayoutClaim`; época = semana ISO em UTC, `AAAA-Snn`). O endereço LUNES é conferido por inteiro (base58, prefixo SS58 42 ou 57, chave de 32 bytes e soma de verificação BLAKE2b), sem dependência pesada. Declarar de novo a mesma época troca a carteira aqui; se o arquivo anterior já foi entregue, o validador vê duas carteiras e não paga nenhuma naquele lote. `GET /api/payout-claims/file` baixa as declarações no formato `ClaimFile`.

### `GET /api/relay` (com sessão)
Estatísticas reais, sem conteúdo, destino nem chave secreta: `relaying` (retransmitindo agora), versão LNNP, id do nó, `neighbors` (id, endereço, versão, meios, relay, MTU, desde quando), `store` (envelopes e bytes guardados, teto), `counters` (`received`, `stored`, `forwarded`, `delivered`, `duplicates`, `rejected`, `relayOff`, `full`, `expired`, `receipts`, `receiptsReceived`, `handshakesOk`, `handshakesFailed`) e os limites em vigor. Com o motor desligado: `{ "enabled": false }`.

### Histórico, recibos e o próprio equipamento (com sessão)
- **`GET /api/relay/history`**: a cada `PIU_RELAY_SAMPLE_MS` (padrão 5 min), a diferença dos contadores do motor vira uma amostra, e as amostras se somam por dia (hora local). Volta `{ enabled, sampleMs, today, samples, days, unsampled }`: amostras das últimas 24 h (`received`, `stored`, `forwarded`, `duplicates`, `rejected`, `relayOff`, `full`, `expired`, `receipts`, `receiptsReceived`, mais `neighbors` e `storedBytes` no fim da rodada) e até 120 dias de totais. O que aconteceu depois da última rodada vem em `unsampled` e já entra no total de hoje (o dia aparece em tempo real). Guardado em `<data>/lnnp/relay-history.json` (0600, gravação atômica); a última rodada é gravada ao desligar. Só contagens: nada de conteúdo, destino, chave ou id de envelope.
- **`GET /api/relay/receipts`**: recibos guardados para o validador (`kept`, `keptOwn`, `max`) e o horário dos 20 mais recentes, com `own` (assinado por este nó). Sem id de envelope, hash do segredo de entrega nem chave.
- **LUNES não aparecem aqui**: o valor de um recibo depende do validador e da liquidação na Mainnet. O painel mostra contagens e diz que o valor ainda não existe.
- **O próprio nó é um equipamento do dono**: no primeiro pareamento (ou ao subir, se já há dono), o nó se registra com o nome da máquina (`hostname`) e a classe Home Node (Gateway Local com `PIU_SERIAL`). `GET /api/devices` marca com `self: true`. Pausar esse equipamento pausa a retransmissão de terceiros no motor na hora (e continua pausado depois de reiniciar); removê-lo pelo painel não pode (`409`). Os outros equipamentos são registros do assistente: ainda não mandam estatísticas a este nó.
- **Carteira sem valor de exemplo**: operador novo começa com saldo 0 e sem movimentações. `GET /api/wallet` traz as movimentações reais (`kind: 'out'` para transferências; `kind: 'in'` para liquidação recebida, com a referência do lote em `from`). Não há rota que credite: só a liquidação de verdade (ferramenta local) chama `Store.credit`.

### Carteira de provider na Lunes Mainnet (só leitura)
- O operador configura o endereço Lunes (SS58) da carteira de provider dele no painel (`PUT /api/wallet/lunes`, com step-up; `DELETE` tira). O endereço é conferido no servidor (base58, prefixo 57 ou 42, chave de 32 bytes, soma de verificação BLAKE2b) e guardado no `state.json`, por operador. O nó **não tem a chave** dessa carteira: não assina nem envia nada.
- `GET /api/wallet/lunes` devolve `{ address, setAt, explorer, endpoints, onchain, error, cached }`. `onchain` é o saldo lido na Lunes Mainnet no último bloco finalizado (`free`, `reserved`, `frozen` em planck como texto, 1 LUNES = 10^8 planck; `block`, `blockHash`, `endpoint` que respondeu e `at`). Sem endereço, não consulta a rede.
- A leitura usa o cliente leve de `src/lunes/` (JSON-RPC sobre WebSocket, `state_getStorage` de System.Account, sem @polkadot/api), com troca automática entre os endereços de `PIU_LUNES_ENDPOINTS` (padrão: `wss://ws.lunes.io`, `wss://ws-lunes-main-01.lunes.io`, `wss://ws-lunes-main-02.lunes.io`, `wss://ws-archive.lunes.io`, nesta ordem), tempo limite de 5 s por endereço e cache de 30 s por endereço. Sem rede: volta a última leitura, com o horário dela, e o motivo em `error`; depois de uma falha, espera 10 s antes de tentar de novo.
- WebSocket: o global do Node 22. No Node 20 (OpenWrt 24.10) ele só existe com `NODE_OPTIONS=--experimental-websocket`; sem isso, `error` diz que falta WebSocket e o resto do nó funciona normalmente.
- Libere no firewall de saída do equipamento os domínios acima (TCP 443).
- `src/lunes/xxhash.ts`, `ss58.ts` e `lunesRpc.ts` são **cópia gerada** de `apps/mobile/src/lib/` (`npm run lunes:sync`); `test/lunes.test.ts` falha se a cópia ficar diferente. `src/lunes/reader.ts` (cache) é só daqui.

### Código do protocolo
`src/protocol/` é uma **cópia gerada** de `apps/mobile/src/protocol/` (`npm run protocol:sync`), não um import relativo: o piu-node é ESM com `moduleResolution: nodenext` (exige `.js` nos imports, que o app não usa), compila com `noUncheckedIndexedAccess` e precisa rodar sozinho em Linux/OpenWrt, sem o projeto Expo e o `node_modules` dele. O teste `test/protocol-sync.test.ts` falha se a cópia ficar diferente da fonte. O app desktop continua empacotando com esbuild normalmente (as dependências `@noble/*` estão no `package.json` daqui).

## Como o operador entra
1. Ao iniciar, o nó mostra **no próprio console/tela** um código de 8 dígitos (vale 10 min, uso único) e a impressão digital SHA-256 do certificado TLS.
2. No navegador, a pessoa abre `https://piu-node.local:8420`, confere a impressão digital antes de aceitar o certificado e digita o código.
3. O nó cria uma sessão: cookie `__Host-piu_session` (`HttpOnly`, `Secure`, `SameSite=Strict`), 30 min de inatividade, 12 h no máximo. O token fica só como hash no servidor.

Parear de novo com o **mesmo nome** (sessão expirada, outro navegador) volta à mesma conta, com os mesmos equipamentos; um nome novo cria outro operador.

Provar o código é provar acesso físico ao equipamento. Quem está só na mesma rede Wi‑Fi não vê o código.

## API
| Rota | O que faz |
|---|---|
| `POST /api/pair`, `POST /api/reauth`, `GET /api/session`, `POST /api/logout` | pareamento, step-up e sessão |
| `GET /api/sessions`, `POST /api/sessions/revoke-others` | acessos abertos do operador (rótulo "Firefox · Linux", sem token) e encerrar os outros (exige step-up) |
| `GET`/`PUT /api/settings` | limites globais (banda, armazenamento, horário) e política de tráfego, por operador |
| `GET /api/devices`, `POST /api/devices`, `POST /api/devices/:id/pause`, `DELETE /api/devices/:id` | equipamentos (o assistente do painel cria com `POST`, opcionalmente com a identidade técnica `nodePk` de um vizinho e as regras `limits`; o próprio nó vem com `self: true`). `DELETE` de um equipamento com identidade técnica revoga a chave dele na malha do operador |
| `PUT /api/devices/:id/limits` | regras do equipamento (banda, armazenamento, horário); no próprio nó valem no motor |
| `GET /api/operator`, `POST /api/operator/backup`, `POST /api/operator/rotate`, `POST /api/operator/restore` | chave de operador: impressão digital, backup cifrado, rotação e restauração (as três últimas exigem step-up) |
| `GET /api/relay/evidence` | recibos no formato `EvidenceFile` do validador (só o dono) |
| `GET`/`POST /api/payout-claims`, `GET /api/payout-claims/file` | carteira do lote assinada pelo nó (`PayoutClaim`; declarar exige step-up) e o arquivo `ClaimFile` |
| `GET`/`PUT`/`DELETE /api/wallet/lunes` | endereço Lunes da carteira de provider (configurar e tirar exigem step-up; SS58 conferido no servidor) e o saldo on-chain lido na Mainnet, com bloco e endereço que respondeu |
| `GET /api/wallet`, `POST /api/wallet/transfer` | saldo e transferência para a carteira pessoal ou um endereço `lunes:…` (exige step-up). Com celular pareado, devolve `202` com o pedido a aprovar |
| `POST /api/wallet/transfer/:id/approve` | conclui o pedido com o código de aprovação que o celular mostrou (uso único, 5 tentativas a cada 10 min) |
| `GET /api/phones`, `POST /api/phones`, `POST /api/phones/:id/confirm`, `DELETE /api/phones/:id` | celulares que aprovam transferências: listar (sem o segredo), parear (exige step-up; devolve o QR), confirmar com os 6 dígitos e remover |
| `GET /api/relay` | estatísticas da retransmissão LNNP (vizinhos, guardados, encaminhados, duplicatas, recibos, `paused`, `startedAt`) |
| `GET /api/relay/history` | histórico das estatísticas: amostras de 24 h e totais por dia, guardados no nó |
| `GET /api/relay/receipts` | recibos guardados para o validador (contagem e horários, sem ids) |
| `GET /api/packages`, `GET /pkg/:file` | pacotes assinados do instalador |
| `GET /api/alerts` | alertas oficiais vigentes lidos dos feeds CAP 1.2 (`PIU_ALERT_FEEDS`), com a origem (feed, link, `sender`) e o estado de cada feed. Retransmitidos pelo nó: os órgãos não distribuem chave de assinatura, então nada é "assinado pelo órgão" |

`src/server.ts` (`startNode`) sobe o nó inteiro (TLS, pacotes, motor de retransmissão, API e painel; se o motor não subir, por exemplo com a porta ocupada, o painel sobe mesmo assim e o motivo vai para o log) e é usado pela linha de comando (`src/main.ts`) e pelo app desktop (`apps/provider-desktop`).

## Aprovação no celular
Sem rede entre o celular e o nó, tudo passa por QR e códigos digitados:
1. **Parear (uma vez):** em Configurações → Parear celular, o painel mostra um QR `piup:` com um segredo de 32 bytes. O app Piu (Nova conversa → Escanear código) guarda o segredo no cofre do aparelho e mostra 6 dígitos, que o operador digita no painel.
2. **Transferir:** o painel mostra o QR do pedido (`piut:` com valor, destino e validade) e um código de conferência de 6 dígitos. O celular mostra o valor, o destino e o mesmo código. Depois da biometria, mostra o código de aprovação (16 caracteres), que o operador digita no painel.

Sem celular pareado, a transferência continua pedindo só o código novo do equipamento.

## Proteções (cada uma com teste em `test/security.test.ts`)

| Ameaça | Proteção |
|---|---|
| Acesso sem login (A01/A07) | toda rota `/api/*`, exceto o pareamento, exige sessão, conferida em `onRequest`, **antes** de ler o corpo |
| Força bruta no código | 5 erros destroem o código (de qualquer IP) e um novo só aparece no console depois de 60 s; além disso, 5 tentativas por IP a cada 10 min |
| CSRF | `SameSite=Strict`, mais a mesma origem (`Origin` ou `Sec-Fetch-Site`), mais o token `X-CSRF-Token` da sessão em toda mudança de estado |
| DNS rebinding | só responde aos nomes de `PIU_NODE_HOSTS` (outros: 421) |
| IDOR | cada ação confere a posse do equipamento; o de outro operador devolve 404, sem revelar que existe |
| Enumeração | ids são UUID v4; nada incremental |
| Transferência de LUNES | exige autenticação recente (15 min; senão pede um código novo do equipamento), valor com até 2 casas, saldo e limite de 10/min |
| Painel comprometido aprovando sozinho | com celular pareado, a transferência só sai com o código de aprovação = HMAC(segredo do celular, pedido), conferido em tempo constante; o segredo nunca volta pela API, e o pedido vence em 5 min e vale uma vez (`src/security/approval.ts`) |
| Dados sensíveis | respostas só com os campos necessários; o token da sessão nunca vai no corpo; logs com cookie, CSRF e `Set-Cookie` mascarados |
| Erros | mensagens genéricas, sem stack trace nem caminho interno; validação estrita (sem conversão de tipo, campo extra é erro) |
| Headers (A05) | Helmet: CSP estrita, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, COOP/CORP, mais `Permissions-Policy`; sem `X-Powered-By` |
| CORS | fechado: nenhuma resposta tem `Access-Control-Allow-Origin` |
| Path traversal | arquivos do painel com caminho normalizado e preso à pasta, só extensões conhecidas, sem listagem |
| Transporte | só HTTPS (certificado P-256 próprio, chave com `0600`); HTTP puro não é servido |
| Armazenamento | pasta de dados com `0700`, estado com `0600`, gravação atômica |
| Integridade do instalador (A08) | pacotes só com manifesto assinado (Ed25519) pela chave de release **fixada** (`PIU_RELEASE_PUBKEY`) e arquivo conferido (tamanho + SHA-256); o instalador confere de novo antes de executar |

## Pacotes do instalador
No ambiente de build da Lunes (nunca no nó):
```bash
npm run release:keygen -- release-keys             # par Ed25519; a privada fica com 0600 (guarde em HSM/cofre)
npm run release:sign -- release-keys/release-private.pem piu-node-openwrt.ipk piu-node-openwrt 0.4.3
```
Copie o pacote e o `.manifest.json` para `<data>/packages/`. No equipamento novo, antes de instalar:
```bash
PIU_RELEASE_PUBKEY=<chave pública> node verify-package.mjs piu-node-openwrt.ipk piu-node-openwrt.ipk.manifest.json
```
Só instale com `OK:` e código de saída 0.

## Configuração
| Variável | Padrão | |
|---|---|---|
| `PIU_NODE_PORT` | `8420` | porta HTTPS |
| `PIU_NODE_LISTEN` | `0.0.0.0` | endereço de escuta |
| `PIU_NODE_HOSTS` | `piu-node.local,localhost,127.0.0.1` | nomes aceitos no `Host` (inclua o IP do nó na rede, se usar) |
| `PIU_NODE_DATA` | `./data` | estado, TLS e pacotes |
| `PIU_NODE_PANEL` | `../provider-panel/dist` | build do painel |
| `PIU_RELEASE_PUBKEY` | — | chave pública de release (SPKI DER em base64). Sem ela, nenhum pacote é oferecido |
| `PIU_LNNP` | `1` | `0` desliga o motor de retransmissão inteiro |
| `PIU_LNNP_RELAY` | `1` | Modo nó: `0` mantém os enlaces mas não guarda nem repassa envelopes de terceiros |
| `PIU_LNNP_LISTEN` | `0.0.0.0` | endereço de escuta do enlace e da descoberta |
| `PIU_LNNP_PORT` | `8422` | porta TCP do enlace LNNP |
| `PIU_LNNP_DISCOVERY_PORT` | `8423` | porta UDP do anúncio; `off` desliga a descoberta |
| `PIU_LNNP_BROADCAST` | `255.255.255.255` | destinos do anúncio (ex.: `192.168.0.255`, ou `host:porta`), separados por vírgula |
| `PIU_LNNP_PEERS` | — | vizinhos fixos `host:porta`, separados por vírgula |
| `PIU_LNNP_ALLOW` | — | só aceita estes nós (chave do nó em hex, 64 caracteres); vazio aceita qualquer nó LNNP |
| `PIU_LNNP_MEMORY_MB` | `256` | teto de memória para envelopes guardados |
| `PIU_LNNP_BEACON_MS` | `5000` | intervalo do anúncio e das reconexões |
| `PIU_SERIAL` | — | portas seriais `tipo:caminho@velocidade`, separadas por vírgula; tipo `lora` ou `usb` (ex.: `lora:/dev/ttyUSB0@115200`) |
| `PIU_LORA_SF` | `9` | spreading factor do rádio (7–12), igual ao do firmware |
| `PIU_LORA_BW_KHZ` | `125` | largura de banda (62.5, 125, 250, 500) |
| `PIU_LORA_CR` | `5` | taxa de código 4/5 a 4/8 (5–8) |
| `PIU_LORA_DUTY` | `10` | ocupação máxima do canal, % por hora |
| `PIU_LORA_MAX_ENVELOPE` | `1536` | maior envelope enviado pelo rádio (bytes) |
| `PIU_LORA_BEACON_MS` | `30000` | intervalo do anúncio pelo rádio |
| `PIU_RELAY_SAMPLE_MS` | `300000` | intervalo das amostras do histórico de retransmissão (1 s a 1 h) |
| `PIU_RELAY_PERSIST_MS` | `30000` | intervalo para gravar as mensagens guardadas, os ids vistos e os recibos quando mudam (1 s a 1 h) |
| `PIU_ALERT_FEEDS` | `http://alert-as.inmet.gov.br/cap_12/rss/alert-as.rss` | feeds de alertas CAP 1.2 (RSS/Atom, ou URL que devolve um `<alert>`), separados por vírgula; vazio desliga. Alternativo do INMET: `https://alerts.inmet.gov.br/cap_12/rss/alert-as.rss`. A IDAP da Defesa Civil guarda alertas em CAP, mas sem endpoint documentado: inclua aqui quando houver. Os vigentes ficam em `<data>/alerts/alerts.json` (vencem pelo `expires`; sem ele, 24 h depois do `sent`) |
| `PIU_ALERT_POLL_MS` | `600000` | intervalo entre as leituras dos feeds (1 min a 24 h) |
| `PIU_LUNES_ENDPOINTS` | os 4 de produção | endereços WebSocket da Lunes Mainnet para ler o saldo da carteira de provider (`wss://…`, separados por vírgula, na ordem de tentativa) |

Abra no firewall do equipamento a porta TCP 8422 e a UDP 8423 só para a rede local.

## Próximos passos
- Passkeys (WebAuthn) depois do primeiro pareamento, para não depender do código a cada novo navegador.
- Ligar a carteira à liquidação real (item 7: pagar os lotes na Mainnet) e os recibos ao validador; o saldo on-chain da carteira de provider já é lido (`GET /api/wallet/lunes`), mas o saldo do nó (`GET /api/wallet`) só muda com transferências e créditos locais.
- Estatísticas dos outros equipamentos do operador (hoje só o nó que serve o painel tem dados reais).
- Envelopes guardados direto em disco, além do teto de memória `PIU_LNNP_MEMORY_MB` (hoje o disco serve ao reinício; o teto em uso continua sendo o da memória).
- Adapters além da LAN (BLE, LoRa por USB) usando o mesmo `RelayEngine.attach`.
- Enviar os recibos ao validador pela malha quando houver rota (`RelayEngine.sendReceipts`); hoje o operador baixa as evidências no painel e leva ao validador.
- Revogação na rede inteira (chave da Lunes) e certificação de equipamentos por pareamento real no assistente (hoje o vínculo é com um vizinho LNNP escolhido pelo operador).
