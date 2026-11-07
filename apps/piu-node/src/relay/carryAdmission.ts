/**
 * Admissão de cargas para gateway (transações e pacotes para o validador) por vizinho (auditoria final
 * 06/11/2026, M-N1). Antes o balde era por CONEXÃO (`link.id` = `peerId#seq`): reconectar dava um balde
 * cheio, e um vizinho sem fundos mantinha a janela de envios do gateway sempre gasta com lixo.
 *
 * Agora são dois baldes, e a carga só passa se os dois tiverem ficha:
 * - pela identidade LNNP do vizinho (`peerId`): reconectar não renova;
 * - pelo endereço de rede de onde ele fala (IP, sem a porta), com teto maior: trocar de identidade
 *   na mesma máquina também não renova (vários celulares honestos atrás do mesmo IP cabem no teto maior).
 *
 * Limite reconhecido: a origem real de uma carga que atravessou relays não é conhecida (o envelope é
 * anônimo por desenho); cada relay aplica o mesmo limite ao vizinho dele.
 */
import { CarryLimiter } from '../protocol/carry.js';

export interface CarrySource { session: { peerId: string }; address: string }

/** Host de `host:porta`, `[v6]:porta` ou um caminho (serial): o que identifica a origem no meio. */
export function sourceHost(address: string): string {
  const v6 = /^\[([^\]]+)\]:\d+$/.exec(address);
  if (v6) return v6[1]!.toLowerCase();
  const v4 = /^([^:]+):\d+$/.exec(address);
  return v4 ? v4[1]!.toLowerCase() : address;
}

export class CarryAdmission {
  private byPeer: CarryLimiter;
  private byHost: CarryLimiter;
  constructor(o: { perHour?: number; burst?: number; hostPerHour?: number; hostBurst?: number } = {}) {
    this.byPeer = new CarryLimiter(o.perHour ?? 30, o.burst ?? 10);
    this.byHost = new CarryLimiter(o.hostPerHour ?? 120, o.hostBurst ?? 30);
  }
  take(link: CarrySource, now: number): boolean {
    if (!this.byPeer.take(`p:${link.session.peerId}`, now)) return false;
    return this.byHost.take(`h:${sourceHost(link.address)}`, now);
  }
}
