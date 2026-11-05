/** Seleção pública da carteira: nenhum segredo ou dependência de React/native. */
import { decodeSs58 } from './ss58';

/** Prefixos 57/42 são a mesma conta quando carregam a mesma chave pública. */
export function canSignWalletAddress(address: string | null, ownAddress: string | null): boolean {
  if (!address || !ownAddress) return false;
  const selected = decodeSs58(address), own = decodeSs58(ownAddress);
  return selected.ok && own.ok && selected.publicKey.every((b, i) => b === own.publicKey[i]);
}

export function walletSelection(o: { native: boolean; secure: boolean; ownAddress: string | null; externalAddress: string | null; useOwn: boolean }) {
  const ownAddress = o.native && o.secure ? o.ownAddress : null;
  const nativeWalletReady = !!ownAddress;
  const lunesAddress = o.useOwn ? ownAddress : o.externalAddress ?? ownAddress;
  return { ownAddress, nativeWalletReady, lunesAddress, canSign: nativeWalletReady && canSignWalletAddress(lunesAddress, ownAddress) };
}
