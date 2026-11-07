# Auditoria AppSec — `apps/piu-node` e `apps/settlement`

- Data: 2026-11-06 · Modo: somente leitura (nenhum arquivo do repositório foi alterado)
- Escopo: `apps/piu-node/src/**` (API Fastify, LNNP/LAN, assinatura Lunes, cofre de operador) e `apps/settlement/src/**` (validador de contribuições e liquidante)
- Base: OWASP Top 10 2021, OWASP API Security Top 10 2023, revisão manual + `npm audit --omit=dev`
- Ressalva: a análise é estática. Os cenários de exploração foram derivados do código; nenhum foi executado contra a Mainnet ou um nó em produção.

## Resumo

| Severidade | Qtde |
|---|---|
| Crítica | 1 |
| Alta | 2 |
| Média | 5 |
| Baixa | 11 |
| Info | 4 |

**Nota proposta para o escopo: 58/100.**
A camada HTTP do piu-node é muito boa (eu daria uns 85 a ela sozinha). A nota cai por causa do desenho econômico do validador (C-01, A-01), que permite cunhar recompensas sem retransmitir nada, e da superfície LNNP/UDP sem autenticação, que permite DoS remoto (A-02, M-04).

`npm audit --omit=dev`: **0 vulnerabilidades** (nenhuma low, moderate, high ou critical) em `piu-node` e em `settlement`.

---

## Achados

### C-01 — Provas de entrega e recibos podem ser forjados à vontade: o orçamento de recompensas é drenável (Sybil e auto-atestado)
- **Severidade:** Crítica
- **OWASP:** A04:2021 Insecure Design · A08:2021 Software and Data Integrity Failures · API6:2023 (fluxos de negócio sensíveis sem proteção)
- **Local:** `apps/settlement/src/validator.ts:99-112` (`buildLedger`), `apps/settlement/src/protocol/receipts.ts:90-118` (`submit`, `confirmDelivery`), `apps/settlement/src/validator-cli.ts:39`
- **Evidência:**
  ```ts
  // validator.ts:101-102 — o ackHash é calculado a partir do PRÓPRIO segredo enviado
  for (const p of e.proofs ?? []) {
    try { const secret = fromHex(p.ackSecret); ledger.confirmDelivery(p.envelopeId, secret, hash(secret).slice(0, 16)); } catch {}
  }
  // receipts.ts:111-113 — sempre confere, porque o ackHash veio do próprio segredo
  confirmDelivery(envelopeId, ackSecret, ackHash) { if (!equal(hash(ackSecret).slice(0, 16), ackHash)) return false; this.delivered.set(envelopeId, ackHash); ...
  ```
  O próprio `scripts/demo-dados.ts:12-18` mostra o problema. Ele gera `envelopeId` e `secret` aleatórios com chaves de nó novas, e o resultado é aceito como "entrega comprovada".
- **Problema:** nada liga o `envelopeId`, nem o `ackHash`, a um envelope que tenha existido. Quem assina o recibo escolhe o `ackHash`, e quem "prova" a entrega é qualquer um que conheça o segredo. Uma chave de nó Ed25519 não custa nada (`deriveNodeKey(newSeed())`), e o validador lê evidências de "nós e gateways" (`dados/evidencias/*.json`), ou seja, de fontes não confiáveis. Os tetos de 2% do orçamento por nó por época e de 5000 por nó por dia são contornados com N chaves.
- **Cenário de exploração:** o atacante gera 50 chaves de nó. Para cada uma, escreve 5000 recibos/dia com `envelopeId` aleatório e `ackHash = H(s)[:16]`, mais as provas `{envelopeId, ackSecret: s}`. Depois gera 50 `PayoutClaim` assinados para a época e entrega os arquivos. Com 50 × 2% = 100%, o atacante leva o orçamento `B` inteiro de cada época, e a rede legítima fica diluída a quase zero. Não é preciso ter tráfego real.
- **Correção proposta** (exige decisão de protocolo; abaixo, o mínimo verificável no validador):
  1. Só creditar nós registrados: lista de `nodePk` com certificado de operador válido (`OPERATOR_CERT`) e, de preferência, stake ou registro on-chain.
  2. A prova de entrega tem de ser assinada pelo destino, e o `ackHash` tem de estar comprometido no cabeçalho do envelope assinado pelo remetente. O validador confere essas duas assinaturas, e não só `H(segredo)`.
  3. Auditoria por amostragem obrigatória antes de pagar (hoje `auditorias/` é opcional).

  ANTES (`validator.ts`):
  ```ts
  for (const r of receipts) ledger.submit(r, now);
  ```
  DEPOIS (passo 1, lista de nós registrados):
  ```ts
  export function buildLedger(evidence: EvidenceFile[], audits: AuditFile[], now: number, policy: Partial<LedgerPolicy> = {},
                              registered?: ReadonlySet<string> /* nodePk hex com cert de operador/stake válido */): ContributionLedger {
    ...
    for (const r of receipts) {
      if (registered && !registered.has(toHex(r.nodePk))) continue; // nó desconhecido não gera crédito
      ledger.submit(r, now);
    }
  ```
  e em `validator-cli.ts` exigir `dados/nos-registrados.json`, abortando o `close` sem ele.
  DEPOIS (passo 2, prova assinada pelo destino; esboço da forma):
  ```ts
  interface DeliveryProof { envelopeId: string; ackSecret: string; envelopeHeader: string /* hex, assinado pelo remetente, contém ackHash */; }
  // validar: verify(header.sig, header, header.senderPk) && header.id === envelopeId && H(ackSecret)[:16] === header.ackHash
  ```
- **Muda comportamento/protocolo?** **Sim.** Muda o formato das evidências (`EvidenceFile`) e o processo de admissão de nós. Nós sem registro deixam de receber.

---

### A-01 — Roubo e negação de crédito de terceiros: a última prova sobrescreve, e as 8 vagas por envelope vão para quem declara o `at` mais cedo
- **Severidade:** Alta
- **OWASP:** A04:2021 Insecure Design · API6:2023
- **Local:** `apps/settlement/src/protocol/receipts.ts:97-98,111-116`; `apps/settlement/src/validator.ts:101-110`; ordem dos arquivos em `validator-cli.ts:24` (`.sort()` por nome)
- **Evidência:**
  ```ts
  this.delivered.set(envelopeId, ackHash);              // a última prova vence (sobrescreve)
  if (relays > this.policy.maxRelaysPerEnvelope) return this.reject(key, r, 'recibos demais para o mesmo envelope');
  receipts.sort((a, b) => a.at - b.at || ...);           // `at` é escolhido por quem assina
  ```
- **Cenários:**
  - Negação: um relay que viu o envelope X (e portanto sabe o `envelopeId`) envia uma prova `{X, segredo_aleatório}` num arquivo `zzz.json`. Ela sobrescreve a prova verdadeira, e todos os recibos legítimos de X viram `rejeitado` ("prova não confere").
  - Roubo: o atacante assina 8 recibos de X com 8 chaves Sybil, usando o `ackHash` real (visível no cabeçalho para qualquer relay) e `at = início da época`. Como a ordenação é por `at`, os 8 entram primeiro, e os relays legítimos são rejeitados por "recibos demais". O atacante fica com 100% da unidade de X.
