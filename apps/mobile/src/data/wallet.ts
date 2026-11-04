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

/**
 * Texto padrão para o pagamento dos créditos: a leitura da Lunes Mainnet existe (lib/lunesRpc.ts),
 * mas pagar em LUNES (lotes semanais, convites) depende da liquidação (apps/settlement), ainda não ligada ao app.
 */
export const MAINNET_PENDING = 'pagamento em LUNES pendente da liquidação';

// ── Por perto ────────────────────────────────────────────
/**
 * Perfil público anunciado por alguém por perto e pedido de conversa recebido: chegam pelo anúncio de
 * presença e pelo convite pago (messaging/nearby.ts, Messenger). Nome, foto e taxa vêm do perfil
 * público da pessoa; idade, bio e interesses ainda não têm tela de edição (regra 5.2) e não vão.
 */
export type { NearPeer as NearProfile, NearRequest as ChatRequest } from '../messaging/messenger';
export type { NearProx as Prox } from '../messaging/nearby';

/** Taxa definida por quem recebe o convite. */
export const FEE_OPTIONS = [1, 3, 5, 10] as const;

export const fmtLunes = (n: number) => n.toFixed(2).replace('.', ',');
export const parseLunes = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;
