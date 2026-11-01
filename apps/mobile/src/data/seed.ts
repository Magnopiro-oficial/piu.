// Dados de exemplo do protótipo (design/PiuApp.dc.html), ilustrativos.
import type { Chat, ChannelType, Member } from './types';

const you = { n: 'Você', k: 'Este aparelho' };
const galpao = { n: 'Galpão · OpenWrt', k: 'Home Node' };
const praca = { n: 'Gateway Praça · mini-PC', k: 'Gateway Local' };


export function seedChats(): Chat[] {
  return [
    { id: 'marina', ident: 'public', kind: 'direct', name: 'Marina Alves', initials: 'MA', time: '14:32', unread: 2, inv: true,
      sub: 'por perto · 2 saltos', via: 'Wi-Fi Mesh · 2 saltos', viaIcon: 'hub',
      route: { nodes: [you, { n: 'Pixel 7a · 9C21', k: 'Mobile Node' }, galpao, { n: 'Marina Alves', k: 'Destino' }], vias: ['Bluetooth LE', 'Wi-Fi Mesh', 'Wi-Fi Direct'] },
      msgs: [
        { id: 'm1', from: 'them', text: 'Oi! Você vai no mutirão hoje?', time: '14:10' },
        { id: 'm2', from: 'me', text: 'Vou sim, saio daqui a pouco.', time: '14:12', status: 'entregue' },
        { id: 'm3', from: 'them', text: 'A internet caiu no bairro inteiro, mas aqui tá chegando tudo pelo Piu.', time: '14:20' },
        { id: 'm4', from: 'me', text: 'Pois é! Tô vendo 6 nós por perto.', time: '14:21', status: 'entregue' },
        { id: 'm5', from: 'them', text: 'Chego em 10 min, estou perto da praça.', time: '14:32' },
      ] },
    { id: 'mutirao', ident: 'public', kind: 'group', name: 'Mutirão Vila Esperança', initials: 'VE', time: '14:05', unread: 5,
      sub: '18 membros · 6 por perto', via: 'Wi-Fi Mesh · 1 salto', viaIcon: 'hub',
      route: { nodes: [you, galpao, { n: '18 membros', k: 'Grupo · chave de grupo v4' }], vias: ['Bluetooth LE', 'Wi-Fi Mesh'] },
      msgs: [
        { id: 'g1', from: 'them', sender: 'Lia', text: 'Alguém tem extensão sobrando? Precisamos no galpão.', time: '13:48' },
        { id: 'g2', from: 'me', text: 'Levo uma de 10 m.', time: '13:51', status: 'entregue' },
        { id: 'g3', from: 'them', sender: 'Seu Antônio', text: 'Os mantimentos chegaram, estamos separando por família.', time: '13:58' },
        { id: 'g4', from: 'them', sender: 'João', text: 'Gerador ligado. O roteador do galpão voltou a retransmitir.', time: '14:05' },
      ] },
    { id: 'defesa', ident: 'public', kind: 'channel', name: 'Defesa Civil · Serra', initials: 'DC', time: '13:40', unread: 1, inv: true,
      sub: '1.240 inscritos · canal público', via: 'LoRa 915 MHz · 3 saltos', viaIcon: 'settings_input_antenna', priority: 'Alta',
      route: { nodes: [you, praca, { n: 'Torre Serra · 3A0F', k: 'Super Node' }, { n: 'Defesa Civil', k: 'Origem do canal' }], vias: ['Bluetooth LE', 'LoRa 915 MHz', 'LoRa 915 MHz'] },
      msgs: [
        { id: 'd1', from: 'them', text: 'Chuva forte prevista para esta noite. Evite áreas de encosta.', time: '09:15' },
        { id: 'd2', from: 'them', text: 'Alerta: estrada RJ-130 interditada no km 12. Use o desvio pela Estrada Velha.', time: '13:40' },
      ] },
    { id: 'pedro', ident: 'public', kind: 'direct', name: 'Pedro Lima', initials: 'PL', time: '12:18', unread: 0, offline: true,
      sub: 'fora de alcance · 1 na fila', via: 'na fila · aguardando rota', viaIcon: 'schedule',
      route: { nodes: [you, { n: 'Galpão · OpenWrt', k: 'Home Node · guardando' }, { n: 'Pedro Lima', k: 'Fora de alcance' }], vias: ['Bluetooth LE', 'aguardando rota'] },
      msgs: [
        { id: 'p1', from: 'them', text: 'Consegue me mandar o mapa da trilha?', time: '11:52' },
        { id: 'p2', from: 'me', text: 'Mandei o mapa, chegou?', time: '12:18', status: 'aguardando' },
      ] },
    { id: 'feira', ident: 'public', kind: 'community', name: 'Feira Livre do Sábado', initials: 'FL', time: 'Ontem', unread: 0, preview: '3 grupos · 2 canais' },
    { id: 'ana', ident: 'public', kind: 'direct', name: 'Ana Costa', initials: 'AC', time: 'Ontem', unread: 0,
      sub: 'vista via Gateway Praça', via: 'Wi-Fi Direct · 3 saltos', viaIcon: 'wifi_tethering',
      route: { nodes: [you, praca, { n: 'iPhone · 51BD', k: 'Mobile Node' }, { n: 'Ana Costa', k: 'Destino' }], vias: ['Wi-Fi Direct', 'Wi-Fi Mesh', 'Bluetooth LE'] },
      msgs: [
        { id: 'a1', from: 'them', text: 'Que festa linda ontem!', time: '21:02' },
        { id: 'a2', from: 'me', text: 'Te mando as fotos quando eu passar pelo roteador da praça.', time: '21:10', status: 'encaminhada' },
        { id: 'a-sys', from: 'sys', text: 'A chave de segurança de Ana Costa mudou. Verifique antes de enviar algo sensível.', time: '21:12' },
        { id: 'a3', from: 'me', text: 'Amanhã levo o projetor pra oficina.', time: '21:14', status: 'expirada' },
      ] },
    { id: 'radio', ident: 'public', kind: 'channel', name: 'Rádio Comunitária', initials: 'RC', time: 'Ter', unread: 0,
      sub: '486 inscritos · canal público', via: 'Wi-Fi Mesh · 2 saltos', viaIcon: 'hub',
      msgs: [{ id: 'r1', from: 'them', text: 'Sábado tem oficina de antenas às 10h, na praça.', time: 'Ter' }] },
    { id: 'anon1', ident: 'anon', kind: 'direct', name: 'Anônimo · B2D9', initials: 'B2', time: '11:03', unread: 1,
      sub: 'identidade anônima · 2 saltos', via: 'Bluetooth LE · 2 saltos', viaIcon: 'bluetooth',
      msgs: [
        { id: 'x1', from: 'me', text: 'Vi o vazamento na rua de baixo também.', time: '10:58', status: 'entregue' },
        { id: 'x2', from: 'them', text: 'Obrigado. Vou repassar para a associação.', time: '11:03' },
      ] },
    { id: 'anon2', ident: 'anon', kind: 'channel', name: 'Ouvidoria do Bairro', initials: 'OB', time: 'Seg', unread: 0, inv: true,
      sub: 'canal secreto · 64 inscritos', via: 'Wi-Fi Mesh · 1 salto', viaIcon: 'hub',
      msgs: [{ id: 'y1', from: 'them', text: 'Relatos recebidos esta semana: 14. Nenhum dado de identidade é armazenado.', time: 'Seg' }] },
  ];
}

