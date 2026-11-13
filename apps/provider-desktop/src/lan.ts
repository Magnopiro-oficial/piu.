/**
 * Endereços do painel na rede local (menu Nó → "Permitir acesso pela rede local").
 * O app não anuncia `piu-node.local` (isso é do piu-node instalado com avahi no roteador ou no
 * Linux), então só oferece o que resolve de verdade: o nome do computador em `.local`, que o mDNS do
 * sistema já anuncia (Bonjour no macOS, avahi no Linux), e os IPs da rede.
 */
import type { NetworkInterfaceInfo } from 'node:os';

/** `iMac-de-Lucas.local` → `imac-de-lucas.local`; `pc-da-sala` → `pc-da-sala.local`. */
export const localName = (host: string) => `${host.toLowerCase().replace(/\.local$/, '')}.local`;

/** IPv4 da rede (sem loopback). */
export function lanIps(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const ips: string[] = [];
  for (const list of Object.values(ifaces)) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return [...new Set(ips)];
}

/** Onde outro aparelho da rede abre o painel: primeiro o nome do computador, depois os IPs. */
export const lanUrls = (port: number, host: string, ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>) =>
  [localName(host), ...lanIps(ifaces)].map(h => `https://${h}:${port}`);
