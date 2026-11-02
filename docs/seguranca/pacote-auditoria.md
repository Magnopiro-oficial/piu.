# Pacote para a auditoria de segurança independente

O documento de requisitos exige "auditoria de segurança independente antes de produção" e que os algoritmos sejam escolhidos "em uma etapa formal de threat modeling e revisão especializada" (seção 9). Este pacote reúne o que uma equipe externa precisa para orçar e fazer essa revisão. A [auditoria interna de novembro de 2026](auditoria-2026-11.md) **não substitui** a revisão externa: ela foi feita pela mesma equipe que escreveu o código.

## 1. Pedido

**Objetivo:** revisão independente do desenho criptográfico e da implementação do protocolo de mensagens do Piu, do armazenamento de segredos no app e da autenticação do `piu-node`. O resultado deve dizer se o desenho é adequado para produção e o que precisa mudar.

**Entregáveis esperados:**

1. relatório com achados classificados por severidade, cada um com cenário de exploração e recomendação;
2. parecer sobre a suíte de algoritmos (manter, trocar ou complementar com Noise ou MLS);
3. reteste das correções;
4. versão pública do relatório (o projeto é AGPL-3.0, e a transparência faz parte da proposta).

**Perfil da equipe:** experiência em protocolos de mensageria (Signal/Double Ratchet, MLS), redes DTN/mesh e aplicativos móveis. Exemplos de empresas que fazem esse tipo de trabalho: Trail of Bits, NCC Group, Cure53, Quarkslab, Least Authority. Os nomes servem só de referência; a escolha é da Lunes.

## 2. Escopo

| Prioridade | Componente | Onde | Tamanho aproximado |
|---|---|---|---|
| **1** | Protocolo: chaves, envelope selado, Double Ratchet, sessões, grupos, roteador, fragmentação, recibos, código de segurança, frase | `apps/mobile/src/protocol/` | ~1.150 linhas |
| **1** | Camada de mensagens: cartão de contato, Messenger, persistência das sessões | `apps/mobile/src/messaging/`, `src/state/messaging.tsx` | ~560 linhas |
| **2** | Segredos no app: cofre (Keychain/Keystore), cifragem em repouso (AES-256-GCM), bloqueio por biometria | `apps/mobile/src/lib/vault.ts`, `persist.ts`, `deviceAuth.ts`, `ui/AppLock.tsx` | ~300 linhas |
| **2** | `piu-node`: pareamento por código, sessões, CSRF, step-up, manifestos assinados de pacotes | `apps/piu-node/src/` | ~550 linhas |
| **3** | Transporte nativo: Nearby Connections (Android) e Bluetooth LE (iOS) | `apps/mobile/modules/piu-transport/` | ~450 linhas, **ainda não compilado** |
| **3** | Painel do provider e site: CSP, headers, sessão no navegador | `apps/provider-panel/`, `apps/site/` | — |

**Fora do escopo** desta rodada: carteira LUNES e liquidação na Mainnet (ainda não implementadas; o modelo está em [proposta](../economia/proposta-modelo-economico.md)) e adapters LoRa/OpenWrt (ainda não existem).

## 3. Desenho criptográfico (resumo)

A especificação completa está no [README do protocolo](../../apps/mobile/src/protocol/README.md). Em resumo:

| Função | Escolha atual | Biblioteca |
|---|---|---|
| Assinatura | Ed25519 | `@noble/curves` 2.x |
| Acordo de chaves | X25519 | `@noble/curves` 2.x |
| Cifra autenticada | XChaCha20-Poly1305, nonce aleatório de 24 bytes | `@noble/ciphers` 2.x |
| Derivação | HKDF-SHA256, um rótulo por uso | `@noble/hashes` 2.x |
| Repouso no app | AES-256-GCM, nonce de 96 bits, nome do campo como dado associado | `@noble/ciphers` 2.x |
| Frase | 12 palavras BIP39 em inglês; derivação própria (não BIP32) | `@scure/bip39` 2.x |
| `piu-node` | token de sessão aleatório de 256 bits (guardado só como SHA-256), TLS com certificado próprio P-256, manifestos Ed25519 | `node:crypto` |

- **Hierarquia de chaves:** semente de 32 bytes → HKDF com rótulos distintos → identidade pública, identidade anônima, chave do nó e semente da carteira. Nada se repete entre elas.
- **Envelope:** cabeçalho de 104 bytes (versão, suíte, tipo, flags, prioridade, saltos, versão da chave, validade, destino de 16 bytes, chave efêmera, nonce, hash do segredo de entrega, tamanho), seguido do corpo cifrado. O cabeçalho, menos os saltos, entra como dado associado e na assinatura. O remetente fica dentro do corpo (remetente selado).
- **Sessões:** Double Ratchet com início simplificado. O segredo inicial vem de DH(identidade A, identidade B), sem pre-keys. Depois da primeira resposta, o destino do envelope passa a derivar do segredo da sessão e muda por dia.
- **Grupos:** chave simétrica por versão, distribuída por envelope direto; só o administrador troca a chave, e não há volta para versões antigas.
- **Contato:** cartão assinado (`piu1:…`) com as chaves públicas, o nome e a validade de 24 h. A confirmação de identidade é o código de segurança 12×5 (hash iterado, como no Signal), conferido pessoalmente.

