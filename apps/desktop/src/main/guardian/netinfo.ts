/**
 * Rede em que o computador está agora (guardião, E4a): interface IPv4 privada, sub-rede, roteador padrão e,
 * quando o sistema diz, o nome do Wi-Fi. Só LEITURA de informação pública da conexão: nunca a senha do
 * Wi-Fi (o Piu não abre o chaveiro nem os perfis de rede). Comandos do sistema com tempo limite curto e sem
 * shell; se algo falhar, o nome vira "Rede local · <sub-rede>".
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { GuardianNetwork } from '../../shared/guardian';
import { tm } from '../i18n';

export type Ifaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
export const isPrivateV4 = (a: string) => PRIVATE.some(r => r.test(a));

/** Interface com IPv4 privado (Wi-Fi/Ethernet), preferindo en, wl e eth às virtuais (docker, vbox, utun). */
export function primaryInterface(ifs: Ifaces): { iface: string; address: string; netmask: string } | null {
  const cands: { iface: string; address: string; netmask: string; score: number }[] = [];
  for (const [name, list] of Object.entries(ifs)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateV4(a.address)) continue;
      const virt = /^(docker|br-|veth|vbox|vmnet|utun|tun|tap|bridge|lo|awdl|llw|zt|tailscale|wg)/i.test(name);
      const score = virt ? 0 : /^(en|eth|wl|wlan|wi-?fi|ethernet)/i.test(name) ? 2 : 1;
      cands.push({ iface: name, address: a.address, netmask: a.netmask, score });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const c = cands[0];
  return c && c.score > 0 ? { iface: c.iface, address: c.address, netmask: c.netmask } : null;
}

const toInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
const toIp = (n: number) => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
/** "192.168.0.23" + "255.255.255.0" → "192.168.0.0/24". */
export function cidrOf(address: string, netmask: string): string {
  const m = toInt(netmask), bits = m.toString(2).replace(/0/g, '').length;
  return `${toIp(toInt(address) & m)}/${bits}`;
}
export function inCidr(ip: string, cidr: string): boolean {
  const [net, b] = cidr.split('/');
  const bits = Number(b);
  if (!net || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(net) & mask) >>> 0);
}

function run(cmd: string, args: string[], ms = 2500): Promise<string> {
  return new Promise(res => {
    try {
      execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 256 * 1024, env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }, (err, out) => res(err ? '' : String(out)));
    } catch { res(''); }
  });
}

/** Nome do Wi-Fi em uso (sem a senha), ou `null` (cabo, sistema não diz, comando ausente). */
export async function wifiName(platform: string, iface: string | null): Promise<string | null> {
  const clean = (s: string | undefined) => { const v = (s ?? '').trim(); return v && v.length <= 64 && !/[\u0000-\u001f]/.test(v) ? v : null; };
  if (platform === 'darwin') {
    const dev = iface && /^en\d+$/.test(iface) ? iface : 'en0';
    const a = await run('/usr/sbin/networksetup', ['-getairportnetwork', dev]);
    const m = /Current Wi-Fi Network:\s*(.+)$/m.exec(a);
    if (m) return clean(m[1]);
    // macOS 14+: o networksetup pode esconder o nome; o ipconfig ainda diz (sem a senha).
    const b = await run('/usr/sbin/ipconfig', ['getsummary', dev]);
    const n = /^\s*SSID\s*:\s*(.+)$/m.exec(b);
    return n && !/<redacted>/i.test(n[1]!) ? clean(n[1]) : null;
  }
  if (platform === 'linux') {
    const a = clean(await run('iwgetid', ['-r']));
    if (a) return a;
    const b = await run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']);
    const m = /^(?:yes|sim):(.+)$/m.exec(b);
    return m ? clean(m[1]!.replace(/\\:/g, ':')) : null;
  }
  if (platform === 'win32') {
    const a = await run('netsh', ['wlan', 'show', 'interfaces']);
    const m = /^\s*SSID\s*:\s*(.+)$/m.exec(a);
    return m ? clean(m[1]) : null;
  }
  return null;
}

/** Roteador padrão (IPv4), ou `null`. */
export async function defaultGateway(platform: string): Promise<string | null> {
  const ok = (s: string | undefined) => (s && /^\d+\.\d+\.\d+\.\d+$/.test(s) ? s : null);
  if (platform === 'linux') {
    try {
      const t = await readFile('/proc/net/route', 'utf8');
      for (const line of t.split('\n').slice(1)) {
        const [, dest, gw] = line.trim().split(/\s+/);
        if (dest === '00000000' && gw && gw !== '00000000') {
          const n = parseInt(gw, 16);
          return [0, 8, 16, 24].map(s => (n >>> s) & 255).join('.');
        }
      }
    } catch { /* sem /proc */ }
    return null;
  }
  if (platform === 'darwin') return ok(/gateway:\s*(\S+)/.exec(await run('/sbin/route', ['-n', 'get', 'default']))?.[1]);
  if (platform === 'win32') return ok(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m.exec(await run('route', ['print', '-4', '0.0.0.0']))?.[1]);
  return null;
}

export interface NetDeps { ifaces?: () => Ifaces; ssid?: (iface: string | null) => Promise<string | null>; gateway?: () => Promise<string | null>; platform?: string }

export async function currentNetwork(d: NetDeps = {}): Promise<GuardianNetwork> {
  const platform = d.platform ?? process.platform;
  const p = primaryInterface((d.ifaces ?? networkInterfaces)());
  if (!p) return { up: false, wired: false, ssid: null, iface: null, address: null, cidr: null, gateway: null, label: tm('main.net.none') };
  const [ssid, gw] = await Promise.all([(d.ssid ?? (i => wifiName(platform, i)))(p.iface), (d.gateway ?? (() => defaultGateway(platform)))()]);
  const cidr = cidrOf(p.address, p.netmask);
  return { up: true, wired: !ssid && /^(eth|en[1-9]|enp|eno|ethernet)/i.test(p.iface), ssid, iface: p.iface, address: p.address, cidr, gateway: gw, label: ssid ?? tm('main.net.lan', { cidr }) };
}