- **Correção:**
  ANTES:
  ```ts
  confirmDelivery(envelopeId: string, ackSecret: Uint8Array, ackHash: Uint8Array): boolean {
    if (!equal(hash(ackSecret).slice(0, 16), ackHash)) return false;
    this.delivered.set(envelopeId, ackHash);
  ```
  DEPOIS (prova conflitante invalida o envelope em vez de sobrescrever; a prova só vale se bater com o `ackHash` da maioria dos recibos ou do cabeçalho assinado, ver C-01):
  ```ts
  private conflicted = new Set<string>();
  confirmDelivery(envelopeId: string, ackSecret: Uint8Array, ackHash: Uint8Array): boolean {
    if (!equal(hash(ackSecret).slice(0, 16), ackHash)) return false;
    const prev = this.delivered.get(envelopeId);
    if (prev && !equal(prev, ackHash)) { this.conflicted.add(envelopeId); return false; } // conflito: ninguém ganha, auditar
    this.delivered.set(envelopeId, ackHash);
    ...
  }
  ```
  E, para as vagas, em vez de "os 8 primeiros por `at`": se um envelope tiver mais de `maxRelaysPerEnvelope` recibos válidos, ele é suspeito e **nenhum** recibo dele é creditado. Os recibos vão para auditoria.
  ```ts
  // closeEpoch: depois de agrupar relaysOf
  for (const [id, nodes] of relaysOf) if (nodes.length > P.ledger?.maxRelaysPerEnvelope ?? 8) relaysOf.delete(id);
  // e em submit(): não rejeitar por excesso; só contar (perEnvelope) e decidir no fechamento.
  ```
- **Muda comportamento/protocolo?** **Sim, no econômico.** Envelopes com recibos demais ou provas conflitantes deixam de pagar. O formato do fio não muda.

---

### A-02 — Anúncio UDP sem autenticação faz o nó discar para qualquer `IP:porta`, sem teto: esgota descritores e transforma o nó em refletor de SYN
- **Severidade:** Alta (DoS remoto sem autenticação; precisa alcançar a UDP 8423, que escuta em `0.0.0.0` por padrão)
- **OWASP:** API4:2023 Unrestricted Resource Consumption · A04:2021 · (SSRF-lite: A10:2021)
- **Local:** `apps/piu-node/src/relay/lan.ts:269-277` (`onBeacon`), `:281-301` (`dial`), `config.ts:80-82`
- **Evidência:**
  ```ts
  private onBeacon(msg: Buffer, address: string) {
    const b = decodeBeacon(new Uint8Array(msg));
    ...
    this.dial(`${address}:${b.port}`);   // porta vem do pacote; nenhum limite de discagens simultâneas
  }
  private dial(target: string) {
    if (this.stopped || this.outbound.has(target)) return;   // só deduplica por alvo idêntico
    const sock = connect({ host, port });                    // timeout de 5 s
  ```
- **Cenário:** um pacote de 18 bytes por alvo, com `tag` aleatória (menor que a do nó) e porta variando de 1 a 65535. A 10 mil pacotes/s, o nó abre cerca de 50 mil sockets em 5 s. Isso esgota os descritores do processo (`EMFILE`): o painel HTTPS para de aceitar conexões, as gravações de estado falham e o enlace LNNP para. Com IP de origem forjado (trivial na LAN), o nó dispara SYNs contra qualquer host e porta escolhidos, funcionando como varredura ou refletor.
- **Correção:**
  ANTES:
  ```ts
  if (this.engine.hasPeerTag(b.tag)) return;
  this.dial(`${address}:${b.port}`);
  ```
  DEPOIS:
  ```ts
  private beaconDials = new Map<string, number>(); // ip → último dial (ms)
  private static MAX_DISCOVERY_DIALS = 8;
  ...
  if (this.engine.hasPeerTag(b.tag)) return;
  const nowMs = Date.now();
  if ((this.beaconDials.get(address) ?? 0) > nowMs - this.o.beaconMs) return;           // 1 dial por IP por período
  const discoveryOutbound = [...this.outbound.keys()].filter(k => !this.hasPeerAddress(k)).length;
  if (discoveryOutbound >= LanAdapter.MAX_DISCOVERY_DIALS) return;                     // teto global
  if (this.engine.linkCount >= (this.o.maxLinks ?? 64)) return;
  this.beaconDials.set(address, nowMs);
  if (this.beaconDials.size > 1024) this.beaconDials.delete(this.beaconDials.keys().next().value!);
  this.dial(`${address}:${b.port}`);
  ```
  Opcionalmente, aceitar só `b.port` igual à porta LNNP padrão ou à faixa configurada, e só endereços de origem em faixas privadas (`10/8`, `172.16/12`, `192.168/16`, `fe80::/10`).
- **Muda comportamento/protocolo?** **Não.** O formato do anúncio é o mesmo. A descoberta fica só um pouco mais lenta com muitos vizinhos novos ao mesmo tempo.

---

### M-01 — Vizinhos LNNP podem empurrar recibos ao `receiptLog` (FIFO de 1000) e expulsar os recibos do próprio nó, que são a evidência de pagamento
- **Severidade:** Média (perda econômica para o operador)
- **OWASP:** A04:2021 · API4:2023
- **Local:** `apps/piu-node/src/relay/engine.ts:331-335,426-430` (`RECEIPT_LOG = 1000` em `:119`); exportação em `app.ts:549-557`
- **Evidência:**
  ```ts
  case FrameType.RelayReceipt: { const rc = decodeReceipt(f.body); if (verifyRelayReceipt(rc)) { ...; this.keepReceipt(rc); } }
  private keepReceipt(r) { this.receiptLog.push(r); if (this.receiptLog.length > RECEIPT_LOG) this.receiptLog.splice(0, ...); }
  ```
  `verifyRelayReceipt` só confere a assinatura de quem diz ter assinado. Qualquer nó (com `PIU_LNNP_ALLOW` vazio, que é o padrão) assina quantos recibos quiser.
- **Cenário:** um vizinho manda 1000 recibos autoassinados. Os recibos próprios do nó saem do log e somem da exportação `/api/relay/evidence`, e o operador perde o crédito da semana. Mesmo sem atacante, um nó ocupado que retransmite mais de 1000 envelopes entre duas exportações perde evidência.
- **Correção:**
  ANTES:
  ```ts
  if (verifyRelayReceipt(rc)) { this.counters.receiptsReceived++; this.keepReceipt(rc); }
  ```
  DEPOIS (separar os próprios dos de terceiros; teto só para os de terceiros, e por vizinho):
  ```ts
  private ownReceipts: RelayReceipt[] = [];       // persistidos; teto alto (ex.: 50k) e exportados por época
  private foreignReceipts: RelayReceipt[] = [];   // FIFO 1000, nunca expulsa os próprios
  private keepReceipt(r: RelayReceipt) {
    const own = samePk(r.nodePk, this.node.pk);
    const list = own ? this.ownReceipts : this.foreignReceipts;
    list.push(r);
    const cap = own ? OWN_RECEIPT_LOG : RECEIPT_LOG;
    if (list.length > cap) list.splice(0, list.length - cap);
  }
  get receiptLog() { return [...this.ownReceipts, ...this.foreignReceipts]; }
  ```
  e limitar `RelayReceipt` recebidos por enlace (ex.: 100/min).
- **Muda comportamento/protocolo?** **Não** no fio. A exportação fica maior, porque passa a guardar mais recibos próprios.

---

### M-02 — `state.json` sem `fsync` e reset silencioso quando corrompe: dono perdido e acompanhamento de transferências na Mainnet apagado (risco de pagamento duplo)
- **Severidade:** Média
- **OWASP:** A08:2021 Software and Data Integrity Failures · A04:2021
- **Local:** `apps/piu-node/src/store.ts:106` e `:113-118`
- **Evidência:**
  ```ts
  try { this.s = { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) }; } catch { this.s = empty(); }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 }); renameSync(tmp, this.file); }
  ```
  O `save()` não faz `fsync` (ao contrário de `writeFileAtomic` em `fsutil.ts`, usado pelo cofre e pelas mensagens). Em roteador ou SBC com cartão SD, uma queda de energia pode deixar o arquivo vazio. Na subida seguinte, o estado inteiro volta a vazio sem aviso, e o próximo `save()` sobrescreve o arquivo corrompido.
