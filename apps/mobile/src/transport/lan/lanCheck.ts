/**
 * Teste de compatibilidade da rede Wi-Fi (para o futuro assistente "Criar ponto Piu",
 * docs/rede/pontos-piu-roteadores.md §2 passo 3 e §1.6): os aparelhos Piu se enxergam? A rede de casa
 * está protegida? Tem internet? Quantos aparelhos cabem?
 *
 * `classifyLanCheck` é lógica pura (testada); `runLanCheck` só junta as medições. As conexões de teste
 * são TCP que abre e fecha na hora: nada é enviado, nunca uma senha.
 */
import { isIPv4, parseLanPeer, splitHostPort, subnetSize } from './addr';
import type { DiscoveryStats, LnnpLanEngine } from './engine';
import type { LanSocketApi, ProbeResult, WifiInfo } from './types';

/** Endereços típicos de roteador de outra rede doméstica (se respondem daqui, a rede Piu enxerga a de casa). */
export const TYPICAL_HOME_TARGETS = ['192.168.0.1', '192.168.1.1', '192.168.15.1', '192.168.100.1', '10.0.0.1'];
const ADMIN_PORTS = [80, 443];

export interface LanCheckInputs {
  wifi: WifiInfo;
  /** O transporte LAN estava ligado durante o teste. */
  lanRunning: boolean;
  /** Vizinhos vistos por camada de descoberta. */
  seen: { broadcast: number; mdns: number; scan: number; links: number };
  /** Página de administração do roteador (gateway :80/:443) respondeu. */
  gatewayAdmin: ProbeResult[];
  /** Roteadores típicos de OUTRAS redes (endereço → resultado), fora a própria sub-rede. */
  otherLans: Record<string, ProbeResult>;
  /**
   * Vizinho de teste que se sabe estar ligado na mesma rede (ex.: o Desktop do dono, pelo QR): resultado
   * da conexão TCP direta e se ele apareceu na descoberta. `null` = sem vizinho de teste.
   */
  knownPeer: { probe: ProbeResult; discovered: boolean } | null;
}

export type LanIssue =
  | 'noWifi'        // sem Wi-Fi: nada a testar
  | 'lanOff'        // transporte LAN desligado durante o teste
  | 'isolation'     // isolamento de clientes (aparelhos não se enxergam)
  | 'noPeers'       // ninguém apareceu (pode ser só uma rede vazia)
  | 'broadcastFiltered' // achou por mDNS/varredura, mas o anúncio UDP não passa
  | 'routerAdminReachable' // a página do roteador abre desta rede
  | 'homeLanReachable'     // roteador de outra rede privada responde: rede Piu não está separada da de casa
  | 'internet'      // a rede tem internet (ponto Piu deve ser sem internet por padrão)
  | 'largeSubnet';  // sub-rede maior que /24: sem varredura, só anúncio e mDNS

export type Isolation = 'none' | 'suspected' | 'unknown';

export interface LanCheckResult {
  verdict: 'green' | 'yellow' | 'red';
  issues: LanIssue[];
  wifi: boolean;
  internet: boolean;
  peers: { broadcast: number; mdns: number; scan: number; links: number };
  isolation: Isolation;
  /** A rede alcança a administração do roteador ou outra rede privada (aviso de exposição da rede de casa). */
  homeExposure: { routerAdmin: boolean; otherLans: string[] };
  /** Aparelhos que cabem na sub-rede (estimativa pelo prefixo; o DHCP do roteador pode ser menor). */
  subnetSize: number | null;
}

/** Host respondeu (aceitou ou recusou a conexão: os dois provam que ele está lá e alcançável). */
export const answered = (p: ProbeResult) => p === 'open' || p === 'refused';

export function classifyLanCheck(i: LanCheckInputs): LanCheckResult {
  const peers = { ...i.seen };
  const size = i.wifi.prefix !== null ? subnetSize(i.wifi.prefix) : null;
  const base = { wifi: i.wifi.connected, internet: i.wifi.connected && i.wifi.internet, peers, subnetSize: size };
  if (!i.wifi.connected) return { ...base, verdict: 'red', issues: ['noWifi'], isolation: 'unknown', homeExposure: { routerAdmin: false, otherLans: [] } };

  const issues: LanIssue[] = [];
  if (!i.lanRunning) issues.push('lanOff');
  const anyPeer = peers.broadcast + peers.mdns + peers.scan + peers.links > 0;

  // Isolamento: ninguém aparece e o vizinho de teste (que está ligado) não responde direto, embora o
  // roteador responda. Com aparelhos se vendo, não há isolamento. Sem vizinho de teste, não dá para saber.
  const routerUp = i.gatewayAdmin.some(answered);
  let isolation: Isolation = 'unknown';
  if (anyPeer || (i.knownPeer && answered(i.knownPeer.probe))) isolation = 'none';
  else if (i.knownPeer && !answered(i.knownPeer.probe) && routerUp) isolation = 'suspected';
  if (isolation === 'suspected') issues.push('isolation');
  else if (!anyPeer && i.lanRunning) issues.push('noPeers');
  // Vizinho de teste alcançável direto, mas nem anúncio nem mDNS o mostraram: a descoberta é filtrada.
  if ((peers.broadcast === 0 && (peers.mdns > 0 || peers.scan > 0)) || (i.knownPeer && answered(i.knownPeer.probe) && !i.knownPeer.discovered)) issues.push('broadcastFiltered');

  const otherLans = Object.entries(i.otherLans).filter(([, p]) => answered(p)).map(([h]) => h);
  if (routerUp) issues.push('routerAdminReachable');
  if (otherLans.length) issues.push('homeLanReachable');
  if (base.internet) issues.push('internet');
  if (i.wifi.prefix !== null && i.wifi.prefix < 24) issues.push('largeSubnet');

  const red = issues.includes('isolation') || issues.includes('homeLanReachable');
  const yellow = issues.some(x => x !== 'largeSubnet');
  return { ...base, verdict: red ? 'red' : yellow ? 'yellow' : 'green', issues, isolation, homeExposure: { routerAdmin: routerUp, otherLans } };
}

