# Protocolo de comunicação do Piu (protótipo v0)

Criptografia e regras de comunicação descentralizada, em TypeScript puro, sem dependência de React Native: roda no app (Hermes), no navegador e no Node. `npm test` executa os testes deste protocolo e da camada de mensagens, inclusive cenários de ataque.

> ⚠️ **Protótipo, não decisão final.** O documento de requisitos (seção 9) exige que os algoritmos sejam escolhidos numa etapa formal de *threat modeling* e revisão especializada, e que haja **auditoria de segurança independente antes de produção**. Esta versão usa candidatos listados no próprio documento, por meio de bibliotecas auditadas, e cada envelope declara a suíte usada. Assim, ela pode ser trocada sem quebrar a rede.

## Suíte v0 (`suite.ts`)

| Função | Candidato usado | Biblioteca |
|---|---|---|
| Assinatura | Ed25519 | `@noble/curves` |
| Acordo de chaves | X25519 | `@noble/curves` |
| Cifra autenticada | XChaCha20-Poly1305 (nonce aleatório de 24 bytes) | `@noble/ciphers` |
| Derivação | HKDF-SHA256, com um rótulo de domínio por uso | `@noble/hashes` |

Nenhuma primitiva criptográfica foi escrita à mão.

## Requisitos atendidos

| Requisito (documento) | Onde | Teste |
|---|---|---|
| E2E; relays não decifram (seção 9, INF-011) | `envelope.ts`: remetente selado, chave efêmera por mensagem | "direta: só o destino abre…" |
| Pública e anônima sem chaves nem ids em comum; nó, social e carteira separados | `keys.ts`: HKDF com rótulos distintos a partir de uma semente | "chaves: … nunca se repetem" |
| Proteção contra adulteração | cabeçalho (menos os saltos) como dado associado do AEAD e na assinatura | "integridade: qualquer byte alterado…" |
| Proteção contra personificação | assinatura Ed25519 do remetente, com vínculo assinatura↔acordo | "autenticidade…" |
| Proteção contra replay | id criptográfico + deduplicação + validade no tempo | "deduplicação…", "validade no tempo…" |
| Proteção contra downgrade | versão e suíte aceitas explicitamente | "downgrade…" |
| Rotação de chave ao remover membro | `newGroupKey` + distribuição por envelope direto + checagem de membro | "grupo: quem sai não lê…" |
| Envelope com id, destino lógico, prioridade, TTL, tamanho e integridade (seção 10) | cabeçalho de 104 bytes | todos |
| Store-and-forward (FUN-010) | `router.ts` | "multihop com store-and-forward…" |
| TTL e expiração sem comando remoto (FUN-011) | `Router.purge`, TTL máximo de 7 dias | "TTL: vencida no meio do caminho…" |
| Deduplicação sem crédito duplicado (FUN-012, seção 11) | `seen` no roteador; `ContributionLedger` | "deduplicação…", "créditos…" |
| Evitar loops; múltiplas rotas | limite de saltos, não devolve, não repete por vizinho, cópias limitadas | "sem loops…", "limite de saltos…" |
| Limites do nó (FUN-018) | espaço, quantidade, tamanho, retenção; descarta primeiro o de menor valor | "limites do nó…" |
| Modo nó (FUN-017) | `relay: false` guarda só as próprias | "Modo nó desligado…" |
| Mídia nunca por LoRa | flag `bulk` no cabeçalho | "mídia nunca por LoRa…" |
| Sinal ao vivo da chamada nunca por LoRa (o pedido de chamada passa) | flag `live` no cabeçalho | "sinal ao vivo da chamada nunca por LoRa…" |
| Fragmentação para MTU pequena | `fragment.ts`, integridade pelo id | "fragmentação…" |
| Confirmação de entrega (FUN-015) e evidências com privacidade (seção 11) | `ackSecret` cifrado no conteúdo, revelado pelo destino; recibos assinados pela chave do nó | "créditos…" |
| Código de segurança 12 × 5 | `safety.ts` (hash iterado, como o Signal) | "código de segurança…" |
| Sigilo futuro e recuperação pós-comprometimento | `ratchet.ts`: Double Ratchet por contato, dentro do envelope selado | "sigilo futuro…", "ratchet: …" |
| Minimização de metadados (endereços persistentes) | `sessions.ts`: após a resposta, o destino deriva do segredo da sessão | "sessão pela malha…" |
| Recuperação de identidade | `phrase.ts`: 12 palavras BIP39 em inglês (lista padrão), com checksum | "frase…" |
| Atraso aleatório no envio (Privacidade) | `Router.send(…, { delaySec })` + `randomDelaySec()` | "atraso aleatório…" |
| Antifraude: Sybil, colusão, tráfego artificial, auditoria | `ContributionLedger`: tetos por envelope e nó/dia, horário, auditoria por amostragem com bloqueio | "antifraude…" |
| Igualar tamanho das mensagens (ajuste de Privacidade) | preenchimento em blocos de 256 B / 1 / 4 / 16 KB | "preenchimento…" |

