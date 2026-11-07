/**
 * Carteira (só leitura): saldo de um endereço Lunes na Mainnet, pelo cliente leve do celular
 * (apps/mobile/src/lib/lunesRpc.ts) com o WebSocket do Node 22. Não assina nem envia nada.
 */
import { accountBalance, LunesRpc } from '../../../mobile/src/lib/lunesRpc';
import { decodeSs58 } from '../../../mobile/src/lib/ss58';
import type { WalletState } from '../shared/types';
import { tm } from './i18n';

export const emptyWallet = (address: string | null, hidden: boolean, source: WalletState['source'] = address ? 'manual' : null): WalletState =>
  ({ address, source: address ? source : null, hidden, status: 'idle', error: null, free: null, reserved: null, block: null, endpoint: null, at: null });

/** Endereço SS58 da Lunes válido? Devolve a mensagem de erro ou `null`. */
export function validateAddress(address: string): string | null {
  const d = decodeSs58(address.trim());
  return d.ok ? null : d.error;
}

/**
 * Endereço em uso na Carteira, nesta ordem: informado por você (`manual`) > carteira do celular vinculado
 * (`phone`, só enquanto vinculado) > derivado da frase da identidade própria (`phrase`, igual ao do celular).
 */
export function pickWalletAddress(o: { manual: string | null; phone: string | null; phrase: string | null }): { address: string | null; source: WalletState['source'] } {
  if (o.manual) return { address: o.manual, source: 'manual' };
  if (o.phone) return { address: o.phone, source: 'phone' };
  if (o.phrase) return { address: o.phrase, source: 'phrase' };
  return { address: null, source: null };
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
      return { ...prev, status: 'error', error: e instanceof Error ? e.message : tm('main.wallet.readFailed') };
    }
  }
}
