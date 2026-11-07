/**
 * Endereços da rede local para o transporte LAN do celular (TypeScript puro, sem `node:net`).
 * Mesmas regras do Piu Desktop e do piu-node (apps/desktop/src/transport/lnnpLan.ts,
 * apps/piu-node/src/relay/lan.ts): só rede local vira discagem, e o endereço manual é `host:porta`.
 */

/** IPv4 em notação decimal (`a.b.c.d`, cada parte 0–255, sem zero à esquerda). */
export function isIPv4(s: string): boolean {
  const p = s.split('.');
  return p.length === 4 && p.every(x => /^(0|[1-9][0-9]{0,2})$/.test(x) && Number(x) <= 255);
}

/** IPv6 (forma completa ou com `::`; aceita o IPv4 embutido no fim). Sem zona (`%wlan0`). */
export function isIPv6(s: string): boolean {
  if (!s.includes(':') || /[^0-9a-f:.]/i.test(s)) return false;
  let head = s;
  let groups = 8;
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) { if (!isIPv4(v4[2]!)) return false; head = v4[1]!.endsWith('::') ? v4[1]! : v4[1]!.slice(0, -1); groups = 6; }
  const dbl = head.split('::');
  if (dbl.length > 2) return false;
  const part = (x: string) => (x ? x.split(':') : []);
  const a = part(dbl[0] ?? ''), b = dbl.length === 2 ? part(dbl[1] ?? '') : [];
  if (![...a, ...b].every(g => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return dbl.length === 2 ? a.length + b.length < groups : a.length === groups;
}

/**
 * Endereço de rede local (B-03): RFC 1918, link-local, loopback, IPv6 ULA/link-local (e o IPv4 mapeado
 * em IPv6). O anúncio UDP e o mDNS não são autenticados: só esses viram discagem TCP.
 */
export function isPrivateLan(address: string): boolean {
  const a = address.toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  if (isIPv4(a)) {
    const [x, y] = a.split('.').map(Number) as [number, number];
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
  }
  if (isIPv6(a)) return a === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a);
  return false;
}

/**
 * Vizinho manual (QR do ponto, só pela API): `IPv4:porta` ou `[IPv6]:porta` de rede local, porta 1–65535.
 * No celular não aceita nome (a resolução de nomes da rede local não é confiável no Android e o QR do
 * ponto leva o IP do guardião). Devolve a forma canônica ou `null`.
 */
export function parseLanPeer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > 64 || /[\s/@?#%\\]/.test(s)) return null;
  const v6 = /^\[([0-9a-f:.]+)\]:([0-9]+)$/.exec(s);
  const m = v6 ?? /^([0-9.]+):([0-9]+)$/.exec(s);
  if (!m) return null;
  const host = m[1] ?? '', portStr = m[2] ?? '';
  if (!/^[1-9][0-9]{0,4}$/.test(portStr) || Number(portStr) > 65535) return null;
  if (v6 ? !isIPv6(host) || host === '::' : !isIPv4(host) || host === '0.0.0.0' || host === '255.255.255.255') return null;
  if (!isPrivateLan(host)) return null;
  return v6 ? `[${host}]:${portStr}` : `${host}:${portStr}`;
}

/** `host:porta` → partes (IPv6 entre colchetes). */
export function splitHostPort(s: string, defPort: number): { host: string; port: number } {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim());
  if (!m || !m[1]) throw new Error(`Endereço inválido: ${s}`);
  if (m[1].includes(':') && !s.includes('[')) return { host: s.trim(), port: defPort };
  return { host: m[1], port: m[2] ? Number(m[2]) : defPort };
}

export const joinHostPort = (host: string, port: number) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`);

const ipToInt = (ip: string) => ip.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
const intToIp = (n: number) => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');

/** Aparelhos que cabem na sub-rede IPv4 (sem o endereço de rede e o de broadcast). */
export function subnetSize(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return 0;
  if (prefix >= 31) return prefix === 31 ? 2 : 1;
  return 2 ** (32 - prefix) - 2;
}

/** Endereço de broadcast da sub-rede (`192.168.1.255` para 192.168.1.x/24), ou `null`. */
export function broadcastOf(ip: string, prefix: number): string | null {
  if (!isIPv4(ip) || !Number.isInteger(prefix) || prefix < 8 || prefix > 30) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return intToIp((ipToInt(ip) & mask | (~mask >>> 0)) >>> 0);
}

/** Maior sub-rede que a varredura aceita percorrer (/24 = 254 endereços). */
export const SCAN_MIN_PREFIX = 24;

/**
 * Endereços a varrer na sub-rede IPv4 privada, sem o próprio, o de rede e o de broadcast.
 * Só /24 ou menor (prefixo ≥ 24); sub-rede maior ou endereço público → lista vazia.
 */
export function subnetHosts(ip: string, prefix: number): string[] {
  if (!isIPv4(ip) || !isPrivateLan(ip) || !Number.isInteger(prefix) || prefix < SCAN_MIN_PREFIX || prefix > 30) return [];
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const me = ipToInt(ip);
  const net = (me & mask) >>> 0;
  const out: string[] = [];
  for (let i = 1; i < 2 ** (32 - prefix) - 1; i++) {
    const n = (net + i) >>> 0;
    if (n !== me) out.push(intToIp(n));
  }
  return out;
}
