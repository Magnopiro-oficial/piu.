# Desktop como guardião de ponto Piu

Telas: `design/handoff/design/Piu 12 Desktop briefing.dc.html` (E4d início, E4a rede, E4 teste automático,
E4b nível, E4e antes de ativar, E4c resumo, E5 painel e QR, E5a pausado, E5b rede caiu, E5c roteador
isolando, E5d encerrar, E5f cartaz). Código: `apps/desktop/src/main/guardian/*`,
`apps/desktop/src/shared/guardian.ts`, `apps/desktop/src/renderer/screens/Guardian.tsx`.
Testes: `apps/desktop/test/guardian.test.ts`.

Abre pelo trilho (ícone de malha, "Ponto Piu") ou em Ajustes → Rede → "Usar como ponto Piu".

## O que é

O computador fica ligado e parado numa rede e ajuda quem passa por ela a trocar mensagens sem internet.
Ele não cria a rede (um computador comum não vira roteador): usa a rede em que já está. Para outra rede,
conecte o computador nela e volte.

| Nível | O que faz | Disco |
|---|---|---|
| Multiplicador | Os aparelhos se encontram pelo ponto; repassa na hora para quem está conectado. | Nada. Buffer de 16 MB só em memória, até 10 min. |
| Guardião | Guarda envelopes cifrados de terceiros até o destinatário (ou outro nó) aparecer. | 256 MB, 512 MB (padrão) ou 1 GB · 1, 3 ou 7 dias (padrão). |
| Guardião + app | Também entrega o app a quem não tem. | Só com o APK do Piu baixado **e conferido** (assinatura + SHA-256) neste computador. Hoje o desktop não baixa o APK: o nível aparece desligado, com o motivo. |
| Gateway (papel a mais) | Envia à Lunes as transferências assinadas que chegam pela malha e devolve o recibo. | Só com internet (o teste confere). Desligado por padrão. |

Limites (regra única, igual no celular em `apps/mobile/src/lib/pointCore.ts`): até 1 GB e até 7 dias, padrão 512 MB · 7 dias. Um envelope vale no máximo 7 dias no protocolo
(`MAX_TTL_SEC` em `apps/mobile/src/protocol/envelope.ts`): guardar por mais tempo não adiantaria. O roteador
do protocolo guarda em memória e grava cifrado em disco ao pausar, ao fechar e a cada minuto; por isso o teto é
1 GB nesta versão.

## Chave do ponto

- Semente **nova e aleatória** (32 bytes) ao ativar, nunca derivada da frase da pessoa.
- Chave técnica do ponto: `deriveNodeKey(kdf(semente, "piu/v1/ponto", "ponto/node"))`. Os vizinhos LNNP veem
  só o id do ponto (16 hex). Nada liga o ponto às identidades pública/anônima nem à chave de nó da pessoa.
- `<userData>/guardian/point.bin`: configuração + semente, AES-256-GCM com a chave de dados do cofre do sistema
  (Keychain / cofre do Windows / chaveiro do Linux). Sem cofre, o ponto não ativa.
- `<userData>/guardian/store.bin`: envelopes de terceiros, AES-256-GCM com chave derivada da semente do ponto.
- **Encerrar** (E5d) sobrescreve e apaga os dois arquivos (a semente some; o que sobrasse fica ilegível).

## Teste automático (E4)

Uma etapa a cada 1,1 s depois que o resultado real chega (sem movimento: tudo de uma vez). Só leitura da rede:

1. **Aparelhos se enxergam**: escuta os anúncios LNNP (UDP 8423) por ~3,5 s e conta etiquetas distintas de
   outros endereços. Nenhuma: aviso (rede vazia agora ou roteador isolando clientes), não bloqueia.
2. **Rede de casa protegida**: sondas TCP **só de conexão** (abre e fecha; nenhum byte enviado, nenhuma senha)
   nas portas 80/443 de roteadores comuns de *outras* redes privadas (192.168.0.1, 192.168.1.1,
   192.168.15.1, 192.168.100.1, 10.0.0.1, 10.0.0.138, 172.16.0.1, menos os da própria sub-rede). Conectou ou
   recusou (= existe alguém ali): esta rede alcança outra rede privada → aviso para usar uma rede de visitantes.
   O painel do roteador desta rede responder é normal e só aparece no texto.
