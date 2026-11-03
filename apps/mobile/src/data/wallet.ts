// Carteira, convite P2P e Por perto (design/PiuApp.dc.html): só textos, tipos e regras.
// Saldo, movimentações, pessoas por perto e pedidos vêm do que existe de verdade neste aparelho
// (state/wallet.tsx, lib/walletCore.ts). Valores como 10/25 LUNES e a taxa do convite seguem a
// proposta do modelo econômico, ainda provisória.
import type { IconName } from '../ui/Icon';

/** Regras da distribuição (seção 14): quando a recompensa por convidado é paga. */
export const REF_RULES: [IconName, string, string][] = [
  ['verified', 'Instalação original.', 'O app da pessoa confere a assinatura Lunes na primeira abertura.'],
  ['calendar_month', '7 dias de uso real.', 'Conversas com pelo menos 3 contatos diferentes.'],
  ['devices', 'Um aparelho, um bônus.', 'Até 20 recompensas por mês. Repetições são rejeitadas.'],
  ['person', 'Só indicação direta.', 'Você ganha por quem instalou a partir do seu celular. Não há ganhos por níveis.'],
];

/** Recompensas da proposta econômica (provisórias). */
export const WELCOME_BONUS = 10;
export const REFERRAL_REWARD = 25;
export const REFERRAL_MONTHLY_CAP = 20;

/** Texto padrão enquanto não há liquidação real (a Lunes Mainnet ainda não está conectada). */
export const MAINNET_PENDING = 'liquidação ainda não conectada à Mainnet';

// ── Por perto ────────────────────────────────────────────
export type Prox = 'muito perto' | 'perto' | 'mais longe';
/** Perfil público anunciado por alguém por perto (chega pelo protocolo de Por perto). */
export interface NearProfile { id: string; name: string; age: number; bio: string; tags: string[]; prox: Prox; via: string; fee: number; common: string }
/** Pedido de conversa recebido por Por perto (convite pago de outra pessoa). */
export interface ChatRequest { id: string; name: string; age: number; initials: string; fee: number; prox: Prox; time: string; msg: string }

/** Taxa definida por quem recebe o convite. */
export const FEE_OPTIONS = [1, 3, 5, 10] as const;

export const fmtLunes = (n: number) => n.toFixed(2).replace('.', ',');
export const parseLunes = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;
