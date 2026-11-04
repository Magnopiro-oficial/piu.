import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { PairedNode } from './approvals';
import { forgetPersisted } from './persist';
import { loadApprovalNodes, saveApprovalNodes } from './vault';

/**
 * Equipamentos do provider pareados com este celular: os `piu-node` reais cujo painel mostrou o QR
 * `piup:` (Nova conversa → Escanear código). O segredo de cada um fica no cofre do sistema
 * (`piu.approvals.v1`); a tela recebe só nome, operador, data e um id curto.
 */
export interface ProvNode { phoneId: string; node: string; operator: string; at: number; /** Impressão digital do certificado e endereço (QR novo). */ pin?: string; url?: string }

const strip = (n: PairedNode): ProvNode => ({ phoneId: n.phoneId, node: n.node, operator: n.operator, at: n.at, ...(n.pin ? { pin: n.pin } : {}), ...(n.url ? { url: n.url } : {}) });

export async function listProvNodes(): Promise<ProvNode[]> {
  return (await loadApprovalNodes<PairedNode>()).map(strip).sort((a, b) => b.at - a.at);
}

/** Desfaz o pareamento: o segredo sai do cofre e este celular não aprova mais pedidos desse nó. */
export async function unpairProvNode(phoneId: string): Promise<void> {
  const list = await loadApprovalNodes<PairedNode>();
  await saveApprovalNodes(list.filter(n => n.phoneId !== phoneId));
  await forgetPersisted(`prov.session.${phoneId}`); // sessão da API local desse equipamento
}

/** Lista atual, lida de novo sempre que a tela ganha foco (o pareamento acontece na tela de escanear). */
export function useProvNodes(): { nodes: ProvNode[] | null; refresh: () => void } {
  const [nodes, setNodes] = useState<ProvNode[] | null>(null);
  const refresh = useCallback(() => { listProvNodes().then(setNodes).catch(() => setNodes([])); }, []);
  useFocusEffect(refresh);
  return { nodes, refresh };
}