3. **Internet**: sem o gateway ligado, só uma estimativa local (há rota de saída nesta rede?), sem nenhuma
   consulta externa. Ao ligar o gateway (ou pedir o teste), conexão TCP a 1.1.1.1:443 e 9.9.9.9:443 (abre e
   fecha), com aviso na tela antes. O ponto não usa a internet; ela só libera o papel de gateway.
4. **Capacidade**: espaço livre no disco diante do menor limite (256 MB).

Sem interface de rede local ou sem espaço: falha e "Continuar" não acende.

## Rede

- O nome do Wi-Fi vem do sistema quando ele diz (`networksetup`/`ipconfig getsummary` no macOS, `iwgetid` ou
  `nmcli` no Linux, `netsh wlan show interfaces` no Windows), com tempo limite curto e sem shell. Sem nome:
  "Rede local · 192.168.0.0/24". **O Piu nunca lê a senha do Wi-Fi do sistema.**
- O ponto fica na rede (nome + sub-rede) em que foi ativado. Vigia a cada 10 s:
  - sem rede → `down` (E5b) e volta sozinho quando a rede volta;
  - outra rede → `changed`: para e pergunta ("Continuar nesta rede" ou encerrar). A senha digitada para o QR,
    que era da rede antiga, é apagada;
  - pelo menos dois aparelhos conectados e todos caíram no mesmo minuto, sem ninguém voltar em 30 s →
    `isolating` (E5c) até "Testar de novo" achar aparelhos (ou alguém reconectar).

## QR e cartaz

- QR padrão de Wi-Fi `WIFI:T:WPA;S:<rede>;P:<senha>;;` (rede aberta: `T:nopass`), com `\ ; , : "` escapados.
  **Só** com a senha que a pessoa digita no painel (cifrada em `point.bin`); sem ela, o painel pede a senha e
  não mostra QR. Por cabo (sem nome de Wi-Fi) não há QR: quem está na mesma rede encontra o ponto sozinho.
- O id do ponto aparece embaixo do nome (texto), não dentro do QR (o formato WIFI: não tem campo para isso).
- "Copiar" põe o PNG do QR na área de transferência (o processo principal só aceita PNG em data URL pequeno).
- "Cartaz" (E5f) abre o diálogo de impressão do sistema (`window.print()`); `@media print` deixa só o cartaz
  na folha A4. A linha "abra piu.local" do protótipo não existe no computador (não há página local); o cartaz
  diz "Precisa do app Piu no celular · ponto <id>".

## Painel (E5): só contagens reais

| Número | De onde vem |
|---|---|
| aparelhos hoje | enlaces LNNP distintos no dia, contados por hash do id salgado com o dia (não liga um dia ao outro); nenhum id vai à interface |
| recibos de repasse | recibos assinados pela chave do ponto ao repassar a 1ª cópia de um envelope de terceiros. O protótipo dizia "entregas comprovadas": a prova de entrega volta cifrada ao remetente e o ponto não a vê |
| guardadas / espaço | envelopes de terceiros no roteador agora e os bytes deles, diante do teto |
| repassadas | envelopes enviados a outros aparelhos desde que o ponto foi criado |
| dados hoje | bytes de envelopes que entraram e saíram hoje, só rede local |

Recompensas: "O programa ainda não abriu" (desligadas), como no protótipo. Nada de LUNES se move ao ativar.

## Segurança

- IPC: os métodos `guardian*` passam pela mesma barreira do resto (só a janela do Piu, quadro principal, URL do
  próprio renderer) e ficam fechados com o Piu bloqueado. Configuração conferida campo a campo
  (`sanitizeGuardianConfig`): nome sem `<>`/controle, nível, espaço e dias só das listas.
- O ponto não abre envelope nenhum: o roteador não tem identidade. Com gateway, abre só cargas endereçadas à
  identidade pública do gateway de transações (`GATEWAY_TX_IDENTITY`), como o piu-node.
- O transporte do ponto é outro `LnnpLanTransport`, com a chave do ponto. A porta TCP padrão (8422) costuma
  estar com o nó da pessoa; o ponto pega uma porta livre e anuncia a real no UDP 8423 (`PIU_POINT_PORT` fixa).

## Não feito (honesto)

- Baixar o APK do Piu pelo desktop (com o fluxo assinatura + SHA-256 do atualizador) e servi-lo na rede local:
  sem isso, "Guardião + app" fica desligado com o motivo.
- O gateway do ponto não entrega pacotes de evidências (sem caixa do validador no computador).
- O guardião guarda em memória até 1 GB; um armazenamento em disco por envelope permitiria mais.