## Formato do envelope

```
0 versão · 1 suíte · 2 tipo · 3 flags (bit 0 = mídia, bit 1 = sinal ao vivo) · 4 prioridade · 5 saltos restantes (mutável)
6 versão da chave (grupo) · 8 expira em (s) · 12 destino (16) · 28 chave efêmera (32)
60 nonce (24) · 84 hash do segredo de entrega (16) · 100 tamanho do corpo (u32) · 104 corpo cifrado
```

O corpo cifrado contém: tipo, horário de envio, segredo de entrega, chaves públicas do remetente com o vínculo entre elas, conteúdo preenchido e a assinatura sobre o cabeçalho e o conteúdo. Como a assinatura cobre o cabeçalho, quem recebe não consegue reembrulhar a mensagem e repassá-la a outra pessoa como se viesse do remetente.

## Sessões (Double Ratchet)

- Início simplificado: o segredo da sessão vem de DH(identidade A, identidade B). A primeira mensagem já faz um passo de DH com chave efêmera, e cada resposta gira a catraca.
- Cada mensagem usa uma chave própria, apagada depois do uso. As chaves puladas (mensagens fora de ordem) ficam guardadas, até 1.000 por cadeia e 2.000 no total.
- O conteúdo da sessão vai dentro do envelope selado (`MsgType.Session`). Os relays não veem nem a chave da catraca.
- Antes da primeira resposta, o destino do envelope é o da chave pública (o outro lado ainda não tem a sessão). Depois, é derivado do segredo da sessão e muda por dia.
- Se os dois começarem ao mesmo tempo, os dois leem tudo e convergem para uma sessão só.

## O que ainda NÃO está resolvido (para a revisão formal)

1. **Primeiras mensagens de uma sessão:** até a primeira resposta, o sigilo depende da chave de identidade do destinatário, como no Signal sem *one-time pre-keys*. Pre-keys exigiriam publicá-las com antecedência, o que é difícil numa malha offline.
2. **Primeiro contato ainda é ligável:** enquanto não há resposta, o destino deriva da chave pública e muda por dia.
3. **Grupos grandes:** a troca de chave manda um envelope por membro (O(n)), e as mensagens de grupo não têm sigilo futuro. O MLS resolve as duas coisas em O(log n), mas é grande e precisa da revisão formal.
4. **Antifraude:** ainda falta o desafio de auditoria em si (como um nó prova, na prática, que retransmite). Hoje o validador recebe o resultado pronto. A detecção de colusão é por tetos, não por análise de grafo.
5. **Semente compatível com BIP39:** a frase usa a lista e o checksum do BIP39, mas a derivação é própria do Piu. Não importe a frase em carteiras de terceiros.
6. **Integração no app:** feita. A semente fica no cofre do sistema, e as conversas reais usam este protocolo por meio de `src/messaging/` (ver o README de lá).

## LNNP v1: o enlace entre nós (`lnnp.ts`)

Especificação completa: [`docs/lnnp/especificacao-v1.md`](../../../../docs/lnnp/especificacao-v1.md).

O **envelope** (formato `0`, acima) é o que vai de ponta a ponta. O **LNNP** (versão `1`, o `net.piu.lnnp.v1` do `SERVICE_ID`) é o que dois vizinhos falam entre si para trocar envelopes. São camadas e numerações independentes: o LNNP anuncia os formatos de envelope que aceita (`ENVELOPE_VERSIONS`), então um formato novo de envelope não exige LNNP novo, e o contrário também vale.

| O que | Como | Teste (`__tests__/lnnp.test.ts`) |
|---|---|---|
| Identidade técnica do nó | chave Ed25519 de `deriveNodeKey`; nenhuma identidade social no enlace | "o enlace não revela identidade social…" |
| Handshake autenticado | HELLO/AUTH simétricos: cada lado assina os dois HELLO, que têm o desafio novo do outro | "handshake autenticado…", "assinatura errada…" |
| Anti-replay e anti-downgrade | `ReplayGuard` + horário; a assinatura cobre as faixas de versão e as capacidades | "replay do desafio…", "HELLO adulterado…" |
| Negociação de versão (INF-013) | maior versão comum; versão desconhecida não derruba o enlace | "negociação entre versões diferentes…" |
| Capacidades | TLV: MTU, meios, relay, armazenamento, suítes, formatos, recursos; desconhecidas ignoradas | "capacidades desconhecidas…", "CAPS_UPDATE…" |
| Autorização | `authorize(chave, capacidades)`: lista de permitidos ou revogação | "autorização recusa…" |
| Enlace cifrado | XChaCha20-Poly1305 por sentido, contador crescente, chaves efêmeras X25519 | "handshake autenticado…" |
| Recibos e descoberta | codecs de `RELAY_RECEIPT` e do anúncio UDP | "recibo de retransmissão e anúncio…" |

O `apps/piu-node` usa este arquivo (cópia gerada em `apps/piu-node/src/protocol/`) no motor de retransmissão com o adapter LAN.