/** Mesma /24 (os típicos de casa na própria sub-rede são o próprio roteador, já testado à parte). */
function sameSubnet(a: string, b: string, prefix: number) {
  if (!isIPv4(a) || !isIPv4(b)) return false;
  const n = (ip: string) => ip.split('.').reduce((x, y) => ((x << 8) | Number(y)) >>> 0, 0);
  const mask = prefix <= 0 ? 0 : (0xffffffff << (32 - Math.min(prefix, 32))) >>> 0;
  return ((n(a) & mask) >>> 0) === ((n(b) & mask) >>> 0);
}

export interface RunLanCheckOptions {
  api: LanSocketApi;
  /** Transporte LAN em uso (para ver a descoberta); sem ele, só rede e conexões de teste. */
  engine?: LnnpLanEngine | null;
  /** `IP:porta` de um vizinho Piu que se sabe estar ligado nesta rede (QR do Desktop/guardião). */
  knownPeer?: string;
  /** Tempo ouvindo a descoberta (padrão 8 s, dois anúncios). */
  listenMs?: number;
  /** Força a varredura da sub-rede durante o teste (padrão: só se ninguém aparecer). */
  scan?: boolean;
  probeTimeoutMs?: number;
}

/** Roda o teste de compatibilidade e devolve o resultado classificado. */
export async function runLanCheck(o: RunLanCheckOptions): Promise<LanCheckResult> {
  const wifi = await o.api.networkInfo();
  const engine = o.engine ?? null;
  const lanRunning = engine?.state === 'running';
  const timeout = o.probeTimeoutMs ?? 1500;
  if (!wifi.connected) return classifyLanCheck({ wifi, lanRunning, seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 }, gatewayAdmin: [], otherLans: {}, knownPeer: null });

  const known = o.knownPeer ? parseLanPeer(o.knownPeer) : null;
  const probes = (async () => {
    const gw = wifi.gateway && isIPv4(wifi.gateway) ? wifi.gateway : null;
    const gatewayAdmin = gw ? await Promise.all(ADMIN_PORTS.map(p => o.api.probe(gw, p, timeout))) : [];
    const others = TYPICAL_HOME_TARGETS.filter(h => !(wifi.ip && wifi.prefix !== null && sameSubnet(h, wifi.ip, Math.max(wifi.prefix, 24))));
    const otherLans: Record<string, ProbeResult> = {};
    for (const h of others) otherLans[h] = await o.api.probe(h, 80, timeout);
    let knownProbe: ProbeResult | null = null;
    if (known) { const { host, port } = splitHostPort(known, 8422); knownProbe = await o.api.probe(host, port, timeout); }
    return { gatewayAdmin, otherLans, knownProbe };
  })();

  if (engine && lanRunning) {
    await new Promise(r => setTimeout(r, o.listenMs ?? 8000));
    const s0: DiscoveryStats = engine.discoveryStats();
    if (o.scan || (s0.broadcast + s0.mdns + s0.links === 0)) {
      if (engine.startScan()) {
        // Espera a varredura terminar (com teto: 254 endereços no ritmo da política, mais folga).
        const end = Date.now() + 150_000;
        while (engine.discoveryStats().scanning && Date.now() < end) await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  const s = engine ? engine.discoveryStats() : { broadcast: 0, mdns: 0, scan: 0, links: 0 };
  const p = await probes;
  const discovered = known ? engine?.sawHost(splitHostPort(known, 8422).host) ?? false : false;
  return classifyLanCheck({
    wifi, lanRunning,
    seen: { broadcast: s.broadcast, mdns: s.mdns, scan: s.scan, links: s.links },
    gatewayAdmin: p.gatewayAdmin, otherLans: p.otherLans,
    knownPeer: p.knownProbe ? { probe: p.knownProbe, discovered } : null,
  });
}