/** Membros do grupo Mutirão Vila Esperança (FUN-006). */
export function seedMembers(): Member[] {
  return [
    { id: 'lia', name: 'Lia Ramos', initials: 'LR', role: 'Admin' },
    { id: 'joao', name: 'João Souza', initials: 'JS', role: 'Admin' },
    { id: 'me', name: 'Você', initials: 'C', role: 'Admin · criou o grupo' },
    { id: 'antonio', name: 'Seu Antônio', initials: 'SA', role: 'Membro' },
    { id: 'marina', name: 'Marina Alves', initials: 'MA', role: 'Membro' },
    { id: 'pedro', name: 'Pedro Lima', initials: 'PL', role: 'Membro · fora de alcance' },
  ];
}
export const GROUP_SIZE = 18;

/** Tipos de canal (FUN-007). */
export const CHANNEL_TYPES: [ChannelType, 'campaign' | 'lock' | 'visibility_off', string, string][] = [
  ['public', 'campaign', 'Público', 'Qualquer pessoa encontra e lê. Aparece em Por perto e na busca.'],
  ['private', 'lock', 'Privado', 'Entra só com convite. Inscritos não veem uns aos outros.'],
  ['secret', 'visibility_off', 'Secreto', 'Não aparece em busca. Nem o nome sai sem convite.'],
];


export const NEARBY_PEOPLE = [
  { id: 'marina', initials: 'MA', name: 'Marina Alves', meta: 'BLE · ~8 m' },
  { id: 'joao', initials: 'JS', name: 'João Souza', meta: 'BLE · ~12 m' },
  { id: 'lia', initials: 'LR', name: 'Lia Ramos', meta: 'Wi-Fi Direct · ~20 m' },
];

export const COMMUNITY = {
  id: 'feira', name: 'Feira Livre do Sábado', initials: 'FL', sub: 'Comunidade · 312 membros · 4 administradores',
  sections: [
    { title: 'CANAIS', items: [['campaign', 'Avisos da Feira', 'Somente administradores'], ['sell', 'Preços do dia', 'Atualizado às 6h']] },
    { title: 'GRUPOS', items: [['agriculture', 'Produtores', '48 membros'], ['local_shipping', 'Entregas', '22 membros'], ['volunteer_activism', 'Voluntários', '31 membros']] },
  ] as { title: string; items: [string, string, string][] }[],
};