- **Cenário:**
  1. Depois da queda, `operators` fica vazio. **Quem parear primeiro vira o dono** (`owner() = operators[0]`) e passa a decidir a carteira do lote.
  2. `lunesTransfers` some. Um pedido em `signed`/`submitted` deixa de ser acompanhado, a UI deixa de mostrar "não refaça o pagamento", e o operador refaz. O novo pedido lê `accountNextIndex` (N+1), e os dois entram: pagamento duplo. Isso anula as proteções cuidadosas de `signing.ts:336-345`.
- **Correção:**
  ANTES:
  ```ts
  try { this.s = { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) }; } catch { this.s = empty(); }
  ...
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 }); renameSync(tmp, this.file); }
  ```
  DEPOIS:
  ```ts
  import { writeFileAtomic } from './fsutil.js';
  ...
  if (existsSync(this.file)) {
    try { this.s = { ...empty(), ...JSON.parse(readFileSync(this.file, 'utf8')) }; }
    catch {
      const aside = `${this.file}.corrompido-${Date.now()}`;
      renameSync(this.file, aside);   // nunca sobrescrever: pode ser a única cópia
      throw new Error(`state.json ilegível; guardado em ${aside}. Restaure o backup antes de subir o nó.`);
    }
  } else this.s = empty();
  ...
  private save() { if (this.file) writeFileAtomic(this.file, JSON.stringify(this.s)); }
  ```
- **Muda comportamento/protocolo?** **Sim, pouco.** Com o arquivo corrompido, o nó para de subir em vez de começar vazio. O protocolo não muda.

---

### M-03 — Código de pareamento vai para o stdout, que vira log persistente no journald/logread; usuário local sem privilégio assume o dono
- **Severidade:** Média (requer acesso local, mas leva ao controle total, inclusive da carteira do lote)
- **OWASP:** A09:2021 Security Logging and Monitoring Failures · A07:2021
- **Local:** `apps/piu-node/src/main.ts:8-9,25,45`; vínculo por nome em `app.ts:236` e `store.ts:124`
- **Evidência:**
  ```ts
  /** O código só aparece aqui, no console/tela do próprio equipamento. Nunca vai para a rede nem para o log. */
  const show = (reason, code) => process.stdout.write(`... Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)} ...`);
  ```
  Sob systemd, o stdout vai para o journald, que membros de `adm`/`systemd-journal` leem e que guarda histórico. Sob procd (OpenWrt), vai para o `logread`, que qualquer shell no roteador lê. O comentário diz o contrário do que acontece nessas implantações.
- **Cenário:** um usuário local ou um processo comprometido lê `journalctl -u piu-node` e pega o código vigente (10 min). Em `POST /api/pair`, informa o **nome do dono**. Como `operatorByName` não diferencia maiúsculas, recebe uma sessão do dono. Com o código seguinte, também logado (`onCode`), faz o step-up e troca a carteira do lote (`/api/payout-claims`) e o endereço Lunes.
- **Correção:**
  ANTES:
  ```ts
  const show = (reason: string, code: string) =>
    process.stdout.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`);
  ```
  DEPOIS (só mostra em TTY; fora dele, grava num arquivo 0600 que o dono lê com `sudo`):
  ```ts
  import { writeFileAtomic } from './fsutil.js';
  const show = (reason: string, code: string) => {
    if (process.stdout.isTTY) { process.stdout.write(`\n  ${reason}\n  Código de pareamento: ${code.slice(0, 4)} ${code.slice(4)}  (vale 10 min, uso único)\n\n`); return; }
    writeFileAtomic(join(config.dataDir, 'pairing-code'), `${code}\n`);   // 0600, pasta 0700
    process.stdout.write(`\n  ${reason}\n  Código em ${join(config.dataDir, 'pairing-code')} (leia como o usuário do serviço).\n\n`);
  };
  ```
- **Muda comportamento/protocolo?** **Sim, operacional.** Em serviço sem TTY, o operador lê o código num arquivo e não no log. A API não muda.

---

### M-04 — Esgotamento de vagas do LNNP: 16 handshakes pendentes compartilhados (entrada e saída) e 64 enlaces ocupáveis por identidades Sybil
- **Severidade:** Média (DoS da malha; sem autenticação com `PIU_LNNP_ALLOW` vazio, que é o padrão)
- **OWASP:** API4:2023 · A04:2021
- **Local:** `apps/piu-node/src/relay/lan.ts:161,308-309,343`; `relay/engine.ts:250-253` (`authorize` devolve `true` sem allowlist)
- **Evidência:**
  ```ts
  if (this.pending >= (this.o.maxPending ?? 16)) { writeFrame(sock, errorFrame(LnnpErrorCode.Busy, 'Ocupado.')); sock.end(); return; }
  if (this.engine.linkCount >= (this.o.maxLinks ?? 64)) { ...; sock.end(); return; }
  ```
  `handle()` é usado tanto para conexões que entram quanto para as que o nó abre (`dial` chama `handle(sock, false, …)`).
- **Cenário:**
  1. Slowloris: 16 conexões que mandam meio HELLO e reconectam a cada 5 s. O contador `pending` fica cheio, e o nó não completa nenhum handshake, **nem os que ele mesmo iniciou** para os vizinhos fixos.
  2. Sybil: 64 chaves novas completam o handshake e ocupam todos os enlaces. Vizinhos legítimos recebem `0x7e` e são fechados.
- **Correção:**
  ANTES:
  ```ts
  if (this.pending >= (this.o.maxPending ?? 16)) { ... }
  this.pending++;
  ```
  DEPOIS (vagas separadas, teto por IP e reserva para vizinhos fixos e do mesmo operador):
  ```ts
  private pendingIn = 0; private pendingOut = 0; private perIp = new Map<string, number>();
  ...
  const ip = sock.remoteAddress ?? '';
  if (inbound) {
    if (this.pendingIn >= (this.o.maxPending ?? 16) || (this.perIp.get(ip) ?? 0) >= 2) { writeFrame(sock, errorFrame(LnnpErrorCode.Busy, 'Ocupado.')); sock.end(); return; }
    this.pendingIn++; this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
  } else this.pendingOut++;
  ```
  e, nos enlaces, reservar uma parte (ex.: 16 de 64) para `hasPeerAddress(address)` e para pares com `sameOperator`. Ao chegar no teto, expulsar o enlace anônimo mais novo em vez de recusar o vizinho fixo.
- **Muda comportamento/protocolo?** **Não.** O fio é o mesmo. Muda só a política de admissão local.

---

### M-05 — `lot:pay` aceita qualquer JSON; a proteção contra pagamento duplo é só pelo `id` do lote
- **Severidade:** Média (financeira; depende de erro do operador ou de escrita em `dados/lotes`)
- **OWASP:** A08:2021 · A04:2021
- **Local:** `apps/settlement/src/settler.ts:41-43`; `apps/settlement/src/cli.ts:54-56,72`; `journal.ts:24`
- **Evidência:**
  ```ts
  let e = journal.get(lot.id);
  if (e && e.digest !== lot.digest) throw ...;   // mesmo id + outro conteúdo: recusa
  // mas: OUTRO id + MESMO conteúdo → diário vazio → paga de novo
  ```
  Não há vínculo entre o lote e o `validador.json` (estado `em-lote`), nem assinatura do validador, nem teto de total.
- **Cenário:** o operador renomeia `piu-lote-2026-S44.json` para `...-S44b` ao reprocessar, ou um arquivo é alterado em `dados/lotes/`. `--confirm` só pede que o id seja repetido, e o lote é pago de novo, ou pago com outras carteiras.
- **Correção:**
  ANTES:
  ```ts
  let e = journal.get(lot.id);
  if (e && e.digest !== lot.digest) throw new SettlementError(`O lote ${lot.id} já existe no diário com outros pagamentos. Use outro id.`);
  ```
  DEPOIS:
  ```ts
  let e = journal.get(lot.id);
  if (e && e.digest !== lot.digest) throw new SettlementError(`O lote ${lot.id} já existe no diário com outros pagamentos. Use outro id.`);
  const same = journal.byDigest(lot.digest);           // índice digest → lote (varre o diretório)
  if (same && same.lot !== lot.id && same.state !== 'falhou') throw new SettlementError(`Estes pagamentos já estão no lote ${same.lot} (${same.state}).`);
  if (o.maxTotal !== undefined && lot.total > o.maxTotal) throw new SettlementError('Total acima do teto configurado (PIU_SETTLEMENT_MAX_TOTAL).');
  ```
  Além disso, `validator:close` deve assinar o lote (HMAC ou Ed25519 do validador sobre `digest`), e `lot:pay` deve conferir essa assinatura.
- **Muda comportamento/protocolo?** **Sim, operacional.** Lotes repetidos com outro id são recusados. O formato on-chain (remark) não muda.

---

### B-01 — Quem tem um código de pareamento vira qualquer operador, inclusive o dono, só pelo nome
- **Severidade:** Baixa (é o modelo de confiança escolhido: "o código prova acesso físico"; aqui fica registrado o risco)
- **OWASP:** A07:2021 Identification and Authentication Failures
- **Local:** `apps/piu-node/src/app.ts:234-236`, `store.ts:124`
- **Evidência:** `const op = store.operatorByName(req.body.name) ?? store.addOperator(...)`
- **Cenário:** um co-operador legítimo (não dono), com um código novo, pareia como "Lucas" e vira dono.
- **Correção:**
  ANTES: `const op = store.operatorByName(req.body.name) ?? store.addOperator(req.body.name.trim(), now());`
  DEPOIS:
  ```ts
  const existing = store.operatorByName(req.body.name);
  // Entrar numa conta que já existe exige uma sessão viva dela (outro navegador) OU confirmação do dono no painel.
  if (existing && store.isOwner(existing.id) && store.sessionsOf(existing.id).length > 0 && !req.body.confirmOwner) {
    return fail(reply, 409, 'Já existe uma sessão do dono. Confirme este acesso num navegador já pareado.');
  }
  const op = existing ?? store.addOperator(req.body.name.trim(), now());
  ```
  Alternativa mais simples: avisar todas as sessões do operador quando uma nova sessão entra pelo nome (notificação em `/api/sessions`).
- **Muda comportamento?** **Sim.** O fluxo de "voltar à mesma conta" ganha uma confirmação.

### B-02 — `restore` aceita scrypt com N = 2^20 (cerca de 1 GiB de RAM por chamada)
- **Severidade:** Baixa (precisa de sessão com step-up; 5 por 10 min)
- **OWASP:** API4:2023
- **Local:** `apps/piu-node/src/operator.ts:46,68,207`
- **Evidência:** `MAX_N = 1 << 20` e `maxmem: 2 ** 31`. Com 128·N·r e r = 8, dá 1 GiB. Num roteador com 256 MiB, o processo morre por falta de memória.
- **Correção:** ANTES `const DEFAULT_N = 1 << 16, MIN_N = 1 << 14, MAX_N = 1 << 20;` → DEPOIS `const DEFAULT_N = 1 << 16, MIN_N = 1 << 14, MAX_N = 1 << 17; // 128 MiB no máximo` e `maxmem: 256 * 1024 * 1024`.
- **Muda compatibilidade?** **Sim, só se** algum backup tiver sido gerado com N > 2^17 (o app gera 2^16, então na prática não).

