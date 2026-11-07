# Biometria ligada ao cofre (auditoria 2026-11-06, B-01)

Status: implementado em `apps/mobile/src/lib/phraseVault.ts` (regras, testadas no Node) e `src/lib/vault.ts` (ligação com `expo-secure-store` 58.0.2 e `expo-local-authentication`).

## Problema

Até aqui a frase de recuperação ficava num item do `SecureStore` **sem** `requireAuthentication`. A biometria (`confirmDevice`) era só uma pergunta da interface: num aparelho com root/Frida, pular o `confirmDevice` bastava para ler a frase, assinar com a carteira ou mandar a frase para "outro aparelho". A frase também era lida na abertura e ficava na memória do JS o tempo todo.

## O que precisa continuar funcionando sem pedir nada

- Abrir o app, ler e mandar mensagens, recibos de retransmissão e o serviço de retransmissão em segundo plano: tudo isso usa as **identidades** e a **chave do nó do dia**, derivadas da semente do Piu (`seedFromPhrase`, HKDF com rótulo `phrase/seed`).
- O AsyncStorage cifrado (`lib/persist.ts`) precisa da **chave de dados** a cada abertura.
- Mostrar o endereço da carteira e o saldo.

Nada disso pode depender de biometria: o sistema não mostra o pedido de biometria com o app em segundo plano (`expo-secure-store` recusa: "Cannot display biometric prompt when the app is not in the foreground") e pedir biometria a cada abertura mudaria o produto.

## Separação escolhida

A frase gera duas árvores independentes:

| Derivado | Como | Para quê | Onde fica |
|---|---|---|---|
| Semente do Piu (32 bytes) | HKDF(entropia, `piu/v0/root`, `phrase/seed`) | identidades, chave do nó | item **sem** autenticação `piu.keys.v2` |
| Chave da carteira sr25519 | PBKDF2-SHA512(entropia, 2048) → `secretFromSeed` | assinar transferências | **não é guardada**; deriva da frase na hora |
| Endereço da carteira | chave pública da anterior | mostrar, saldo | `piu.keys.v2` (é público) |

A semente é de mão única: com ela **não** se chega à frase nem à chave da carteira (KDFs diferentes sobre a entropia). Então:

