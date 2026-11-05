/**
 * Carteira (só leitura): saldo de um endereço Lunes na Mainnet, pelo cliente leve do celular
 * (apps/mobile/src/lib/lunesRpc.ts) com o WebSocket do Node 22. Não assina nem envia nada.
 */
import { accountBalance, LunesRpc } from '../../../mobile/src/lib/lunesRpc';
import { decodeSs58 } from '../../../mobile/src/lib/ss58';
import type { WalletState } from '../shared/types';

export const emptyWallet = (address: string | null, hidden: boolean): WalletState =>
  ({ address, hidden, status: 'idle', error: null, free: null, reserved: null, block: null, endpoint: null, at: null });

/** Endereço SS58 da Lunes válido? Devolve a mensagem de erro ou `null`. */
export function validateAddress(address: string): string | null {
  const d = decodeSs58(address.trim());
  return d.ok ? null : d.error;
}

export class WalletReader {
  private rpc = new LunesRpc({ timeoutMs: 8000 });
  private inflight: Promise<WalletState> | null = null;

  /** Lê o saldo; nunca lança (o erro vai no estado). */
  async read(prev: WalletState): Promise<WalletState> {
    if (!prev.address) return { ...emptyWallet(null, prev.hidden) };
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const b = await accountBalance(this.rpc, prev.address!);
        return { ...prev, status: 'ok', error: null, free: b.free.toString(), reserved: b.reserved.toString(), block: b.block, endpoint: b.endpoint, at: Date.now() };
      } catch (e) {
        return { ...prev, status: 'error', error: e instanceof Error ? e.message : 'falha ao ler o saldo' };
      } finally { this.inflight = null; }
    })();
    return this.inflight;
  }
}