### B-03 — Mapas que crescem sem limite com identidades LNNP novas e enchimento do armazenamento por Sybil
- **Severidade:** Baixa
- **OWASP:** API4:2023
- **Local:** `relay/engine.ts:166,295,308` (`lastSeen`); `protocol/router.ts:129` (um balde por peer: cada chave nova ganha `peerBurst = 120`)
- **Cenário:** milhões de handshakes com chaves novas fazem `lastSeen` crescer sem fim. N identidades × 120 envelopes enchem `maxCount = 20000` e o envelope legítimo recebe `full`.
- **Correção:** ANTES `this.lastSeen.set(l.session.peerId, this.now());` → DEPOIS
  ```ts
  this.lastSeen.delete(l.session.peerId); this.lastSeen.set(l.session.peerId, this.now());
  while (this.lastSeen.size > 4096) this.lastSeen.delete(this.lastSeen.keys().next().value!);
  ```
  No roteador, adicionar uma cota de armazenamento por `from` (ex.: 5% de `maxBytes`).
- **Muda comportamento?** **Não.**

### B-04 — DoS do pareamento: 5 erros de qualquer origem destroem o código, com 60 s de espera
- **Severidade:** Baixa
- **OWASP:** API4:2023 · A07:2021
- **Local:** `security/pairing.ts:35-36`; `server.ts:115`; o limite por IP (`app.ts:226`) é contornável com vários IPs na LAN
- **Cenário:** um atacante na LAN manda 5 códigos errados a cada 60 s, e o dono nunca consegue parear nem fazer step-up.
- **Correção:** manter o descarte (é bom contra força bruta), mas contar falhas por IP e só destruir o código no caso global depois de, por exemplo, 20 falhas em IPs distintos. Mostrar no console de onde vieram as tentativas.
  ANTES: `if (this.cur.failures >= MAX_FAILURES) { this.cur = null; return 'locked'; }`
  DEPOIS: `verify(input, now, ip)` com `perIp` (5 → 429 só para aquele IP) e `failures >= 20` → `locked`. Com 10^8 combinações, o risco continua desprezível.
- **Muda comportamento?** **Sim, pouco** (o limiar de bloqueio muda).

### B-05 — Cada requisição autenticada regrava `state.json` inteiro (`touchSession`)
- **Severidade:** Baixa (desgaste de flash e latência; 300 req/min por IP)
- **OWASP:** API4:2023
- **Local:** `store.ts:136`
- **Correção:** ANTES `touchSession(hash, now) { ...; x.lastSeen = now; this.save(); }` → DEPOIS `if (now - x.lastSeen > 60_000) { x.lastSeen = now; this.save(); } else x.lastSeen = now;` (grava no máximo uma vez por minuto por sessão).
- **Muda comportamento?** **Não** (a inatividade é de 30 min; a perda é de até 60 s após uma queda).

### B-06 — Liquidante não fixa o hash de gênese e confia no nó RPC para "finalizado"
- **Severidade:** Baixa
- **OWASP:** A08:2021 · A05:2021
- **Local:** `settlement/src/chain.ts:63-69`, `cli.ts:22` (`--ws` e `PIU_SETTLEMENT_WS` aceitam qualquer endpoint)
- **Cenário:** um `--ws` apontado para uma rede de teste com `specName` igual. O lote é "finalizado" nela, `validator:paid` marca como pago, e ninguém recebe na Mainnet.
- **Correção:** ANTES `if (info.specName !== EXPECTED.specName) p.push(...)` → DEPOIS acrescentar `genesisHash: '0x…'` (o da Mainnet) em `EXPECTED` e `if (info.genesisHash !== EXPECTED.genesisHash) p.push('gênese diferente da Lunes Mainnet');`. Recusar `ws://` fora de `localhost`.
- **Muda comportamento?** **Não** na Mainnet. Redes de teste passam a precisar de uma flag explícita.

