# Auditoria final — núcleo e servidor (piu-node, settlement, provider-panel, provider-desktop, OpenWrt)

Data: 06/11/2026.

**Escopo:**
- `apps/piu-node`
- `apps/settlement`
- `apps/provider-panel`
- `apps/provider-desktop`
- `packaging/openwrt`

**Regras desta rodada:**
- Nada foi enviado à Lunes Mainnet. A liquidação rodou só contra a chain simulada (`apps/settlement/test/fake-chain.ts`), e o piu-node local apontou a leitura da Lunes para um endereço morto (`wss://127.0.0.1:1`).
- Nenhuma mudança no git.
- `apps/mobile` é de outra frente. Só os arquivos copiados de lá foram sincronizados, e só no fim, depois de `npx tsc --noEmit` passar no `apps/mobile`.

Legenda: **I** implementado e testado · **P** parcial · **N** não implementado · **F** implementado com falhas · **E** depende de algo externo.

## 1. Requisitos (linhas do CHECKLIST)

| # | Atividade (lado núcleo/servidor) | Status | Prova |
|---|---|---|---|
| 2 | Assinatura das versões: SHA256SUMS com GPG, .deb/.AppImage assinados, Mac ad-hoc | **P / E** | Ver detalhe 2 abaixo. |
| 10 | Auditoria AppSec, correções sem mudar o protocolo | **I** | Seção 2. As correções anteriores (A-02, M-01…M-04, B-02, B-05, B-09; provider M-01, B-02, B-04, B-05) foram conferidas de novo no código por uma revisão independente. `npm audit --omit=dev`: 0 nos 5 pacotes. |
| 11 | Prova de entrega v2 no liquidante, mais as correções do consultor | **I** (código) / **E** (ativação) | Ver detalhe 11 abaixo. |
| 12 | Assinatura Apple/Windows preparada por variáveis | **I** (preparo) / **E** (certificados) | Sem certificado, `electron-builder.signing.cjs` devolve `{"mac":{"identity":"-","hardenedRuntime":false,"notarize":false},"win":{"cscLink":""}}`, ou seja, ad-hoc no Mac e sem assinatura no Windows, como decidido em 06/11. Os fuses do Electron estão em `electron-builder.yml`. |
| 16 | Modo nó no celular, lado do validador: 100 LUNES, 3 avais, 2 raízes, caução, devolução e confisco | **I** (código) / **E** (endereço da caução) | Ver detalhe 16 abaixo. |
| 19 | Painel do Piu Node com gateway (E3) | **I** | Ver detalhe 19 abaixo. |
| 20 | Transações e provas pela malha até o gateway (nó e validador) | **I**, com um resíduo **P** | Ver detalhe 20 abaixo. |
| 27 | Nova auditoria de segurança e correções | **I**, com resíduos documentados | Seção 2: 16 achados novos, 14 corrigidos ou mitigados com teste. |
| 28 | Testes unitários, de integração, E2E e build | **I** (local) / **E** (aparelho) | Seção 3. Teste em aparelho não foi feito: OpenWrt real, app Electron aberto e celular. |

**Detalhe 2 (assinatura das versões).**
- Já preparado:
  - `scripts/sign-release.sh` confere cada hash, recusa arquivo fora do `SHA256SUMS.txt`, assina com `gpg --detach-sign` e confere a assinatura.
  - `release-provider-desktop.yml` gera o `SHA256SUMS.txt` em rascunho.
- Falta a chave: `docs/distribuicao/piu-release.fpr` não existe, porque a chave GPG ainda não foi gerada (**E**).

**Detalhe 11 (prova de entrega v2).**
- Testes do settlement (`v2.test.ts`, `v2-revisao.test.ts`, `validator.test.ts`): 76/76.
- Demonstração completa: `validator:demo` → 2 × `validator:close` → `lot:plan` → pagamento na chain simulada → `validator:paid`.
  - Resultado: 360 entregas comprovadas e 720 recibos válidos; 3 carteiras receberam exatamente o valor do lote.
  - Rodar de novo não paga de novo, e o mesmo lote com outro id é recusado.
- A recompensa só liga quando a Lunes publicar a chave do validador (`VALIDATOR_PROOF_PK = null` no app) (**E**).

