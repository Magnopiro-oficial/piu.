# piu-node (referência)

API local do equipamento do provider, com o painel (`apps/provider-panel`) servido por HTTPS na rede local. É a **implementação de referência da camada de acesso** do `piu-node`: pareamento, sessão, autorização e pacotes assinados. O motor de retransmissão (LNNP) fica fora deste projeto.

```bash
npm ci
npm test            # 19 testes de segurança (ataques simulados)
npm run typecheck
npm run dev         # https://piu-node.local:8420 (painel em ../provider-panel/dist)
```

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
| `GET /api/wallet`, `POST /api/wallet/transfer` | saldo e transferência para a carteira pessoal ou um endereço `lunes:…` (exige step-up) |
| `GET /api/packages`, `GET /pkg/:file` | pacotes assinados do instalador |

`src/server.ts` (`startNode`) sobe o nó inteiro (TLS, pacotes, API e painel) e é usado pela linha de comando (`src/main.ts`) e pelo app desktop (`apps/provider-desktop`).

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

## Próximos passos
- Passkeys (WebAuthn) depois do primeiro pareamento, para não depender do código a cada novo navegador.
- Os dados (carteira e equipamentos) aqui são de referência; ligar ao motor LNNP e à carteira real.