- `piu.keys.v2` (sem autenticação, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`): `{ v: 2, seed, wallet, at, known?, retryAt? }`. Abre o app e serve o segundo plano. Quem rouba isso num aparelho comprometido lê as mensagens (como já lia pelo AsyncStorage), mas **não** leva a frase nem o dinheiro.
- `piu.phrase.bio.v1` (`requireAuthentication: true`): a frase. Só é lida para **revelar o backup, assinar na carteira (inclusive pedidos do computador ligado) e transferir as chaves para outro aparelho**. A leitura abre o pedido de biometria do sistema e só decifra com a chave do Keystore liberada pela biometria (CryptoObject). Isso substitui o `confirmDevice` nesses três lugares.
- `piu.phrase.v1` (o item antigo, sem autenticação): continua existindo enquanto a frase não foi movida (ver as regras abaixo).
- A chave de dados (`piu.datakey.v1`) **continua sem autenticação**: é necessária a cada abertura e em segundo plano.

## Por que a frase não vai para o item com biometria logo de cara

`expo-secure-store` 58 no Android (conferido em `node_modules/expo-secure-store/android/.../AuthenticationHelper.kt` e `AESEncryptor.kt`):

- `requireAuthentication` exige **biometria forte** (`BIOMETRIC_STRONG`), sem PIN como alternativa;
- a chave do Keystore usa `setUserAuthenticationRequired(true)` sem prazo de validade, então o sistema a **invalida para sempre** quando a pessoa cadastra uma digital/rosto nova, apaga todas as biometrias ou tira o bloqueio de tela;
- invalidada, `getItemAsync` devolve `null` (engole `KeyPermanentlyInvalidatedException`) — o item fica ilegível.

No iPhone a opção vira `biometryCurrentSet`: mesma coisa (troca de Face ID/Touch ID invalida).

Ou seja: com a frase **só** no item com biometria, cadastrar uma digital nova apagaria a frase. Para quem nunca anotou a frase isso é perda definitiva da carteira (as conversas continuariam, porque a semente está no outro item).

### Alternativas consideradas

1. **Cópia de reserva cifrada sem biometria.** Qualquer reserva que o app consiga abrir sozinho é equivalente ao item antigo para o atacante do achado (root/Frida lê do mesmo jeito). Não protege nada; descartada.
2. **Reserva cifrada com uma senha da pessoa.** O app não tem senha própria; o único segredo que a pessoa escolhe é a senha do arquivo de backup — e esse arquivo já é a reserva. Não precisa de outra.
3. **Biometria sempre, e restaurar pela frase quando invalidar.** Seguro contra o atacante, mas perde a frase de quem ainda não fez backup. Descartada como regra geral.
4. **Escolhida: mover para a biometria só quem já tem cópia da frase fora do aparelho.** A frase passa para o item com biometria quando (a) o aparelho tem biometria forte cadastrada **e** (b) a pessoa já tem a frase fora do aparelho: concluiu o backup (`set.backupDone`, frase anotada e conferida ou arquivo cifrado salvo) **ou** restaurou digitando a frase/abrindo o arquivo de backup (`known`). Se depois a biometria mudar, a pessoa digita a frase de novo (ou abre o arquivo) numa tela própria, sem perder nada: as conversas seguem funcionando o tempo todo e a frase digitada é conferida contra a semente guardada.

Enquanto (a) ou (b) não valem, fica como antes: item antigo + `confirmDevice` (biometria/PIN) — e as recusas de "sem bloqueio de tela" da correção M-01 continuam.

## Migração das instalações existentes

1. **Na abertura (sem pedir nada):** se não existe `piu.keys.v2`, lê o item antigo (sem autenticação, como sempre), calcula a semente e o endereço da carteira, grava `piu.keys.v2` com `at: 'legacy'`. O item antigo **não** é apagado. A frase não fica mais na memória do JS depois disso: só a semente.
2. **No próximo uso sensível** (revelar backup, assinar, transferir para outro aparelho) — momento em que a pessoa espera o pedido de biometria — se as condições (a) e (b) valem e não há espera de nova tentativa:
   1. lê o item antigo;
   2. apaga um resto de tentativa anterior do item novo e grava a frase em `piu.phrase.bio.v1` (no Android o sistema já pede a biometria aqui; no iPhone a criação não pede);
   3. **lê de volta** com biometria e confere palavra por palavra e a semente;
   4. só então grava `at: 'bio'` em `piu.keys.v2` e **apaga o item antigo**.
   A leitura do passo 3 é a autenticação da operação (não há `confirmDevice` a mais): 2 pedidos no Android, 1 no iPhone, só desta vez.
3. **Se algo falhar:** o item novo é apagado, o antigo fica, `at` continua `legacy`.
   - Pessoa cancelou o pedido → a operação é cancelada (como cancelar a biometria hoje); tenta de novo na próxima vez.
   - Outro erro (biometria indisponível, `NSFaceIDUsageDescription` ausente no iPhone, leitura diferente) → marca `retryAt` = agora + 24 h e segue a operação pelo caminho antigo (`confirmDevice` + item antigo). Nunca bloqueia o uso.
4. **Travou no meio** (app morto entre o passo 4a e 4b): `at: 'bio'` com o item antigo ainda presente → na próxima leitura com biometria bem-sucedida o item antigo é apagado. Se a leitura com biometria der `null`, o item antigo ainda serve (volta para `legacy`).

## Depois de migrado

| Situação | O que acontece |
|---|---|
| Uso normal | Pedido de biometria do sistema ao revelar/assinar/transferir. |
| Pessoa cancela | Operação cancelada, nada muda. |
| Bloqueio por tentativas, tempo esgotado | Operação cancelada; tenta de novo depois. |
| Biometria nova cadastrada / biometria apagada / bloqueio de tela removido | O sistema invalida a chave; a leitura dá `null` ou "sem biometria". A tela **"Confirmar a frase de novo"** (`/vault-recover`) explica, pede as 12 palavras (ou o arquivo de backup + senha) e confere contra a semente guardada. Certo → volta para o item antigo (`at: 'legacy'`, `known: true`); a próxima operação sensível move de novo para a biometria. Conversas, contatos e histórico não são tocados e não há aviso de troca de aparelho para os contatos (a identidade é a mesma). |
| Frase digitada é de outra identidade | Recusada ("essa frase não é a deste aparelho"). Trocar de identidade continua sendo "Apagar dados locais" + restaurar. |
| "Apagar dados locais" | Apaga os três itens. |
| Restaurar / criar identidade | Grava o item antigo + `piu.keys.v2` (`at: 'legacy'`) e apaga o item com biometria anterior. Restaurar pela frase/arquivo marca `known: true`. |

## Aparelho sem bloqueio de tela ou sem biometria forte

`requireAuthentication` não é possível (Android exige biometria forte; iPhone exige Face ID/Touch ID). Fica o armazenamento de antes (item antigo, sem autenticação, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) mais o `confirmDevice`:

- só PIN/padrão/senha: `confirmDevice` pede o PIN; nada muda em relação à versão anterior;
- nenhum bloqueio: revelar o backup e transferir para outro aparelho recusam com "ative um bloqueio de tela" (M-01); assinar na carteira recusa como antes;
- se a pessoa cadastrar biometria depois, a próxima operação sensível migra.

Na web (demonstração) nada muda: `localStorage`, sem cofre.

## Riscos e limites conhecidos

- **Voltar para uma versão antiga do app depois da migração:** a versão antiga só conhece `piu.phrase.v1`, que foi apagado; ela abriria como aparelho novo. Recuperação: restaurar pela frase/arquivo (a pessoa tem backup por construção da regra (b)). Atualizações normais não são afetadas.
- **Aparelho comprometido (root):** a semente em `piu.keys.v2` e a chave de dados continuam legíveis sem biometria → o atacante lê as mensagens e pode se passar pela identidade de mensagens enquanto estiver no aparelho. A frase e a carteira deixam de estar ao alcance (depois da migração). É o máximo possível sem pedir biometria a cada abertura e em segundo plano.
- **Antes do backup** a frase continua sem biometria (por escolha: evitar perda). A tela de backup é onde a pessoa é levada a anotar a frase; depois disso o próximo uso sensível migra.
- **iPhone:** sem `NSFaceIDUsageDescription` no `Info.plist` (o app.json não usa o plugin `expo-secure-store`), aparelhos com Face ID não conseguem gravar o item com biometria → migração falha "por outro erro" e fica no caminho antigo, com nova tentativa a cada 24 h. Ligar o plugin com `faceIDPermission` é mudança de configuração nativa separada (iOS é secundário).
- **Assinatura com o app voltando do segundo plano:** o pedido de biometria só aparece com o app em primeiro plano; os fluxos sensíveis são todos iniciados por toque na tela.
- Strings em JS não podem ser zeradas: a frase lida para uma operação fica na memória até o coletor de lixo; não fica mais guardada no estado do app.
- Precisa de teste em aparelho real (emulador não exige biometria de verdade): migração, cancelamento, cadastro de digital nova → tela de recuperação.