## 4. Modelo de ameaças

**O que proteger:** conteúdo das mensagens, quem fala com quem (metadados), chaves privadas e frase, integridade das atualizações e dos instaladores, e os créditos de rede.

| Adversário | Capacidade | Expectativa |
|---|---|---|
| Relay curioso | lê e guarda todo envelope que passa | não lê conteúdo nem remetente; liga no máximo envelopes do mesmo dia para o mesmo destino até a sessão se estabelecer |
| Relay ativo | altera, descarta, repete, atrasa, reordena | alteração e repetição detectadas; descarte e atraso não são evitados (só mitigados por múltiplas rotas) |
| Observador de rádio | vê quem transmite, quando e quanto | não vê conteúdo; correlação por tempo e tamanho é **risco residual** (seção 14 dos requisitos), mitigado por preenchimento e atraso aleatório opcionais |
| Contato malicioso | tem o seu cartão e uma sessão com você | não lê outras conversas; não consegue se passar por outra pessoa se o código de segurança foi conferido |
| Ex-membro de grupo | tinha a chave antiga | não lê nada depois da troca de chave |
| Quem rouba o aparelho bloqueado | acesso físico | segredos no Keychain/Keystore e dados cifrados; o bloqueio por biometria é opcional |
| Nó Sybil ou em colusão | muitos nós próprios | não forja entrega; ganho limitado pelos tetos (ver a proposta econômica) |
| Rede local do provider | atacante na mesma LAN do `piu-node` | sem acesso ao painel sem o código de pareamento; pacotes só com manifesto da chave de release fixada |

**Fronteiras de confiança:** o aparelho (confiável depois de desbloqueado) e a malha (não confiável), o `piu-node` e o navegador do provider, e a chave de release da Lunes e os equipamentos.

## 5. Perguntas específicas para a equipe externa

1. **Início de sessão sem pre-keys:** o sigilo das mensagens antes da primeira resposta depende da chave de identidade do destinatário. É aceitável numa malha offline? Há alternativa melhor (pre-keys distribuídas pelo próprio cartão, por exemplo)?
2. **Destino derivado por dia:** a construção `HKDF(chave pública ou segredo da sessão, dia)` limita de forma adequada a ligação entre envelopes? E o primeiro contato?
3. **Grupos:** troca de chave em O(n) e sem sigilo futuro. Quando vale migrar para MLS?
4. **Nonce zero no Double Ratchet:** cada chave de mensagem é usada uma única vez, com nonce zero. Confirmem que não há caminho (inclusive restauração de estado salvo) que reutilize uma chave. O app grava o estado das sessões **antes** de transmitir.
5. **Frase BIP39 com derivação própria:** algum risco em usar a lista e o checksum do BIP39 sem a derivação PBKDF2/BIP32?
6. **Antifraude:** recibo de retransmissão + prova de entrega + auditoria por amostragem. O desafio de auditoria em si ainda não existe; como desenhá-lo sem expor metadados?
7. **Cartão de contato reutilizável por 24 h:** vale passar para uso único?
8. **Web:** a versão web guarda a frase no `localStorage` (só demonstração). Isso está bem sinalizado?
9. **`piu-node`:** pareamento por código de 8 dígitos, válido por 10 minutos, com limite de tentativas. É suficiente até chegarem as passkeys?

## 6. Como rodar e reproduzir

```bash
# Protocolo e mensagens (Node 22+)
cd apps/mobile && npm ci && npm test            # 39 testes, inclusive de ataque
npx tsc --noEmit

# App no navegador, com o "aparelho de teste" (segundo Piu dentro do app)
npx expo start --web    # Nova conversa → Escanear código → Usar o aparelho de teste

# piu-node
cd apps/piu-node && npm ci && npm test          # testes de segurança (pareamento, CSRF, IDOR, step-up)
```

O transporte nativo precisa de um development build (ver o README de `modules/piu-transport`) e de dois ou mais celulares.

## 7. Estado conhecido

- Achados internos, correções e score: [auditoria-2026-11.md](auditoria-2026-11.md).
- Limitações abertas do protocolo: seção "O que ainda NÃO está resolvido" do [README do protocolo](../../apps/mobile/src/protocol/README.md).
- O código nativo nunca foi compilado nem testado em aparelho.

## 8. O que a Lunes precisa decidir para contratar

1. Escopo final (sugestão: prioridades 1 e 2 nesta rodada; 3 depois do teste em aparelhos).
2. Momento: antes do piloto com pessoas reais, e depois de o transporte nativo rodar em aparelhos.
3. Orçamento e prazo. Para ~2.700 linhas de código crítico mais o desenho, revisões desse porte costumam levar de 2 a 4 semanas de trabalho especializado.
4. Política de divulgação do relatório.
