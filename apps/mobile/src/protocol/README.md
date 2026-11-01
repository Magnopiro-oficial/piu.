# Protocolo de comunicação do Piu (protótipo v0)

Criptografia e regras de comunicação descentralizada, em TypeScript puro, sem dependência de React Native: roda no app (Hermes), no navegador e no Node. `npm test` executa os testes (21 cenários, inclusive de ataque).

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
| Fragmentação para MTU pequena | `fragment.ts`, integridade pelo id | "fragmentação…" |
| Confirmação de entrega (FUN-015) e evidências com privacidade (seção 11) | `ackSecret` cifrado no conteúdo, revelado pelo destino; recibos assinados pela chave do nó | "créditos…" |
| Código de segurança 12 × 5 | `safety.ts` (hash iterado, como o Signal) | "código de segurança…" |
| Igualar tamanho das mensagens (ajuste de Privacidade) | preenchimento em blocos de 256 B / 1 / 4 / 16 KB | "preenchimento…" |

## Formato do envelope

```
0 versão · 1 suíte · 2 tipo · 3 flags (bit 0 = mídia) · 4 prioridade · 5 saltos restantes (mutável)
6 versão da chave (grupo) · 8 expira em (s) · 12 destino (16) · 28 chave efêmera (32)
60 nonce (24) · 84 hash do segredo de entrega (16) · 100 tamanho do corpo (u32) · 104 corpo cifrado
```

O corpo cifrado contém: tipo, horário de envio, segredo de entrega, chaves públicas do remetente com o vínculo entre elas, conteúdo preenchido e a assinatura sobre o cabeçalho e o conteúdo. Como a assinatura cobre o cabeçalho, quem recebe não consegue reembrulhar a mensagem e repassá-la a outra pessoa como se viesse do remetente.

## O que ainda NÃO está resolvido (para a revisão formal)

1. **Sigilo futuro e pós-comprometimento:** a chave efêmera é só do lado de quem envia. Se a chave de acordo do destinatário vazar, mensagens antigas guardadas por terceiros podem ser lidas. Avaliar Double Ratchet (conversas) e MLS (grupos), ambos candidatos do documento.
2. **Destino lógico ligável no mesmo dia:** quem conhece a chave pública de alguém consegue reconhecer os envelopes para essa pessoa durante aquele dia. Esse é o custo de entregar sem servidor e sem tentar decifrar tudo. Alternativas: tags por contato derivadas de segredo compartilhado, ou tentativa de decifrar com limite.
3. **Grupos grandes:** a troca de chave manda um envelope por membro (O(n)). O MLS resolve em O(log n).
4. **Antifraude:** o validador credita só com entrega comprovada e sem duplicar, mas o documento reconhece que isso não prova a transmissão física. Ainda faltam amostragem, auditoria probabilística, detecção de colusão e Sybil.
5. **Atraso aleatório no envio** (ajuste de Privacidade): é responsabilidade da fila do app, ainda não implementada.
6. **Recuperação pela frase:** a semente ainda é aleatória. A conversão frase ↔ semente (lista de palavras, checksum) está em aberto no documento.
7. **Guarda da semente no aparelho:** precisa ir para o armazenamento seguro do sistema (Keychain/Keystore, via `expo-secure-store`), nunca para o AsyncStorage. Isso entra junto com o development build.
8. **Integração no app:** o app ainda não usa este protocolo. No aparelho, o Hermes não tem `crypto.getRandomValues`: instalar o polyfill (`expo-crypto`) antes do primeiro uso.