### B-07 — `PIU_SETTLEMENT_SEED` em texto claro é aceito também na Mainnet; permissão do keystore não é conferida
- **Severidade:** Baixa
- **OWASP:** A02:2021 Cryptographic Failures · A05:2021
- **Local:** `settlement/src/signer.ts:19-24`
- **Correção:**
  ```ts
  // ANTES
  if (env.PIU_SETTLEMENT_SEED) return keyring.addFromUri(env.PIU_SETTLEMENT_SEED.trim());
  // DEPOIS
  if (env.PIU_SETTLEMENT_SEED) {
    if (env.PIU_SETTLEMENT_ALLOW_SEED !== 'dev') throw new Error('PIU_SETTLEMENT_SEED só em rede de desenvolvimento (PIU_SETTLEMENT_ALLOW_SEED=dev).');
    return keyring.addFromUri(env.PIU_SETTLEMENT_SEED.trim());
  }
  ```
  e conferir `(statSync(env.PIU_SETTLEMENT_KEYSTORE).mode & 0o077) === 0`. Também vale cruzar o `genesisHash` (B-06) antes de aceitar a seed.
- **Muda comportamento?** **Sim, operacional** (é preciso uma flag para usar a seed).

### B-08 — Entradas do validador sem validação de esquema: um arquivo malformado aborta o `close` ou causa confusão de tipos
- **Severidade:** Baixa
- **OWASP:** A03:2021 (validação de entrada) · A08:2021
- **Local:** `settlement/src/validator-cli.ts:21-25`; `validator.ts:101-111`
- **Evidência:** `JSON.parse(...) as T` sem conferência. `proofs: 5` dá `TypeError` fora do try e aborta. `at: 1e12` não é um u32 válido, e o resultado depende do `Writer`.
- **Correção:** validar cada arquivo antes de usar e pular os inválidos, registrando quais foram:
  ```ts
  const isEvidence = (x: any): x is EvidenceFile => x?.v === 1 && (x.receipts === undefined || Array.isArray(x.receipts)) && (x.proofs === undefined || Array.isArray(x.proofs))
    && (x.receipts ?? []).every((r: any) => typeof r.envelopeId === 'string' && /^[0-9a-f]{32}$/.test(r.envelopeId) && Number.isInteger(r.at) && r.at >= 0 && r.at <= 0xffffffff);
  ```
- **Muda comportamento?** **Não** para arquivos válidos.

### B-09 — `release:keygen` grava a chave privada de release dentro do repositório por padrão, e o `.gitignore` não cobre `*.pem` nem `.env`
- **Severidade:** Baixa
- **OWASP:** A05:2021 · A02:2021
- **Local:** `apps/piu-node/scripts/release.ts:15-18` (`dir = args[0] ?? 'release-keys'`, relativo a `apps/piu-node`); `.gitignore` da raiz (só `node_modules/ dist/ *.tsbuildinfo *.local .DS_Store`)
- **Correção:** ANTES `const dir = args[0] ?? 'release-keys';` → DEPOIS `const dir = args[0]; if (!dir) { console.error('informe uma pasta FORA do repositório'); process.exit(2); }`, e acrescentar ao `.gitignore`: `*.pem`, `.env*`, `release-keys/`, `data/`, `dados/`, `diario/`.
- **Muda comportamento?** **Não.**

### B-10 — Co-operadores (não donos) leem dados do nó: estatísticas do relay, recibos, vizinhos, declarações de carteira e pacotes
- **Severidade:** Baixa (exposição de propriedade/objeto: API3:2023)
- **Local:** `app.ts:309-317,564` (`/api/relay*`, `/api/relay/peers`, `/api/payout-claims` só com `authed()`)
- **Evidência:** `/api/payout-claims` devolve `address` da carteira do lote do dono para qualquer operador pareado.
- **Correção:** ANTES `app.get('/api/payout-claims', authed(), async () => claimView());` → DEPOIS `app.get('/api/payout-claims', authed(), async (req, reply) => store.isOwner(req.piuSession!.operatorId) ? claimView() : fail(reply, 403, 'Só o dono.'));` (o mesmo vale para `/api/relay/peers`, que expõe IPs dos vizinhos).
- **Muda comportamento?** **Sim**, para co-operadores (as telas deles perdem esses dados).

### B-11 — Carteira interna (legado) com valores em ponto flutuante
- **Severidade:** Baixa (integridade de saldo exibido; não move LUNES on-chain)
- **Local:** `app.ts:705,720`; `store.ts:255-262`
- **Evidência:** `Math.round(amount * 100) !== amount * 100` recusa 0.07, 0.29 etc. (falso positivo); o saldo é arredondado em `number`.
- **Correção:** passar a `amount: string` com `pattern: '^[0-9]{1,7}(\\.[0-9]{1,2})?$'` e guardar em centavos inteiros (ou em planck `bigint` como em `signing.ts`).
- **Muda comportamento/protocolo?** **Sim** (o campo `amount` muda de tipo no contrato da API).

### I-01 — A suíte criptográfica se declara "não final, não para produção sem auditoria" e está em produção
- `protocol/suite.ts:3-9` (cópia gerada nos dois apps). As escolhas são boas (Ed25519, X25519, XChaCha20-Poly1305, HKDF-SHA256, @noble), mas o próprio código pede revisão independente antes da Mainnet. Recomendação: registrar a decisão (ADR) e encomendar a auditoria externa.

### I-02 — Segredos em repouso sem cifra (protegidos só por permissão 0600)
- `state.json` (`phones[].secret`, o HMAC de aprovação), `operator/keys.json` (semente da chave de operador), `lnnp/node.seed`. Aceitável num aparelho dedicado. Num host compartilhado, considerar cifrar com chave do SO (TPM, keychain) ou, no mínimo, documentar.

### I-03 — Certificado TLS de 397 dias sem renovação; HSTS com `includeSubDomains` sobre certificado autoassinado
- `server.ts:51-69`. Quando o certificado vence, o app (que fixa a impressão digital pelo QR) e os navegadores com HSTS ficam sem acesso até alguém regenerar à mão. Recomendação: renovar automaticamente 30 dias antes, com aviso no painel e um novo QR.

### I-04 — `PIU_LUNES_ENDPOINTS` aceita `ws://`
- `lunes/reader.ts:92`. Vem de configuração local (confiável), mas `ws://` fora de localhost expõe o contexto de assinatura a quem estiver no caminho (sem perda de fundos, porque o celular assina, mas um nonce ou uma gênese falsos fazem a transferência falhar). Restringir `ws://` a `localhost` e `127.0.0.1`.

---

## O que já está bem feito

