// Carteira, convite P2P e Por perto (design/PiuApp.dc.html). Valores ilustrativos:
// 10/25 LUNES, taxas e limites dependem do modelo econômico, ainda em aberto.
import type { IconName } from '../ui/Icon';

export const START_BALANCE = 58.4;
export const WALLET_ADDR = { short: 'lunes:3P8xK2…Q7nM', long: 'lunes:3P8xK2mVt9…dE4hQ7nM' };

/** Pessoas para quem enviar LUNES. [id, iniciais, primeiro nome] */
export const SEND_PEOPLE: [string, string, string][] = [['marina', 'MA', 'Marina'], ['ana', 'AC', 'Ana'], ['pedro', 'PL', 'Pedro'], ['joao', 'JS', 'João']];

export const BASE_ACTIVITY: [IconName, string, string, string, string][] = [
  ['person_add', 'Distribuição · Seu Antônio', 'Hoje', 'pago', '+25,00'],
  ['swap_vert', 'Créditos de rede · lote #0042', '28 out', 'liquidado', '+6,40'],
  ['person_add', 'Distribuição · Ana Costa', '26 out', 'pago', '+25,00'],
  ['north_east', 'Enviado para Pedro Lima', '25 out', 'liquidado', '−3,00'],
  ['redeem', 'Bônus de boas-vindas', '24 out', 'reservado', '10,00'],
];

/** Bônus de boas-vindas: 4 etapas (FUN, antifraude da seção 14). */
export const BONUS_STEPS: [string, number][] = [['Instalação verificada', 100], ['Identidade criada', 100], ['Confirmada por 1 contato', 100], ['7 dias de uso · 4/7', 57]];

/** [iniciais, nome, progresso %, estado, valor, opacidade] */
export const REFERRALS: [string, string, number, string, string, number][] = [
  ['MA', 'Marina Alves', 100, 'Pago · ativa há 12 dias', '+25,00', 1],
  ['AC', 'Ana Costa', 100, 'Pago · ativa há 9 dias', '+25,00', 1],
  ['SA', 'Seu Antônio', 100, 'Pago hoje', '+25,00', 1],
  ['JS', 'João Souza', 71, 'Ativo há 5 de 7 dias · 4 contatos', '25,00', 1],
  ['LR', 'Lia Ramos', 40, 'Em validação · aguardando 2 nós confirmarem a instalação', '25,00', 1],
  ['PL', 'Pedro Lima', 15, 'Instalou · ainda não criou identidade', '—', 0.7],
  ['9A', 'Moto G · 9A1E', 0, 'Rejeitado · aparelho já usado em outro convite', '0,00', 0.45],
];

export const REF_RULES: [IconName, string, string][] = [
  ['verified', 'Instalação original.', 'O app da pessoa confere a assinatura Lunes na primeira abertura.'],
  ['calendar_month', '7 dias de uso real.', 'Conversas com pelo menos 3 contatos diferentes.'],
  ['devices', 'Um aparelho, um bônus.', 'Até 20 recompensas por mês. Repetições são rejeitadas.'],
  ['person', 'Só indicação direta.', 'Você ganha por quem instalou a partir do seu celular. Não há ganhos por níveis.'],
];

/** Créditos de rede: [rótulo, valor, texto, opacidade] */
export const CREDITS: [string, number, string, number][] = [['Validados', 1042, '1.042,0', 1], ['Pendentes', 128.4, '128,4', 0.55], ['Pagos', 640, '640,0', 0.3], ['Rejeitados', 18.6, '18,6', 0.15]];
export const CREDIT_HISTORY: [IconName, string, string, string, string][] = [
  ['swap_vert', '342 pacotes encaminhados', 'Hoje', 'pendente', '+34,2'],
  ['verified', '1.108 pacotes · 3 rotas novas', 'Ontem', 'validado', '+110,8'],
  ['account_balance_wallet', 'Lote #0042 liquidado', '28 out', '6,40 LUNES', '640,0'],
  ['content_copy', 'Duplicatas descartadas', '27 out', 'rejeitado', '−18,6'],
];

