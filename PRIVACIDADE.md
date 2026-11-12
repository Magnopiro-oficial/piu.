# Política de privacidade do Piu

[English](PRIVACY.md)

Última atualização do texto: 11/11/2026.

O Piu não tem servidor, não pede cadastro e não guarda seus dados em lugar nenhum além do seu aparelho. Esta página diz o que sai dele, para quem, e quais limites o desenho do app tem.

## Quem é o responsável
- **Quem guarda os seus dados é você**, no seu próprio aparelho. O projeto Piu não tem servidor: não recebe, não armazena e não usa as suas mensagens, os seus contatos, as suas chaves nem a sua frase de recuperação.
- O Piu não tem conta nem cadastro, não tem telemetria e não mostra anúncios. A comunicação é cifrada de ponta a ponta.
- Contato para privacidade e segurança: lucasmagno.cardeal@gmail.com.
- Crianças e adolescentes: o Piu não coleta dados de ninguém, inclusive de menores de idade. O app tem conversa entre pessoas e carteira de criptomoeda.

## O que fica no seu aparelho
- Conversas, contatos, identidades, chaves e a carteira ficam no celular ou no computador, cifrados.
- Nenhum número de telefone ou e-mail é pedido.
- No Android, o app não entra no backup do sistema: desinstalar apaga os dados. No computador (Piu Desktop), **desinstalar não apaga** a pasta de dados do app (`Piu`, na pasta de dados do seu usuário no sistema), que guarda a frase de recuperação, a chave e o histórico, cifrados pelo chaveiro do sistema. Antes de desinstalar, ou de vender ou emprestar o computador, use **Ajustes → Apagar tudo deste computador**.
- Sem backup feito por você, nada pode ser recuperado.

## Como apagar seus dados e seus direitos
- **No celular:** Perfil → **Apagar dados locais** (segure para confirmar). Apaga chaves, conversas e carteira deste aparelho.
- **No computador:** Ajustes → **Apagar tudo deste computador**.
- Como o Piu não tem servidor, não existe cópia nossa para corrigir, exportar ou apagar: você faz isso no seu aparelho. Para dúvidas e pedidos, use o contato acima.
- **O que não dá para apagar:** transações da carteira ficam públicas e permanentes na blockchain Lunes. Mensagens cifradas que já estejam em outros aparelhos da malha somem sozinhas: cada uma tem validade de até 7 dias, e quem retransmite guarda envelopes de terceiros por até 48 horas.

## O que sai do aparelho
- **Mensagens e chamadas** vão cifradas de ponta a ponta para os aparelhos por perto (Bluetooth, Wi-Fi Direct, Wi-Fi local, rádio LoRa) e, por eles, até o destino. Quem retransmite não vê o remetente nem o conteúdo.
- **Carteira Lunes**, com internet: o app consulta os nós públicos da rede Lunes (`*.lunes.io`) e o indexador `lunes-squid.lunes.io` para mostrar saldo e histórico. O endereço da carteira é enviado a esses serviços junto com o seu IP, então quem opera a infraestrutura da Lunes (ou tem os registros dela) pode ligar o seu IP a esse endereço. Isso acontece quando você abre a aba Carteira, ao puxar para atualizar, e ao criar ou conferir um pedido de pagamento. Não há como escolher outro servidor.
- **Conferência de pedidos de pagamento:** o app consulta o saldo do endereço do pedido nos mesmos nós da Lunes.
- **Modo gateway (opcional, vem desligado):** se você liga o aparelho como gateway (a ponte com a internet), ele consulta a Lunes (altura do bloco finalizado, a cada 60 segundos) e envia à rede transações já assinadas por terceiros, recebidas pela malha. No Piu Desktop, o gateway é uma opção do ponto guardião; fora dele, só liga por configuração avançada (`PIU_GATEWAY=1`).
- **Aviso de novas versões**, com internet. O app consulta as versões publicadas no GitHub (`api.github.com`), que vê o seu IP:
  - **No celular Android:** vem ligado. A consulta acontece no máximo uma vez por dia. Para desligar: Ajustes → "Avisar sobre novas versões". No iPhone não há consulta automática.
  - **No Piu Desktop:** vem ligado. A consulta acontece cada vez que você abre o Piu. Para desligar: Ajustes → Sistema → "Avisar quando sair versão nova". Quem veio de uma versão antiga com a opção "Perguntar" continua com o aviso desligado. O download da atualização é feito do GitHub só quando você pede.
