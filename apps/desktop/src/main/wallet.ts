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
  private inflight = new Map<string, ReturnType<typeof accountBalance>>();
  constructor(private balance: typeof accountBalance = accountBalance) {}

  /** Reaproveita leituras apenas da mesma conta, preservando as opções de cada chamada. */
  async read(prev: WalletState): Promise<WalletState> {
    const address = prev.address;
    if (!address) return { ...emptyWallet(null, prev.hidden) };
    let pending = this.inflight.get(address);
    if (!pending) {
      pending = this.balance(this.rpc, address);
      this.inflight.set(address, pending);
      const current = pending;
      void pending.then(() => { if (this.inflight.get(address) === current) this.inflight.delete(address); }, () => { if (this.inflight.get(address) === current) this.inflight.delete(address); });
    }
    try {
      const b = await pending;
      return { ...prev, status: 'ok', error: null, free: b.free.toString(), reserved: b.reserved.toString(), block: b.block, endpoint: b.endpoint, at: Date.now() };
    } catch (e) {
      return { ...prev, status: 'error', error: e instanceof Error ? e.message : 'falha ao ler o saldo' };
    }
  }
}
