# piu-node (referência)

Nó de referência do provider para Linux (INF-006): um Home Node ou Gateway Local (seção 8 do documento) que **retransmite envelopes de verdade** pela rede local, mais a API local com o painel (`apps/provider-panel`) servido por HTTPS. Tem duas partes:

- **Motor de retransmissão LNNP v1** (`src/relay/`): descobre vizinhos na rede local, abre enlaces TCP autenticados com o handshake LNNP e passa envelopes cifrados com o roteador store-and-forward do protocolo. Especificação: [`docs/lnnp/especificacao-v1.md`](../../docs/lnnp/especificacao-v1.md).
- **Camada de acesso**: pareamento, sessão, autorização e pacotes assinados.

```bash
npm ci
npm test            # 19 testes de segurança (ataques simulados) + 8 de retransmissão + 1 de sincronia do protocolo
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

### Limites do operador ligados ao roteador
Os ajustes do **dono do equipamento** (o primeiro operador pareado) em `PUT /api/settings` valem na hora:

| Ajuste do painel | No motor |
|---|---|
| Banda (20/50/100 Mbps) | balde de fichas em bytes/s para envelopes de terceiros (rajada de 1 s); o que não cabe fica para a próxima rodada |
| Armazenamento (4/8/16 GB) | `maxBytes` do roteador, limitado pelo teto de memória `PIU_LNNP_MEMORY_MB` (os envelopes ficam em memória nesta versão) |
| Horário (sempre / 22h–7h / 8h–18h, hora local) | fora do horário o nó não guarda nem repassa terceiros; os vizinhos ficam sabendo por `CAPS_UPDATE` |
| Política "mídia" desligada | envelope de terceiro marcado como mídia é recusado sem guardar |

### `GET /api/relay` (com sessão)
Estatísticas reais, sem conteúdo, destino nem chave secreta: `relaying` (retransmitindo agora), versão LNNP, id do nó, `neighbors` (id, endereço, versão, meios, relay, MTU, desde quando), `store` (envelopes e bytes guardados, teto), `counters` (`received`, `stored`, `forwarded`, `delivered`, `duplicates`, `rejected`, `relayOff`, `full`, `expired`, `receipts`, `receiptsReceived`, `handshakesOk`, `handshakesFailed`) e os limites em vigor. Com o motor desligado: `{ "enabled": false }`.

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
| `GET /api/devices`, `POST /api/devices`, `POST /api/devices/:id/pause`, `DELETE /api/devices/:id` | equipamentos (o assistente do painel cria com `POST`) |
| `GET /api/wallet`, `POST /api/wallet/transfer` | saldo e transferência para a carteira pessoal ou um endereço `lunes:…` (exige step-up). Com celular pareado, devolve `202` com o pedido a aprovar |
| `POST /api/wallet/transfer/:id/approve` | conclui o pedido com o código de aprovação que o celular mostrou (uso único, 5 tentativas a cada 10 min) |
| `GET /api/phones`, `POST /api/phones`, `POST /api/phones/:id/confirm`, `DELETE /api/phones/:id` | celulares que aprovam transferências: listar (sem o segredo), parear (exige step-up; devolve o QR), confirmar com os 6 dígitos e remover |
| `GET /api/relay` | estatísticas da retransmissão LNNP (vizinhos, guardados, encaminhados, duplicatas, recibos) |
| `GET /api/packages`, `GET /pkg/:file` | pacotes assinados do instalador |

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

Abra no firewall do equipamento a porta TCP 8422 e a UDP 8423 só para a rede local.

## Próximos passos
- Passkeys (WebAuthn) depois do primeiro pareamento, para não depender do código a cada novo navegador.
- Os dados de carteira e equipamentos ainda são de referência; ligar à carteira real e aos recibos do motor.
- Guardar os envelopes em disco (hoje ficam em memória, até `PIU_LNNP_MEMORY_MB`) e salvar os ids vistos entre reinícios (`Router.exportSeen`).
- Adapters além da LAN (BLE, LoRa por USB) usando o mesmo `RelayEngine.attach`.
- Enviar os recibos ao validador quando houver rota (`RelayEngine.sendReceipts`).
