# Auditoria AppSec — 06/11/2026

Análise estática, somente leitura, de todas as aplicações do monorepo. Nenhum exploit foi executado contra nó ou Mainnet.
Detalhes de cada achado (evidência, cenário, correção ANTES/DEPOIS, se muda comportamento/protocolo) nos relatórios por escopo:

| Escopo | Relatório | Crít. | Alta | Média | Baixa | Nota |
|---|---|---|---|---|---|---|
| piu-node + settlement | [node-settlement.md](node-settlement.md) | 1 | 2 | 5 | 11 | 58 |
| Piu Desktop | [desktop.md](desktop.md) | 0 | 1 | 5 | 6 | 72 |
| Celular + site | [mobile-site.md](mobile-site.md) | 0 | 1 | 3 | 7 | 80 |
| Painel e Desktop do Provider | [provider.md](provider.md) | 0 | 0 | 2 | 5 | 86 |
| **Geral** | | **1** | **4** | **15** | **29** | **70** |

A nota geral é a média (74) com desconto pela crítica aberta no liquidante.

## Resumo executivo

A base é boa: criptografia real (@noble/@scure, XChaCha20-Poly1305, Double Ratchet, scrypt), nenhum base64 fingindo cifra,
UUIDs em vez de ids sequenciais, Helmet + CSP estrita + sem CORS aberto no nó, sessão `__Host-` HttpOnly/SameSite=Strict,
CSRF, rate limit, JSON Schema estrito, Electron com contextIsolation/sandbox/fuses, nenhum XSS encontrado, nenhum segredo nos
bundles, nenhum log de dado sensível no frontend e `npm audit --omit=dev` sem high/critical em nenhum app.
A chave da carteira do provider fica só no celular (confirmado no bundle).

O risco se concentra em três frentes:

1. **Economia do liquidante (crítica):** provas de entrega forjáveis drenam o orçamento de recompensas (C-01) e um relay
   pode anular/roubar crédito de terceiros (A-01). Exige mudança de protocolo.
2. **Perda ou troca da frase de recuperação:** Desktop recria a chave do cofre se o Keychain negar acesso (desktop A-01);
   deep link `piu://restore|migrate` sobrescreve a frase do celular (mobile A-01); frase revelada sem reautenticação em
   aparelho sem bloqueio (mobile M-01, desktop M-01).
3. **Superfície de rede local sem autenticação:** beacons UDP fazem o nó/desktop discar sem limite (node A-02, desktop B-03),
   handshakes/slots esgotáveis (node M-04, desktop M-03).

## Top vulnerabilidades (OWASP)

| Id | Sev. | OWASP | Onde | Resumo |
|---|---|---|---|---|
| node C-01 | Crítica | A04 Insecure Design | settlement/src/validator.ts:101 | ackHash vem do próprio segredo; prova sempre confere |
| node A-01 | Alta | A04 | settlement/src/protocol/receipts.ts:97 | última prova sobrescreve; vagas pelo `at` mais cedo |
| node A-02 | Alta | API4 Resource Consumption | piu-node/src/relay/lan.ts:269 | beacon UDP → discagem ilimitada (DoS/refletor) |
| desktop A-01 | Alta | A04 / A08 | desktop/src/main/vault.ts:30 | cofre ilegível vira "novo"; identidade sobrescrita |
| mobile A-01 | Alta | M3 / A01 | mobile/src/app/_layout.tsx:66 | deep link restore/migrate troca a frase sem aviso |
| desktop M-05 | Média | A05 | desktop/src/main/main.ts:202 | `--remote-debugging-port` aceito no app empacotado |
| mobile M-03 | Média | A08 / M7 | mobile/android/app/build.gradle:124 | release cai na chave de debug se faltar a variável |
| node M-02 | Média | A08 | piu-node/src/store.ts:106 | state.json corrompido vira estado vazio (novo dono) |
| provider M-01 | Média | A07 | provider-desktop/src/main.ts:165 | auto-pareamento injeta código reaproveitável no reauth |

## Recomendações

- Redesenhar a prova de entrega antes de liberar qualquer pagamento de recompensa real (só nós registrados, prova assinada pelo destino).
- Toda operação sobre a frase falha fechado: erro visível em vez de recriar; troca de frase só com confirmação explícita; revelar exige autenticação.
- Limitar discagens/handshakes vindos da LAN e expirar ofertas de pareamento.
- Bloquear build de release sem a chave de release; remover permissões Android não usadas.
- Apple Developer ID + notarização e assinatura Windows quando houver orçamento; chave GPG para SHA256SUMS (scripts/sign-release.sh já pronto).
