/**
 * Textos das notificações da chamada no Android (src/calls/callAlert.ts): aviso contínuo do microfone
 * e nomes dos canais. Atender, Recusar, Desligar e "Chamada de voz" vêm das chaves `call.*`.
 * Referência pt-BR: os outros idiomas (./<código>.ts) têm as mesmas chaves e variáveis
 * (teste em src/calls/__tests__/callAlert.test.ts). Fica fora do dicionário principal: ./index.ts.
 */
export const callAlertPtBR = {
  'callAlert.ongoing': 'Em chamada com {name}',
  'callAlert.ongoingHidden': 'Em chamada',
  'callAlert.channel.incoming': 'Chamadas recebidas',
  'callAlert.channel.incoming.desc': 'Toca e mostra quem está ligando, mesmo com a tela bloqueada.',
  'callAlert.channel.ongoing': 'Chamada em curso',
  'callAlert.channel.ongoing.desc': 'Aviso fixo enquanto o microfone está aberto numa chamada.',
} as const;