**Detalhe 16 (modo nó no celular, lado do validador).**
- Código: `phone-nodes.ts` (`DEFAULT_PHONE_POLICY`: `minBondPlanck` 100 LUNES, `minEndorsements` 3, `minRoots` 2) e `bond.ts`.
- `phones.test.ts`: ciclo completo contra a chain simulada (caução, avais, saída, devolução, confisco, limites).
- CLI `validator:bonds list/due/refund/slash` rodado sobre um estado de demonstração, com respostas corretas para "nenhuma caução".
- Sem `bondAddress` no `config.json`, nenhum celular é habilitado (**E**: falta a Lunes definir o endereço da caução).

**Detalhe 19 (painel do gateway).**
- O piu-node subiu local com dados temporários (`PIU_NODE_DATA` no scratchpad, `127.0.0.1:18420`).
- Fluxo da API por `curl`, 24 verificações:
  - pareamento pelo código lido do arquivo `pairing-code` (0600);
  - sessão, step-up (`/api/reauth`), CSRF e Origin;
  - Host não permitido (421);
  - `GET`/`PUT /api/gateway`;
  - exportação de evidências com `Content-Disposition`;
  - co-operador recebe 403 no gateway e nas evidências;
  - id inexistente dá 404;
  - logout.
- Painel no navegador embutido (Vite dev com proxy para o nó de teste):
  - parear;
  - abrir Visão geral e Gateway;
  - salvar a caixa com `http://`: o painel mostra o erro do nó;
  - salvar com `https://`: aparece o aviso "Caixa do validador salva", e o `GET` reflete a mudança.

**Detalhe 20 (malha até o gateway).**
- `gateway.test.ts`: celular → relay → piu-node gateway → Lunes simulada, e os recibos "pool" e "finalizada" voltam pela malha.
- `gateway-panel.test.ts` cobre o painel do gateway.
- Caixa do validador:
  - `validator:inbox --listen`, por HTTP real: 202 gravado, 202 repetido, 400 adulterado, 404 em outra rota;
  - `--from`: 2 gravados e 1 recusado.
- Resíduo M-N1: abuso do gateway, cuja raiz está no código do app (`apps/mobile`). Ver seção 2.

## 2. Segurança: achados, correções e reteste

Fonte:
- revisão independente desta rodada (duas, uma do settlement e outra do piu-node, do provider e do OpenWrt);
- pendências da auditoria `docs/seguranca/auditoria-2026-11-06/`.

**Já está bem feito (conferido no código):**
- Todas as rotas `/api` passam por sessão em `onRequest`. As que mudam estado exigem mesma origem e token CSRF (comparação em tempo constante).
- Validação de corpo:
  - ajv estrito, com `additionalProperties: false`;
  - limite de corpo de 16 KiB.
- Cabeçalhos e rede:
  - Helmet com CSP `default-src 'none'`, HSTS, `frame-ancestors 'none'` e `no-referrer`;
  - CORS fechado;
  - lista de Hosts contra DNS rebinding.
- Limites de requisição: global de 300/min e de 5 a cada 10 min em pair, reauth, backup, restore e rotate.
- Sessão:
  - cookie `__Host-` HttpOnly, Secure e SameSite=Strict;
  - token guardado só como SHA-256;
  - inatividade de 30 min e no máximo 12 h.
- Rotas por id conferem a posse e devolvem 404 (IDOR).
- Electron:
  - `contextIsolation`, `sandbox` e sem `nodeIntegration`;
  - certificado do nó fixado;
  - navegação e janelas travadas;
  - fuses fechados;
  - sessão local criada pelo processo principal, sem step-up.
- Segredos em 0600 numa pasta 0700, conferido ao vivo: `pairing-code`, `node.seed`, `tls/key.pem`.

### Corrigidos nesta rodada (com teste novo)