- **Teste de internet do Piu Desktop (ponto guardião):** com o gateway desligado, o Desktop não consulta nada fora da sua rede local; ele só olha, no próprio computador, se existe rota de saída. Quando você liga o gateway (ou pede o teste de internet), ele abre e fecha uma conexão com `1.1.1.1` (Cloudflare) e `9.9.9.9` (Quad9), na porta 443, sem enviar nenhum dado do Piu. Esses dois serviços veem o seu IP. A tela avisa disso antes.
- **Teste da rede local (Piu Desktop, ponto guardião):** abre e fecha conexões com endereços comuns de roteador de redes de casa (como `192.168.0.1`), sem enviar dados. Isso não sai para a internet.
- **Links abertos por toque no navegador:** o explorador `blockexplorer.lunes.io` e, para locais recebidos, o Apple Maps (iPhone) ou o OpenStreetMap (Android e outros). O site aberto vê o seu IP e a coordenada do link.

## O que seus contatos e retransmissores recebem
- **Seus contatos** recebem o nome e a foto da identidade que você usa com eles. O endereço da sua carteira Lunes vai cifrado aos seus contatos, junto com a sua identidade, enquanto "Compartilhar meu endereço Lunes" estiver ligado em Privacidade. Em instalação nova essa opção vem desligada: o endereço só vai se você ligar. Quem já usava o Piu antes dessa mudança continua com ela ligada; desligue para não enviá-lo.
- **Retransmissão:** o seu aparelho guarda por até 48 horas envelopes cifrados de outras pessoas para repassá-los, e os aparelhos por perto fazem o mesmo com os seus. Cada envelope tem um cabeçalho legível por quem retransmite: tipo (direto ou grupo), se é mídia ou ao vivo, prioridade, validade, tamanho e um endereço de entrega que muda por dia. No primeiro contato, esse endereço é calculado a partir da chave pública de quem recebe. Depois que a conversa está estabelecida (você já recebeu uma resposta do contato), ele passa a ser calculado a partir de um segredo que só vocês dois têm.
- **Limites do desenho (a segurança tem limites):**
  - Quem retransmite e conhece a chave pública de alguém consegue calcular o endereço de entrega do dia e ver quando chegam envelopes de primeiro contato para essa pessoa, com horário, faixa de tamanho e prioridade. Em grupos, dá para ligar as mensagens do mesmo grupo e notar troca de chave. Remetente e conteúdo continuam ocultos. O preenchimento de tamanho (Privacidade) vem ligado; desligá-lo expõe mais o tamanho real.
  - **Sigilo futuro limitado:** as primeiras mensagens de uma conversa, antes da primeira resposta do contato, e as mensagens de grupo não têm sigilo futuro. Quem gravou o tráfego e depois obtiver a frase de recuperação do destinatário consegue ler essas mensagens. Depois da primeira ida e volta, as conversas entre duas pessoas passam a ter sigilo futuro.
  - O IP é visível ao aparelho com que você se conecta (Wi-Fi local, Wi-Fi Direct) e aos serviços listados acima.

## Permissões do aparelho e para que servem
| Permissão | Para que serve |
|---|---|
| Câmera | Ler códigos QR (contato, pagamento, pareamento) e tirar a foto do seu perfil, se você quiser. |
| Microfone | Chamadas de voz. |
| Notificações | Avisar de mensagens e chamadas. Chamadas podem aparecer em tela cheia. |
| Bluetooth, Wi-Fi e rede local | Achar aparelhos por perto e conversar com eles (o sistema pede conforme a versão do aparelho). |
| Biometria | Desbloquear o app, se você ligar. |
| Fotos e arquivos | Enviar e salvar fotos e documentos que você escolher. |

O app também usa identificadores locais para ser achado por perto: um nome de serviço na rede local (`piu-` mais um trecho de uma etiqueta sem relação com o seu nome) enquanto o Wi-Fi local está ligado.

## Componentes do Google no Android
- O **Wi-Fi Direct** usa o Nearby Connections, do Google Play Services. Desligue o Wi-Fi Direct na aba Rede para não usá-lo.
- A **leitura de QR** usa o Google ML Kit, que pode enviar ao Google dados técnicos de uso, conforme as regras do Google.

## Serviços de terceiros
Lunes (nós e indexador), GitHub, Cloudflare e Quad9 (teste de internet do Piu Desktop), Google e, nos links abertos por você, Apple ou OpenStreetMap tratam seu IP conforme as políticas deles, e podem ficar fora do Brasil e da União Europeia.

## O que o Piu não faz
- Não mostra anúncios.
- Não tem conta, telemetria, análise de uso nem rastreamento próprios.
- Não vende nem compartilha dados: o projeto não tem os seus dados.

## Mudanças nesta política
Mudanças ficam neste arquivo, com a data no topo. O histórico está no repositório do projeto.

## Contato
Privacidade e segurança: lucasmagno.cardeal@gmail.com. Dúvidas gerais e problemas: https://github.com/Magnopiro-oficial/piu./issues (público: não coloque dados pessoais lá).