- **Autorização por objeto (anti-IDOR/BOLA) consistente:** `ownedDevice`, `phonesOf(operatorId)`, `signer.get(id, operatorId)`, `pendingTx` com `operatorId`. Ids de outro operador recebem 404 sem revelar se existem.
- **Ids não sequenciais:** todos são `randomUUID()`, e os parâmetros são validados por `pattern` UUID. Não há id incremental exposto.
- **Sessão:** token de 256 bits (`randomBytes(32)`) guardado só como SHA-256. Cookie `__Host-` com `HttpOnly`, `Secure`, `SameSite=Strict`. Inatividade de 30 min e máximo de 12 h. Step-up de 15 min para ações sensíveis. Listagem e revogação das outras sessões.
- **CSRF:** mesma origem (`Origin`/`Sec-Fetch-Site`) mais token por sessão comparado em tempo constante, aplicados em `onRequest` (antes de ler o corpo).
- **Anti DNS rebinding:** allowlist de `Host` (421). `trustProxy: false`.
- **Helmet:** CSP estrita (`default-src 'none'`, sem `unsafe-inline` em script), HSTS, `frame-ancestors 'none'`, `no-referrer`, `nosniff`, `Permissions-Policy`. `Cache-Control: no-store` em `/api/`. **Nenhum CORS** habilitado, o que é o correto aqui.
- **Rate limit:** global (300/min) e estrito por rota em pareamento, step-up, backup, telefones, transferências e reinício.
- **Validação de entrada:** JSON Schema com `additionalProperties: false`, `coerceTypes: false`. `bodyLimit` de 16 KiB (300 KiB só no restore).
- **Erros genéricos:** o error handler não devolve stack trace (500 vira "Erro interno."). Logs com `redact` de cookie, CSRF e `Set-Cookie`.
- **Arquivos estáticos e pacotes:** proteção contra path traversal (`resolve` + prefixo + `\0` + allowlist de extensões); `/pkg/:file` só serve o que está no manifesto assinado com Ed25519 por chave **fixada**.
- **Criptografia real:** nada de base64/xor fingindo cifra. Pareamento por HMAC-SHA256, códigos comparados com `timingSafeEqual`, código de aprovação de 80 bits, aleatoriedade com `randomInt`/`randomBytes`. Backup com scrypt + XChaCha20-Poly1305 e cabeçalho como AAD.
- **LNNP:** handshake mutuamente autenticado e anti-downgrade (assina os dois HELLO), anti-replay de desafio (`ReplayGuard`) e tolerância de relógio, chaves por sentido via HKDF com transcript, contador estritamente crescente (registro repetido é recusado), limite de quadro antes e depois do handshake, `Reassembler` com tetos, `maxConnections`, balde por peer no roteador.
- **Assinatura na Mainnet:** o nó nunca tem a chave. Antes de enviar, confere byte a byte o extrinsic (assinante, call exato, era, nonce, gorjeta e assinatura sr25519), roda `validate_transaction`, grava `submitAttemptedAt` antes do envio e trata resultado incerto sem liberar outro pagamento. Runtime fixado (`CHECKED_RUNTIME`).
- **Liquidante:** `bigint` em planck (sem float), `batchAll` tudo-ou-nada, diário gravado **antes** do envio, reenvio dos mesmos bytes, era mortal, conferência de saldo, `--confirm <id>`. `PayoutClaim` amarrado à época (impede replay entre lotes). Conflito de carteira resulta em nenhuma carteira.
- **Arquivos sensíveis:** pasta de dados 0700 e arquivos 0600, gravação atômica com `fsync` (`writeFileAtomic`) no cofre e no armazenamento de mensagens. Arquivo de chaves ilegível é posto de lado, nunca sobrescrito. Senha do keystore em arquivo com permissão conferida.
- **Dependências:** `npm audit --omit=dev` limpo nos dois apps; libs criptográficas auditadas (@noble, @scure); nenhum segredo nem `.env` versionado no escopo.

## Itens propensos a falso positivo (honestidade)

- **A-02 e M-04** pressupõem que um atacante alcance as portas LNNP. Por padrão elas escutam em `0.0.0.0`, então numa LAN doméstica qualquer aparelho alcança; num VPS ("Super Node") a internet inteira alcança, a menos que haja firewall.
- **M-03** depende da forma de implantação (systemd/procd sem TTY). No app desktop, que mostra o código na própria janela, não se aplica.
- **B-01** é decisão de produto declarada. Classifiquei como Baixa só para deixar o risco registrado.
- **C-01 e A-01** pressupõem que as evidências venham de fontes não confiáveis, que é o que o `validator-cli.ts` documenta ("de nós e gateways"). Se, na operação real, só entram arquivos de nós previamente conhecidos e auditados, o risco cai para Alta. Mesmo assim, o código não impõe isso.

---

## Correções aplicadas (06/11/2026)

Escopo desta rodada: só `apps/piu-node` (o `apps/settlement` não foi tocado). Nenhuma correção muda o fio: anúncio UDP, quadros LNNP, recibos, provas e o formato da evidência são os mesmos, e os celulares já instalados continuam compatíveis. Cada correção começou por um teste que falhava (TDD), em `apps/piu-node/test/hardening.test.ts` (16 testes novos).

Suíte do `piu-node`: antes 88 testes (87 passando); depois 104 (103 passando). A única falha, antes e depois, é `test/lunes.test.ts` ("src/lunes é cópia fiel de apps/mobile/src/lib"), que vem de edições em andamento no `apps/mobile` feitas por outra frente, e não destas correções. `npm run typecheck` passa.

| Achado | Status | Arquivos |
|---|---|---|
| C-01 | adiado: redesenho de protocolo (prova assinada pelo destino, registro de nós), fora do escopo aprovado | — |
| A-01 | adiado: muda o econômico e o validador (`apps/settlement`), fora do escopo aprovado | — |
| A-02 | **corrigido** | `src/relay/lan.ts` |
| M-01 | **corrigido** | `src/relay/engine.ts` |
| M-02 | **corrigido** | `src/store.ts` |
| M-03 | **corrigido** | `src/security/codeDisplay.ts` (novo), `src/main.ts`, `README.md` |
| M-04 | **corrigido** | `src/relay/lan.ts`, `src/relay/engine.ts`, `src/relay/index.ts` |
| M-05 | adiado: está em `apps/settlement` (fora dos arquivos desta rodada). Dá para fazer sem mudar o protocolo (índice por digest e teto de total); a assinatura do lote pelo validador muda o formato do lote | — |
| B-01 | adiado: decisão de produto (o modelo "o código prova acesso físico" é o declarado); muda o fluxo de voltar à mesma conta | — |
| B-02 | **corrigido** | `src/operator.ts` |
| B-03 | **corrigido em parte** (o `lastSeen`; a cota por `from` no roteador ficou para depois, porque mexe na admissão de envelopes de celulares) | `src/relay/engine.ts` |
| B-04 | adiado: o teste aprovado `security.test.ts` ("5 erros destroem o código, mesmo trocando de IP") fixa o desenho atual; trocar por 20 falhas em IPs distintos é decisão de produto | — |
| B-05 | **corrigido** | `src/store.ts` |
| B-06, B-07, B-08 | adiados: em `apps/settlement` (fora dos arquivos desta rodada) | — |
| B-09 | **corrigido** | `scripts/release.ts`, `.gitignore` (do `piu-node`), `README.md` |
| B-10 | adiado: muda o que os co-operadores veem no painel (telas deles passariam a receber 403); precisa de ajuste no painel junto | — |
| B-11 | adiado: muda o tipo de `amount` no contrato da API | — |
| I-01 a I-04 | sem mudança (informativos) | — |

### A-02 — discagens disparadas por anúncio UDP
- ANTES: todo anúncio com etiqueta maior que a do nó gerava `dial(endereço:porta)`, sem teto e sem espera.
- DEPOIS: em `onBeacon`, no máximo uma discagem por IP de origem por período de anúncio (`beaconMs`); depois de uma falha, a espera dobra (`beaconMs · 2^(falhas+1)`, até 5 min) e volta a zero quando o enlace abre; teto global de 8 discagens de descoberta abertas ao mesmo tempo; nada de discar com os enlaces no teto; mapa de IPs limitado a 1024 (sai o mais antigo). Os vizinhos fixos não passam por esse caminho.
- Testes: "anúncios forjados de um mesmo IP disparam no máximo uma discagem por período", "anúncios de muitos IPs param no teto global", "discagem de descoberta que falha espera mais antes de tentar o mesmo IP (backoff)".
- Visível: com muitos vizinhos novos ao mesmo tempo, a descoberta fica um pouco mais lenta. Nada muda para os vizinhos fixos.
- Não feito (opcional no relatório): restringir porta e faixas de IP privadas. Ficou de fora para não quebrar portas personalizadas nem o Super Node.

