/**
 * Textos de "Conectar ao computador" (src/app/link-desktop.tsx). Referência pt-BR: os outros idiomas
 * (./<código>.ts) têm as mesmas chaves e variáveis (teste de paridade em src/lib/__tests__/i18n.test.ts).
 * `{app}` e `{action}` aparecem em negrito na tela.
 */
export const linkDesktopPtBR = {
  'linkDesktop.title': 'Conectar ao computador',
  'linkDesktop.disconnected': 'Computador desconectado',
  'linkDesktop.disconnected.body': 'O Piu Desktop não recebe mais nada deste celular.',
  'linkDesktop.idle.title': 'Use o Piu no computador',
  'linkDesktop.idle.body': 'No computador, abra o {app} e escolha {action}. Depois leia o QR que aparece lá.',
  'linkDesktop.idle.action': 'Conectar celular',
  'linkDesktop.idle.keys': 'As chaves ficam só no celular. O computador mostra as conversas e envia pelo celular, cifrado pela rede local (TLS com o certificado do QR), enquanto os dois estiverem na mesma Wi-Fi.',
  'linkDesktop.unavailable': 'Conectar ao computador precisa do app Piu instalado (não funciona no Expo Go nem no navegador).',
  'linkDesktop.scan': 'Ler o QR do computador',
  'linkDesktop.scan.hint': 'Aponte a câmera para o QR do computador. Ele muda a cada 30 segundos; se demorar, leia o novo.',
  'linkDesktop.connecting': 'Conectando…',
  'linkDesktop.connecting.body': 'Os dois precisam estar na mesma Wi-Fi. Nada sai do celular antes de você conferir as palavras.',
  'linkDesktop.confirm.title': 'Confiram as 3 palavras',
  'linkDesktop.confirm.body': 'O computador mostra 3 palavras na tela. Elas precisam ser exatamente estas, na mesma ordem:',
  'linkDesktop.confirm.bodyNamed': 'O computador ({name}) mostra 3 palavras na tela. Elas precisam ser exatamente estas, na mesma ordem:',
  'linkDesktop.confirm.prompt': 'No computador:',
  'linkDesktop.confirm.warn': 'Se forem diferentes, cancele: alguém na mesma rede pode estar se metendo no caminho. Nada foi enviado ainda.',
  'linkDesktop.confirm.same': 'São iguais · conectar',
  'linkDesktop.confirm.different': 'Diferentes · cancelar',
  'linkDesktop.connected.name': 'Computador conectado',
  'linkDesktop.connected.since': 'conectado desde {time}',
  'linkDesktop.connected.frames': '{sent} quadros enviados · {received} recebidos',
  'linkDesktop.connected.body': 'O computador só vê o que este celular manda, cifrado. Se o celular sair da Wi-Fi ou fechar o app, a conexão cai e o computador para de atualizar.',
  'linkDesktop.disconnect': 'Desconectar',
  'linkDesktop.error': 'A conexão caiu.',
  'linkDesktop.retry': 'Tentar de novo',
  'linkDesktop.footer': 'A chave e o certificado do computador vêm pela câmera, então quem está na mesma Wi-Fi não lê o que o celular manda nem consegue se passar pelo computador. As 3 palavras denunciam quem tentar se meter no caminho. Sem servidor: só os dois aparelhos.',
} as const;