| Id | Sev. | Componente | Problema | Correção | Reteste |
|---|---|---|---|---|---|
| H-1 | **Alta** | settlement | Inteiros u32 maleáveis (`X` e `X+2^32` têm a mesma assinatura). Uma lista de revogação antiga com `seq+2^32` "desrevogava" um nó roubado. Uma cópia de certificado, de passo de rotação ou de recibo com `+2^32` tirava o crédito de terceiros. | `isU32` em `hex.ts`. `u32()` estrito em `registry.ts`. Faixa conferida ANTES da deduplicação em `registry.ts` (certificados, rotação, listas), em `validator.ts` (`buildLedger`) e em `inbox.ts` | `test/auditoria-final.test.ts`: 5 testes H-1 |
| M-1 | Média | settlement | Endereço SS58 de índice (1–8 bytes) ou de 33 bytes entrava no lote e travava os pagamentos a cada época | `lot.ts` (`normalizeAddress` exige 32 bytes) e `validator.ts` (carteira declarada de outro tamanho é ignorada) | teste M-1 |
| M-2 | Média | settlement | Dois `lot:pay` simultâneos do mesmo lote podiam pagar duas vezes | Trava exclusiva `diario/<lote>.lock` (O_EXCL, pid; trava de processo morto é retomada) em `journal.ts` e `settler.ts`. Temporário de gravação com nome único (`fsutil.ts`) | teste M-2 (dois pagamentos concorrentes, uma transação só) |
| M-3 (B-06) | Média | settlement | Gênese não fixada; nó RPC por `ws://` aceito. Um nó que mente podia levar a repagar ou a validar cauções falsas | `EXPECTED.genesisHash` da Mainnet em `preflight`, `lot:pay` e na leitura de cauções do `close`. `PIU_SETTLEMENT_GENESIS` para rede de desenvolvimento. `checkEndpoints`: só `wss://` (`ws://` só em localhost) | teste M-3; ao vivo, `--ws ws://10.0.0.1:9944` é recusado |
| M-4 | Média | settlement | Avais de chaves geradas na hora enchiam o estado (100 mil) e expulsavam avais legítimos. A caixa atrás de proxy dividia a cota por IP do proxy. Sem cota de disco | Só entra no estado aval PARA celular registrado, DE operador admitido ou de celular registrado (o resto vai ao relatório como "avalista não habilitado"). `--trust-proxy` (último `X-Forwarded-For`, só de loopback). Cota de 200 mil arquivos (507) | teste M-4; `inbox.test.ts` (proxy e cota) |
| B-a | Baixa | settlement | Diário corrompido era tratado como "lote novo" | `Journal.get`: só `ENOENT` vale como inexistente; JSON inválido ou de outro lote aborta | teste B-a |
| B-07 | Baixa | settlement | Semente em texto claro aceita na Mainnet; permissão do keystore e da chave das provas não conferida | `loadSigner(env, ss58, genesis)` recusa a semente na Mainnet e confere 0600 no keystore e no arquivo de senha. `validator-cli` recusa `chave-provas.json` com permissão aberta | teste B-07; ao vivo, `chmod 644` é recusado |
| B-08 | Baixa | settlement | Arquivo ou lista malformados derrubavam o `close` | `readAll` ignora JSON inválido com aviso. Listas de tipo errado são ignoradas. Teto de 64 MiB por arquivo de evidência, carteira ou auditoria | teste B-08; ao vivo, `zz-lixo.json` foi ignorado e o close concluiu |
| B-c | Baixa | settlement | `refund`/`slash` marcavam a primeira caução ativa (podia ser a errada) e a devolução não guardava a transação | `markBond(..., { txHash, refundTx })`: com mais de uma caução ativa, exige `--tx`; o `refundTx` é guardado e não pode se repetir | teste B-c |
| M-N1 | Média | piu-node | Gateway travável sem fundos: o balde de cargas era por CONEXÃO (`peerId#seq`), e reconectar renovava | `relay/carryAdmission.ts`: dois baldes, por identidade LNNP e por IP de origem (teto maior); reconectar e trocar de identidade no mesmo IP não renovam | `test/auditoria-final.test.ts` (M-N1). **Resíduo** abaixo |
| M-N2 | Média (a confirmar no aparelho) | OpenWrt | `chown -R` do root seguindo link simbólico plantado na pasta do serviço (escalada para root) | `chown -hR`; pasta de dados que é link simbólico faz o serviço não iniciar | `packaging/openwrt` (teste do link simbólico, sem `chown`) |
| B-N1 | Baixa | piu-node | O envio à caixa seguia redirecionamento (SSRF cego com corpo da malha), e a caixa aceitava host local | `redirect: 'error'` (`gatewayPost.ts`). `relay/inboxUrl.ts` recusa loopback, privado, link-local, CGNAT, `.local` e `localhost`, no painel e em `PIU_VALIDATOR_INBOX` (a expressão antiga deixava passar espaço) | teste com servidor 307: o segundo alvo recebe 0; ao vivo, `PUT` com `https://192.168.1.1/…` dá 400 |
| B-N2 | Baixa | piu-node | Sem backpressure no TCP do LNNP (vizinho que não lê enche o heap) | `writeFrame` fecha o enlace acima de 2 MiB pendentes. O enlace LAN declara `capacity` (o motor só entrega o que cabe; o resto sai na próxima rodada) | teste com socket que nunca lê |
| B-N4 | Baixa | piu-node | Co-operador podia reservar antes do dono a identidade técnica de um equipamento | O dono prevalece: o registro do co-operador perde `nodePk` e certificado | `security.test.ts` (B-N4) |
| — | Baixa | OpenWrt | `PIU_GATEWAY`, `PIU_VALIDATOR_INBOX`, `PIU_LORA_BEACON_MS`, `PIU_RELAY_SAMPLE_MS` e `PIU_RELAY_PERSIST_MS` não tinham opção UCI (o gateway só se desligava pelo painel) | Seção `gateway` e opções novas em `piu-node.config`/`.init`. O teste agora também lê as variáveis via `num('PIU_…')` | teste UCI |
| — | Info | provider-panel | O texto "validador ainda não ligado" era genérico | 11 idiomas: "ainda não está em operação (falta a Lunes publicar a chave dele)" | vitest 99/99 |