// ── convite P2P ──────────────────────────────────────────
/** Código de segurança de 4 palavras, conferido nos dois aparelhos. */
export const SAFETY_WORDS = ['farol', 'caju', 'vento', 'rio'];

/** Verificação da cópia na primeira abertura (5 checagens). */
export const VERIFY_CHECKS = (inviter: string): [string, string][] => [
  ['Assinatura do desenvolvedor', 'Lunes Network · certificado 4C9A…E1F0'],
  ['Integridade do pacote', 'SHA-256 a91f…7b2d confere'],
  ['Versão não revogada', 'lista de revogação recebida pela malha há 2 h'],
  ['Confirmação independente', '5 nós por perto anunciam o mesmo hash'],
  [`Convite de ${inviter}`, 'assinatura válida · uso único'],
];

// ── Por perto ────────────────────────────────────────────
export type Prox = 'muito perto' | 'perto' | 'mais longe';
export interface NearProfile { id: string; name: string; age: number; bio: string; tags: string[]; prox: Prox; via: string; fee: number; common: string }

export const NEAR_PROFILES: NearProfile[] = [
  { id: 'rafael', name: 'Rafael', age: 31, bio: 'Professor de música. Jazz, vinil e café coado.', tags: ['Jazz', 'Vinil', 'Café', 'Ciclismo'], prox: 'muito perto', via: 'Bluetooth · direto', fee: 3, common: '2 interesses · nenhum contato' },
  { id: 'julia', name: 'Júlia', age: 27, bio: 'Arquiteta. Fotografia analógica e trilhas no fim de semana.', tags: ['Fotografia', 'Trilhas', 'Arquitetura'], prox: 'muito perto', via: 'Bluetooth · direto', fee: 2, common: '1 interesse · nenhum contato' },
  { id: 'tomas', name: 'Tomás', age: 29, bio: 'Dev e radioamador. Monto antenas por diversão.', tags: ['LoRa', 'Rádio', 'Xadrez'], prox: 'perto', via: '1 salto', fee: 1, common: 'Grupo Rádio Comunitária' },
  { id: 'bia', name: 'Bia', age: 24, bio: 'Estudante de biologia, sempre com um livro na bolsa.', tags: ['Livros', 'Botânica'], prox: 'perto', via: '1 salto', fee: 5, common: 'Nenhum' },
  { id: 'camila', name: 'Camila', age: 33, bio: 'Chef. Procuro gente para trocar receitas.', tags: ['Cozinha', 'Feiras'], prox: 'mais longe', via: '2 saltos', fee: 3, common: 'Comunidade Feira Livre' },
  { id: 'diego', name: 'Diego', age: 26, bio: 'Skate, desenho e ficção científica.', tags: ['Skate', 'Desenho', 'Sci-fi'], prox: 'mais longe', via: '2 saltos', fee: 2, common: 'Nenhum' },
];

export interface ChatRequest { id: string; name: string; age: number; initials: string; fee: number; prox: Prox; time: string; msg: string }
export const REQUESTS: ChatRequest[] = [
  { id: 'helena', name: 'Helena', age: 27, initials: 'HE', fee: 3, prox: 'muito perto', time: 'agora', msg: 'Oi! Vi que você também curte jazz. Topa conversar até a próxima estação?' },
  { id: 'marcos', name: 'Marcos', age: 35, initials: 'MS', fee: 3, prox: 'perto', time: 'há 12 min', msg: 'Olá, tudo bem? Também estou indo para o centro.' },
];

/** Taxa definida por quem recebe o convite. */
export const FEE_OPTIONS = [1, 3, 5, 10] as const;

export const fmtLunes = (n: number) => n.toFixed(2).replace('.', ',');
export const parseLunes = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;
