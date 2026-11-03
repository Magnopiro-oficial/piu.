/**
 * Registros locais de uso real (sem telemetria: só neste aparelho, dentro do estado cifrado do
 * mensageiro). Servem para o andamento do bônus e dos convites; o pagamento continua com a Lunes.
 * - `DeliveryDays`: por dia local, os contatos DISTINTOS para quem uma mensagem minha teve entrega
 *   confirmada (recibo `a` do destino). Um dia "conta" com pelo menos 3 contatos.
 * - `AcceptedInvites`: quem entrou em contato comigo pelo meu convite (QR/link de uso único), com a data.
 */

/** Contatos distintos por dia para o dia contar como uso real (regra da distribuição, seção 14). */
export const ACTIVE_DAY_CONTACTS = 3;
const MAX_DAYS = 60;
/** Basta saber se passou de 3; guarda um pouco mais para não depender da ordem. */
const MAX_PER_DAY = 8;

export class DeliveryDays {
  private days = new Map<string, string[]>();

  constructor(saved?: unknown) {
    if (!Array.isArray(saved)) return;
    for (const e of saved) {
      if (Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1])) this.days.set(e[0], e[1].filter((x: unknown) => typeof x === 'string').slice(0, MAX_PER_DAY));
    }
  }

  /** Entrega confirmada para `contactId` no dia `day` (chave do dia local). `true` se mudou algo. */
  record(day: string, contactId: string): boolean {
    let l = this.days.get(day);
    if (!l) { l = []; this.days.set(day, l); while (this.days.size > MAX_DAYS) this.days.delete(this.days.keys().next().value!); }
    if (l.includes(contactId) || l.length >= MAX_PER_DAY) return false;
    l.push(contactId);
    return true;
  }

  /** Dias com entrega confirmada para pelo menos `min` contatos distintos. */
  activeDays(min = ACTIVE_DAY_CONTACTS): number {
    let n = 0;
    for (const l of this.days.values()) if (l.length >= min) n++;
    return n;
  }

  /** Contatos distintos com entrega confirmada no dia `day`. */
  contactsOn(day: string): number { return this.days.get(day)?.length ?? 0; }

  export(): [string, string[]][] { return [...this.days]; }
}

/** Alguém usou um convite meu e virou contato. `at` em ms. */
export interface AcceptedInvite { contactId: string; name: string; via: 'public' | 'anon'; at: number }
const MAX_ACCEPTED = 500;

export class AcceptedInvites {
  private list: AcceptedInvite[] = [];

  constructor(saved?: unknown) {
    if (!Array.isArray(saved)) return;
    this.list = saved.filter((x): x is AcceptedInvite => !!x && typeof x.contactId === 'string' && typeof x.at === 'number')
      .map(x => ({ contactId: x.contactId, name: typeof x.name === 'string' ? x.name : '', via: x.via === 'anon' ? 'anon' : 'public', at: x.at }));
  }

  /** Registra (uma vez por contato). `true` se é novo. */
  add(a: AcceptedInvite): boolean {
    if (this.list.some(x => x.contactId === a.contactId)) return false;
    this.list.push(a);
    if (this.list.length > MAX_ACCEPTED) this.list.shift();
    return true;
  }

  /** Mais recentes primeiro. */
  all(): AcceptedInvite[] { return [...this.list].sort((a, b) => b.at - a.at); }
  get size() { return this.list.length; }
  export(): AcceptedInvite[] { return this.list; }
}