### Ficam abertos (com motivo)

| Id | Sev. | Por que não agora | Próximo passo |
|---|---|---|---|
| B-b | Baixa | Rotação não contém uma chave de operador vazada (o `issuedAt` é declarado por quem assina) | Guardar no estado do validador o "visto pela primeira vez" de cada certificado |
| B-01, B-04 | Baixa | Decisões de produto (código de pareamento também vale como step-up; 5 erros destroem o código) | Separar códigos de pareamento e de step-up |
| B-10 / I-N1 | Baixa | Co-operadores leem estatísticas, recibos e o gateway. Restringir pede ajuste das telas do painel | Decidir o que o co-operador vê |
| B-03 (provider) | Baixa | Chaves do nó e do operador em 0600, sem cifra em repouso (keychain); exige teste em aparelho | Selador no piu-node e migração do `keys.json` |
| M-02 (provider) | Média / E | Sem notarização nem Authenticode (decisão de 06/11: lançar sem certificados) | Conta Apple Developer e certificado Windows |
| npm audit (dev) | Info | `provider-desktop`: 6 moderadas só de build (minimatch via electron-builder), fora do app distribuído | Atualizar o electron-builder quando sair a correção |

### Corrigidos depois no app (conferido no código em 08/11/2026)

Os três estavam abertos aqui porque a raiz fica em arquivos do app que o piu-node copia. Já foram corrigidos na fonte, e as cópias acompanham (`sync-lunes`, `sync-protocol`).

| Id | Onde | Como ficou |
|---|---|---|
| M-N1 (raiz) | `apps/mobile/src/lib/carryGateway.ts` (`submit`) | Decodifica e deduplica pelo hash (de graça), depois `validate_transaction` (cota de validação), e só então gasta a cota de envio |
| B-N3 | `apps/mobile/src/lib/carryGateway.ts` | O acompanhamento lê cada bloco uma vez por rodada para todas as transações |
| H-1 (raiz) | `apps/mobile/src/protocol/bytes.ts` (`Writer`) | `u8`, `u16` e `u32` são estritos (`fixed`): valor fora da faixa lança erro |

## 3. Testes, typecheck e build (depois da sincronização com o `apps/mobile`)

| Pacote | Typecheck | Testes | Build |
|---|---|---|---|
| piu-node | ok | 120/120 (antes: 114, 2 falhando por cópia desatualizada do app) | ok |
| settlement | ok | 76/76 (antes: 62) | ok |
| provider-panel | ok | 99/99 | ok (aviso de chunk > 500 kB, conhecido) |
| provider-desktop | ok | 1/1 | ok (`node build.mjs`) |
| packaging/openwrt | — | 17/17 (antes: 16, 2 falhando) | `.ipk` reprodutível gerado no teste |