### M-01 — recibos próprios expulsos pelos de vizinhos
- ANTES: um único `receiptLog` FIFO de 1000 para os recibos próprios e os de terceiros.
- DEPOIS: dois buffers. Os assinados por este nó ficam até 10 000; os de terceiros, até 1000 (FIFO), sem nunca expulsar os próprios. `receiptLog` virou um getter (próprios + terceiros) e `exportState`/`importState`, `/api/relay/evidence` e o painel continuam iguais. Recibos de terceiros por enlace limitados a 600 por minuto (o excesso conta como recusado). `receiptsView().keptOwn` agora vem do buffer próprio; `max` passou a 11 000.
- Testes: "recibos de vizinhos não expulsam os recibos assinados por este nó" (via `importState`) e "um vizinho que despeja recibos autoassinados é limitado por enlace e não apaga os próprios" (pelo fio, com quadros `RelayReceipt` reais).
- Visível: a exportação de evidências pode ficar maior (mais recibos próprios guardados).

### M-02 — `state.json` sem fsync e reset silencioso
- ANTES: `writeFileSync` + `rename` sem `fsync`; arquivo ilegível virava estado vazio e era sobrescrito no próximo `save()`.
- DEPOIS: `save()` usa `writeFileAtomic` (fsync + rename, 0600). Na leitura, um arquivo ilegível (vazio, JSON cortado, lixo, não-objeto) é renomeado para `state.json.corrompido-<ms>` (nunca sobrescrito), e o nó **não sobe**, com um erro que diz onde está o arquivo e como restaurar. A cada subida com o arquivo bom, uma cópia vai para `state.json.bak` (0600), que é o que se restaura. Pasta sem `state.json` continua começando vazia.
- Testes: "state.json ilegível não vira estado vazio: o nó recusa subir e guarda o arquivo de lado" (três tipos de corrupção, restauração pelo `.bak` volta com o dono) e "o estado é gravado de forma atômica (sem .tmp sobrando, 0600)".
- Visível: **sim**. Com `state.json` corrompido, o nó (e o app desktop, que mostra o erro num diálogo) deixa de subir até alguém restaurar o arquivo.

### M-03 — código de pareamento no log persistente
- ANTES: o código sempre ia para o stdout, que em systemd/procd vira journald/logread.
- DEPOIS: `pairingCodeOutput` (novo `src/security/codeDisplay.ts`). Com terminal interativo (desenvolvimento, console do equipamento), o código aparece na tela como antes. Sem terminal, vai para `<PIU_NODE_DATA>/pairing-code` (0600, pasta 0700, gravação atômica) e o log diz só o caminho (`sudo cat …`). Cada código novo (usado ou bloqueado) regrava o arquivo.
- Testes: "sem terminal (serviço), o código não vai para o stdout; vai para um arquivo 0600" e "no terminal interativo, o código continua aparecendo na tela".
- Visível: **sim, operacional**. No OpenWrt e no systemd, o código deixa de aparecer no `logread`/`journalctl`. **Pendente fora destes arquivos:** `packaging/openwrt/README.md` (linhas 71 e 128) e os comentários de `packaging/openwrt/files/piu-node.init`/`piu-node.config` ainda mandam ler o código no `logread` e precisam passar a apontar para o arquivo.

### M-04 — vagas de handshake e de enlace
- ANTES: um contador `pending` de 16 compartilhado entre conexões que entram e as que o nó abre; nenhum teto por IP; com 64 enlaces, o vizinho fixo era recusado.
- DEPOIS: vagas separadas (`pendingIn`, até `maxPending` = 16; `pendingOut`, até 16), teto de 4 handshakes de entrada pendentes por IP de origem (`maxPendingPerIp`) e liberação da vaga uma vez só. No teto de enlaces, um vizinho fixo que este nó discou entra no lugar do enlace anônimo mais novo (nunca um do mesmo operador nem outro vizinho fixo), via `RelayEngine.newestLink`. Os demais continuam recebendo `0x7e`.
- Testes: "conexões que entram e não falam LNNP não tiram as vagas das discagens deste nó" (20 conexões penduradas e o vizinho fixo conecta), "teto de handshakes pendentes por IP de origem" e "no teto de enlaces, um vizinho fixo entra no lugar de um enlace anônimo".
- Visível: não. Com mais de 4 aparelhos atrás do mesmo NAT conectando ao mesmo tempo, os excedentes recebem "Ocupado" e reconectam no período seguinte.

### B-02 — scrypt do `restore`
- ANTES: `MAX_N = 1 << 20` e `maxmem: 2 ** 31`.
- DEPOIS: `MAX_N = 1 << 17` (128 MiB) e `maxmem: 256 MiB`. O nó gera 2^16, então os backups existentes continuam abrindo.
- Teste: "backup com scrypt N acima de 2^17 é recusado antes de derivar".

### B-03 — `lastSeen` sem limite (em parte)
- ANTES: `this.lastSeen.set(peerId, now)` sem teto.
- DEPOIS: `seen(peerId)` reinsere no fim e limita a 4096 entradas (sai a mais antiga).
- Teste: "o mapa de 'visto por último' não cresce sem limite com identidades novas".
- Adiado: a cota de armazenamento por `from` no roteador.

### B-05 — `touchSession` regrava o `state.json` a cada requisição
- ANTES: `x.lastSeen = now; this.save();` em toda requisição autenticada.
- DEPOIS: em memória, `lastSeen` é sempre o de agora; no disco, no máximo uma gravação por minuto por sessão.
- Teste: "requisições seguidas não regravam o state.json a cada vez".

### B-09 — chave de release dentro do repositório
- ANTES: `const dir = args[0] ?? 'release-keys';` (relativo a `apps/piu-node`).
- DEPOIS: a pasta é obrigatória e tem de ficar fora do repositório (senão sai com código 2 e uma mensagem de uso). `.gitignore` do `piu-node` ganhou `release-keys/`, `*.pem` e `.env*`. O exemplo do README passou a usar `~/cofre/release-keys`. O `.gitignore` da raiz não foi tocado (fora dos arquivos desta rodada).
- Conferido à mão: sem pasta e com `release-keys` (dentro do repositório), sai com código 2; com uma pasta temporária fora, gera a privada com 0600.

### Ligado ao `provider.md` M-01
- `src/app.ts`: o pareamento e a nova `app.piuLocalSession(nome, rótulo)` usam o mesmo `openSession` (mesmo operador pelo nome, equipamento próprio, chave de operador). Não existe rota HTTP para a sessão local, e ela nasce **sem step-up** (`authAt = 0`, `createSession(..., stepUp = false)` em `src/security/session.ts`). `src/server.ts` expõe `localSession` no `NodeServer`.
- Teste: "sessão local (app desktop): abre sem código, não consome o código vigente e não vale como step-up".

## Correções aplicadas — prova de entrega v2

Desenho: `docs/economia/prova-de-entrega-v2.md` (modelo de ameaças, formatos byte a byte, quem assina o quê, regras do validador, registro, regra das vagas, lote amarrado, migração e o que fica fora). Mudança de protocolo aprovada para esta rodada. Nada foi enviado à Lunes Mainnet: tudo foi testado localmente, com a chain simulada (`test/fake-chain.ts`).

