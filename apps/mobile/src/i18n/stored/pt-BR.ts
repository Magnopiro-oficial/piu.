/**
 * Subtítulos e avisos do sistema que a conversa grava (src/lib/storedText.ts). Referência pt-BR:
 * igual, letra por letra, ao texto gravado; os outros idiomas (./<código>.ts) têm as mesmas chaves.
 */
export const storedPtBR = {
  'stored.sub.request': 'pedido de conversa · confira o código',
  'stored.sub.e2e': 'cifrada de ponta a ponta',
  'stored.sub.nearby': 'Por perto · cifrada de ponta a ponta',
  'stored.sys.request': 'Esta pessoa escreveu primeiro. Confira o código de segurança pessoalmente antes de confiar.',
  'stored.sys.keys': 'Chaves trocadas. As mensagens são cifradas neste aparelho e só o contato consegue ler.',
  'stored.sys.nearYou': 'Você aceitou o pedido de Por perto. A conversa é cifrada de ponta a ponta.',
  'stored.sys.nearThem': '{name} aceitou seu convite de Por perto. A conversa é cifrada de ponta a ponta.',
  'stored.sys.nearSomeone': 'A pessoa aceitou seu convite de Por perto. A conversa é cifrada de ponta a ponta.',
  'stored.sys.revoked': 'Este contato revogou um aparelho perdido ou comprometido. Confira o código de segurança pessoalmente antes de confiar em mensagens novas.',
  'stored.sys.leftChannel': 'Você não está mais neste canal.',
  'stored.sys.removed': 'Você foi removido. A chave foi trocada: você não lê nada novo.',
  'stored.sys.groupRevoked': 'Você revogou um aparelho. A chave do grupo foi trocada.',
  'stored.sys.group': 'Grupo cifrado de ponta a ponta. Só quem está na lista de membros tem a chave.',
  'stored.sys.channel': 'Canal cifrado de ponta a ponta. Só quem está na lista de membros tem a chave.',
  'stored.sys.community': 'Comunidade cifrada de ponta a ponta. Só quem está na lista de membros tem a chave.',
};
