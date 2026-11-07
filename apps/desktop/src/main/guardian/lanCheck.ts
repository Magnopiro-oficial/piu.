/**
 * Teste automático da rede para o guardião (Piu 12 · E4): quatro etapas, todas só de LEITURA da rede.
 *
 * 1. Aparelhos se enxergam: escuta os anúncios LNNP (UDP 8423, broadcast) por alguns segundos e conta as
 *    etiquetas distintas de OUTROS endereços. Nenhum: aviso (pode ser rede vazia agora ou roteador isolando
 *    clientes), não bloqueia.
 * 2. Rede de casa protegida: sondas TCP só de conexão (SYN → fecha; nenhum byte enviado, nenhuma senha)
 *    nos endereços comuns de roteadores de OUTRAS redes privadas (192.168.0.1, 192.168.1.1, 10.0.0.1, …)
 *    nas portas 80/443. Respondeu (conectou ou recusou = existe alguém ali): esta rede alcança outra rede
 *    privada → aviso. O roteador desta rede responder é normal e só aparece no texto.
 * 3. Internet: conexão TCP a 1.1.1.1:443 e 9.9.9.9:443 (só abrir e fechar). O ponto não usa a internet.
 * 4. Capacidade: espaço livre no disco diante do limite escolhido.
 * Sem interface de rede local: falha (bloqueia "Continuar").
 */
import { createSocket } from 'node:dgram';
import { statfs } from 'node:fs/promises';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { decodeBeacon } from '../../../../mobile/src/protocol/lnnp';
import { toHex } from '../../../../mobile/src/protocol/bytes';
import type { CheckLevel, CheckStep, GuardianNetwork, GuardianTest } from '../../shared/guardian';
import { fmtStorage } from '../../shared/guardian';
import { inCidr } from './netinfo';
import { tm } from '../i18n';

export type ProbeResult = 'open' | 'refused' | 'none';

/** Só conecta e fecha (nenhum dado sai). `refused` também prova que há um aparelho no endereço. */
export function tcpProbe(host: string, port: number, ms = 900): Promise<ProbeResult> {
  return new Promise(res => {
    let done = false;
    const s = connect({ host, port });
    const end = (r: ProbeResult) => { if (done) return; done = true; clearTimeout(t); s.destroy(); res(r); };
    const t = setTimeout(() => end('none'), ms);
    s.once('connect', () => end('open'));
    s.once('error', (e: NodeJS.ErrnoException) => end(e.code === 'ECONNREFUSED' ? 'refused' : 'none'));
  });
}

/** Roteadores comuns de redes de casa (para ver se ESTA rede alcança outra rede privada). */
export const HOME_TARGETS = ['192.168.0.1', '192.168.1.1', '192.168.15.1', '192.168.100.1', '10.0.0.1', '10.0.0.138', '172.16.0.1'];
export const INTERNET_TARGETS: [string, number][] = [['1.1.1.1', 443], ['9.9.9.9', 443]];

/** Escuta anúncios LNNP por `ms` e devolve quantas etiquetas distintas vieram de outros endereços. */
export function listenBeacons(port: number, ms: number, own: Set<string>): Promise<number> {
  return new Promise(res => {
    const tags = new Set<string>();
    let sock: ReturnType<typeof createSocket> | null = null;
    const finish = () => { try { sock?.close(); } catch { /* fechado */ } res(tags.size); };
    try {
      sock = createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg, r) => {
        if (own.has(r.address)) return;
        const b = decodeBeacon(new Uint8Array(msg));
        if (b) tags.add(toHex(b.tag));
      });
      sock.on('error', () => finish());
      sock.bind(port, () => { try { sock?.setBroadcast(true); } catch { /* sem broadcast */ } });
      setTimeout(finish, ms).unref?.();
    } catch { finish(); }
  });
}

export interface CheckDeps {
  probe?: typeof tcpProbe;
  beacons?: () => Promise<number>;
  freeBytes?: () => Promise<number | null>;
  now?: () => number;
}

export interface CheckOptions { storageMB: number; dataDir: string; discoveryPort?: number; listenMs?: number }