| Achado | Estado | Onde |
|---|---|---|
| C-01 | corrigido no validador; recompensa depende de configurar a chave do validador e os operadores admitidos | `apps/mobile/src/protocol/proof.ts`, `apps/settlement/src/{ledger-v2,registry,validator}.ts` |
| A-01 | corrigido | `apps/settlement/src/ledger-v2.ts`; livro v1 do protocolo (`receipts.ts`): prova diferente não sobrescreve mais |
| M-05 | corrigido | `apps/settlement/src/{binding,journal,settler,lot,cli}.ts` |

### C-01 — provas forjáveis e Sybil
- ANTES: `ledger.confirmDelivery(p.envelopeId, secret, hash(secret).slice(0, 16))`. O `ackHash` vinha do próprio segredo, e qualquer chave de nó gerava crédito.
- DEPOIS:
  - A prova v2 é assinada pela identidade do destino depois de abrir o envelope (AEAD e assinatura do remetente conferidas). Ela leva o cabeçalho autenticado, e o validador confere `H(ackSecret)[:16]` contra o `ackHash` **do cabeçalho**, que é o compromisso do remetente.
  - A prova viaja selada (X25519 + XChaCha20-Poly1305) para a chave do validador, então a identidade do destino não aparece na malha.
  - Só nó registrado gera crédito: certificado `OPERATOR_CERT` (o mesmo do piu-node, com rotação e revogação) de um operador listado em `dados/operadores.json`. Sem esse arquivo, o `close` aborta.
  - Teto de 2% por operador (além de por nó) e teto por destino por época.
  - Prova v1 não rende nada e aparece no relatório como "só prova v1".
- Testes (`apps/settlement/test/v2.test.ts`): prova v1 forjada; arquivo v1 inteiro; segredo, id, destino e chave de selagem trocados; 50 chaves Sybil sem registro; operador não admitido; certificado forjado; nó revogado; 50 nós sob um mesmo operador presos a 2%; teto por destino.
- Limite reconhecido: um operador **admitido** ainda pode gerar tráfego próprio dentro do teto dele. O próximo passo é stake ou registro on-chain (decisão de produto).

### A-01 — sobrescrita e corrida pelas vagas
- ANTES: a última prova sobrescrevia a anterior, e as 8 vagas iam para quem declarasse o `at` mais cedo.
- DEPOIS:
  - A primeira prova válida vence. Uma segunda prova válida **diferente** deixa o envelope em `conflito`: ninguém ganha e o envelope vai para `report.flagged`. Lixo e prova v1 não mexem em nada. O resultado não depende da ordem dos arquivos.
  - Mais de 8 recibos válidos de nós registrados num envelope: nenhum é creditado (`excesso de recibos (auditar)`). O `at` não decide mais quem fica com as vagas, recibo de nó sem registro não ocupa vaga, e `at` fora da vida do envelope é recusado.
  - Dois recibos diferentes do mesmo nó para o mesmo envelope: os dois ficam fora.
- Testes: prova falsa nas duas ordens de arquivo; duas provas válidas conflitantes; 8 Sybils registrados com `at` no início da época (excesso, ninguém ganha) e sem registro (os honestos ganham); `at` fora da vida do envelope; recibo duplicado e diferente do mesmo nó; fechamento reprodutível.

### M-05 — repagar com outro id de lote
- ANTES: a proteção era só pelo id do lote no diário.
- DEPOIS:
  - O lote v2 traz `stateHash` (créditos com aquele id: nó, época, valor e carteira, que agora fica gravada no crédito).
  - `lot:pay` confere o lote contra `dados/validador.json` **antes de conectar na chain**. Lote renomeado dá "nenhum crédito em lote com este id". Carteira ou valor editados dão "não bate".
  - O diário guarda `payoutsDigest` (só os pagamentos, sem o id) e recusa os mesmos pagamentos com outro id, a não ser que o outro lote tenha terminado em `falhou`.
  - Lote sem vínculo só passa com `--manual`.
- Testes: renomear, trocar carteira, aumentar valor, lote v1 sem `--manual`, e repagar com outro id depois de pago na chain simulada.

### Compatibilidade
- Envelope e recibo não mudaram. Celulares antigos continuam retransmitindo e entregando. O quadro novo "P2" é descartado por eles como envelope inválido (testado com o roteador v1). Os celulares novos continuam mandando a prova v1 ("PR") para os créditos locais dos antigos.
- O validador lê evidências v1 e v2. O app exporta v2 (`sealedProofs`); o piu-node continua exportando v1 (só recibos).
- Enquanto `VALIDATOR_PROOF_PK` (`apps/mobile/src/protocol/proof.ts`) for `null`, o app não gera prova v2 e o validador v2 não paga nada. Isso é de propósito.

### Testes
Antes → depois: settlement 17 → 31; piu-node 104 → 105; mobile 417 → 429 desta rodada (a suíte mostra 453, porque outra frente de trabalho acrescentou testes ao mesmo tempo); desktop 127 → 127. Typecheck limpo nos quatro. Uma falha no piu-node não é desta rodada: `src/lunes é cópia fiel de apps/mobile/src/lib`, por `src/i18n/pt-BR.ts`, que foi editado pela outra frente. Resolve com `node scripts/sync-lunes.mjs` quando ela terminar.

### Revisão independente da v2 (mesma data)

Corrigido com TDD, em `apps/settlement/test/v2-revisao.test.ts` e `apps/mobile/src/messaging/__tests__/provaV2.test.ts`. Detalhes em `docs/economia/prova-de-entrega-v2.md`, seção 12. O formato da prova mudou: o pseudônimo por validador entra no lugar da identidade, e a prova tem agora 237 bytes (310 selada). Isso não afeta ninguém, porque a v2 ainda não foi ativada (`VALIDATOR_PROOF_PK = null`).

- **[ALTA] Conflito sem custo.**
  - ANTES: qualquer prova válida com outro cabeçalho marcava conflito.
  - DEPOIS: só conta a prova cujo `ackHash` é o de um recibo de nó registrado; o resto é ruído.
- **[ALTA] Diluição por tráfego sintético.**
  - ANTES: o teto era aplicado depois de dividir, e o excedente se perdia.
  - DEPOIS: `allocate` aplica o teto por nó e por operador antes de dividir, por enchimento. Com 100 nós Sybil sob um operador, os honestos só perdem a fatia (com teto) desse operador.
  - Caução ou stake do operador e amostragem por sentinelas continuam obrigatórias antes de ligar orçamento relevante.
- **[MÉDIA] Excesso por um operador.**
  - Saem os recibos dos operadores com mais de um recibo no envelope.
  - Com N marcas na época (`maxFlagsPerOperator`, padrão 3), o operador fica fora da época, e o relatório mostra isso em `operatorFlags`.
- **[MÉDIA] Supressão de provas na malha.** O app guarda até 3 provas seladas diferentes por envelope, e a do destino entra na frente.
- **[MÉDIA] Sem `fsync`.** Diário, estado, lotes e chave são gravados com `writeFileAtomic` (`fsync` + troca de nome).
- **[BAIXA] Rotação.** Chave substituída só vale para o emitido antes da rotação, e nada retroativo é aceito.
- **[BAIXA] Privacidade.** A prova é assinada por um pseudônimo derivado da identidade e da chave do validador. Sem saber com certeza qual identidade é o destino, o app não gera prova.
- **[BAIXA] Época.** O teto por destino e o fechamento usam a mesma época do envelope (recibo válido mais antigo).
- **Celulares antigos com o quadro "P2":** recusam como envelope inválido, sem bloquear o vizinho e sem log. Gastam uma ficha do balde daquele vizinho por quadro.

Testes depois da revisão: settlement 39, piu-node 105, mobile 455, desktop 127, todos passando, e typecheck limpo nos quatro.
