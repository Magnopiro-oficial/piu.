# Política de privacidade do Piu

[English](PRIVACY.md)

O Piu não tem servidor, não pede cadastro e não guarda seus dados em lugar nenhum além do seu aparelho.

## O que fica no seu aparelho
- Conversas, contatos, identidades, chaves e a carteira ficam no celular ou no computador, cifrados.
- Nenhum número de telefone ou e-mail é pedido.
- Desinstalar o app apaga tudo. Sem backup feito por você, nada pode ser recuperado.

## O que sai do aparelho
- **Mensagens e chamadas** vão cifradas de ponta a ponta para os aparelhos por perto (Bluetooth, Wi-Fi Direct, Wi-Fi local, rádio LoRa) e, por eles, até o destino. Quem retransmite não vê remetente, conteúdo nem grupo.
- **Carteira Lunes**, com internet: o app consulta os nós públicos da rede Lunes (`*.lunes.io`) e o indexador `lunes-squid.lunes.io` para mostrar saldo e histórico. Esses serviços veem o seu IP e o endereço consultado.
- **Aviso de novas versões**, com internet e se estiver ligado (Ajustes): no máximo uma vez por dia, o app consulta as versões publicadas no GitHub (`api.github.com`), que vê o seu IP.

## Componentes do Google no Android
- O **Wi-Fi Direct** usa o Nearby Connections, do Google Play Services. Desligue o Wi-Fi Direct na aba Rede para não usá-lo.
- A **leitura de QR** usa o Google ML Kit, que pode enviar ao Google dados técnicos de uso, conforme as regras do Google.

## O que o Piu não faz
- Não mostra anúncios.
- Não tem análise de uso nem rastreamento próprios.
- Não vende nem compartilha dados: o projeto não tem os seus dados.

## Contato
Dúvidas e pedidos: https://github.com/Magnopiro-oficial/piu./issues