const ownAddresses = () => new Set(Object.values(networkInterfaces()).flatMap(l => (l ?? []).map(a => a.address)));

export async function runLanCheck(net: GuardianNetwork, o: CheckOptions, d: CheckDeps = {}): Promise<GuardianTest> {
  const probe = d.probe ?? tcpProbe;
  const now = d.now ?? Date.now;
  if (!net.up || !net.cidr) {
    const steps: CheckStep[] = [
      { id: 'peers', level: 'fail', label: tm('main.check.peers'), detail: tm('main.check.noLan') },
      { id: 'home', level: 'fail', label: tm('main.check.home'), detail: tm('main.check.noNet') },
      { id: 'internet', level: 'warn', label: tm('main.check.internet'), detail: tm('main.check.noNet') },
      { id: 'capacity', level: 'warn', label: tm('main.check.capacity'), detail: tm('main.check.noNet') },
    ];
    return { network: net, steps, at: now(), internet: false, verdict: 'fail' };
  }
  const beacons = d.beacons ?? (() => listenBeacons(o.discoveryPort ?? 8423, o.listenMs ?? 3500, ownAddresses()));
  const free = d.freeBytes ?? (async () => { try { const s = await statfs(o.dataDir); return Number(s.bavail) * Number(s.bsize); } catch { return null; } });
  const others = HOME_TARGETS.filter(ip => !inCidr(ip, net.cidr!));
  const [peers, home, gw, inet, freeB] = await Promise.all([
    beacons().catch(() => 0),
    Promise.all(others.flatMap(ip => [80, 443].map(async port => ({ ip, r: await probe(ip, port) })))),
    net.gateway ? Promise.all([80, 443].map(port => probe(net.gateway!, port))) : Promise.resolve([] as ProbeResult[]),
    Promise.all(INTERNET_TARGETS.map(([h, p]) => probe(h, p, 2500))),
    free().catch(() => null),
  ]);
  const steps: CheckStep[] = [];
  steps.push(peers > 0
    ? { id: 'peers', level: 'ok', label: tm('main.check.peers'), detail: tm('main.check.peersCount', { count: peers }) }
    : { id: 'peers', level: 'warn', label: tm('main.check.peers'), detail: tm('main.check.noPeers') });
  const reached = [...new Set(home.filter(h => h.r !== 'none').map(h => h.ip))];
  const adminOpen = gw.some(r => r === 'open');
  steps.push(reached.length
    ? { id: 'home', level: 'warn', label: tm('main.check.home'), detail: tm('main.check.homeReach', { nets: reached.slice(0, 2).join(', ') }) }
    : { id: 'home', level: 'ok', label: tm('main.check.home'), detail: adminOpen ? tm('main.check.homeAdmin') : tm('main.check.homeOk') });
  const internet = inet.some(r => r === 'open');
  steps.push({ id: 'internet', level: 'ok', label: tm('main.check.internet'), detail: internet ? tm('main.check.internetYes') : tm('main.check.internetNo') });
  const need = o.storageMB * 1024 * 1024;
  steps.push(freeB === null
    ? { id: 'capacity', level: 'warn', label: tm('main.check.capacity'), detail: tm('main.check.diskUnknown') }
    : freeB >= need * 2
      ? { id: 'capacity', level: 'ok', label: tm('main.check.capacity'), detail: tm('main.check.diskGood', { free: fmtStorage(Math.floor(freeB / 1048576)) }) }
      : freeB >= need
        ? { id: 'capacity', level: 'warn', label: tm('main.check.capacity'), detail: tm('main.check.diskTight', { free: fmtStorage(Math.floor(freeB / 1048576)) }) }
        : { id: 'capacity', level: 'fail', label: tm('main.check.capacity'), detail: tm('main.check.diskLow', { free: fmtStorage(Math.floor(freeB / 1048576)), limit: fmtStorage(o.storageMB) }) });
  const verdict: CheckLevel = steps.some(s => s.level === 'fail') ? 'fail' : steps.some(s => s.level === 'warn') ? 'warn' : 'ok';
  return { network: net, steps, at: now(), internet, verdict };
}