**Teste do OpenWrt dependente do fuso horário:** corrigido.
- Antes, a data vinha da listagem do `tar` ("Dec 31 2025" no bsdtar em UTC−3).
- Agora os cabeçalhos ustar são lidos direto dos bytes (uid, gid, mtime em octal).
- Passa em `TZ=UTC`, `America/Sao_Paulo` e `Pacific/Kiritimati`.

**Sincronização com o app:**
- `npx tsc --noEmit` passou no `apps/mobile`. Depois disso rodaram `sync-lunes`, `sync-protocol` (piu-node) e `sync-protocol` (settlement).
- O `pt-BR.ts` do app passou a importar `./piu11/pt-BR` e `./pontos/pt-BR`. Por isso o `scripts/sync-lunes.mjs` agora copia também essas subpastas e põe `.js` nos imports com `/`.

## 4. Bloqueios externos que continuam

- **Chave do validador:** publicar `VALIDATOR_PROOF_PK` no app e a caixa (`VALIDATOR_INBOX_URL` / `PIU_VALIDATOR_INBOX`). Sem isso, a prova v2 não é gerada e nada é pago.
- **Endereço da caução** dos celulares (`config.json` → `phone.bondAddress`). Sem ele, nenhum celular é habilitado.
- **Chave GPG de release** (`docs/distribuicao/piu-release.fpr`). Sem ela, o `scripts/sign-release.sh` não roda.
- **Certificados Apple e Windows:** lançamento decidido sem eles.
- **Custódia da conta pagadora** e uma liquidação real mínima. Antes, rodar `mainnet:check` com rede até a Lunes; aqui, `*.lunes.io` não foi acessado.
- **Teste em aparelho:**
  - roteador OpenWrt (inclui confirmar o `chown -h` do busybox);
  - app Electron aberto (o fluxo do cookie foi coberto por teste do piu-node e por typecheck);
  - celular como gateway.
- **Correções no `apps/mobile`** (outra frente): `carryGateway.ts` (M-N1 raiz, B-N3) e `protocol/bytes.ts` (`u32` estrito).

## 5. Correção M-N1/B-N3/u32 (no `apps/mobile`, 06/11)

Fecha os três itens de "Ficam abertos" que dependiam do app. Fonte: `apps/mobile`; cópias regeneradas com `sync-lunes` e `sync-protocol` (piu-node) e `sync-protocol` (settlement).

| Id | Correção | Teste |
|---|---|---|
| M-N1 (raiz) | `lib/carryGateway.ts`: a ordem passou a ser decodificar → deduplicar pelo hash → `validate_transaction` (cota nova `validationsPerMinute`, 60/min) → só então a cota de envio (`submitsPerMinute`, 20/min). Recusada pela Lunes não gasta a cota de envio. Sem cota de envio, a transação válida espera a próxima janela sem contar tentativa falha; na fila, nem é revalidada enquanto não houver cota. Idempotência mantida (repetida não gasta consulta nem cota). | `carryGateway.test.ts`: 2 testes M-N1 (5 recusadas + 3 boas com cota 2 → `submitted, submitted, queued`; teto de validação e cópias com 1 `state_call`) |
| B-N3 | Na rodada, hash de bloco por número e conteúdo por hash ficam em cache e servem a todas as transações acompanhadas (inclusive a conferência de bloco canônico). Teto novo `blockReadsPerTick` (100 leituras/rodada); o que passar continua na rodada seguinte. | `carryGateway.test.ts`: 2 testes B-N3 (5 transações × 3 blocos: 3 leituras em vez de 15; teto por rodada) |
| H-1 (raiz) | `protocol/bytes.ts`: `Writer.u8/u16/u32` lançam `ProtocolError('OUT_OF_RANGE')` fora da faixa, com não inteiro, NaN ou infinito (antes: `& 0xff`, truncamento do `setUint16` e `>>> 0`). | `protocol/__tests__/bytes.test.ts` (5 testes) |

Resultado: mobile `tsc` ok e 599/599; piu-node typecheck ok e 120/120; settlement typecheck ok e 76/76; desktop typecheck ok e 192/192.
