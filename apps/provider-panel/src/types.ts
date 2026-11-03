export type Theme = 'light' | 'dark';
export type PageId = 'overview' | 'devices' | 'mesh' | 'earnings' | 'wallet' | 'settings';
export type DeviceStatus = 'active' | 'paused' | 'warming';
export type DeviceFilter = 'all' | DeviceStatus;
export type NodeClass = 'Home Node' | 'Super Node' | 'Gateway Local' | 'Ponto de Acesso';

/** Uso de uma interface do equipamento. `load` em % (0–100); `null` quando não há medição. */
export interface Iface { name: string; detail: string; load: number | null }

/** RelayReceipt resumido, como aparece no detalhe do equipamento. */
export interface Receipt { time: string; kind: string; hops: string; state: string }

/** RelayNode operado por este provider. */
export interface RelayNode {
  id: string;
  name: string;
  cls: NodeClass;
  short: string;
  /** Nome público assinado, sempre com prefixo `piu.` */
  pub: string;
  model: string;
  icon: string;
  status: DeviceStatus;
  /** Pacotes por hora. */
  pph: number;
  /** LUNES hoje / no mês. */
  today: number;
  month: number;
  /** Vizinhos (ou celulares, para Ponto de Acesso). */
  neighbors: number;
  /** [usado, total] em GB; null quando o equipamento não guarda mensagens. */
  storage: [number, number] | null;
  uptime: string;
  ifaces: Iface[];
  receipts: Receipt[];
  /** Ponto de Acesso: roteador comum sem o Piu Node. */
  passive?: boolean;
  /** Nó pai (só Ponto de Acesso). */
  parent?: string;
  /** Recém-adicionado: anima a entrada na tabela. */
  fresh?: boolean;
  /**
   * Com piu-node: `live` = o nó que serve o painel (estatísticas reais do motor); `none` = registro
   * do assistente, que ainda não manda estatísticas a este nó. Ausente: dados de demonstração.
   */
  telemetry?: 'live' | 'none';
  /** Recibos assinados hoje (só `live`). */
  receiptsToday?: number;
  /** Com piu-node: identidade técnica (16 hex) e se está assinada pela chave de operador atual. */
  nodeId?: string;
  signed?: boolean;
  /** Regras deste equipamento (assistente, passo "Regras"); ausente = só os limites globais. */
  limits?: { bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: HoursPolicy };
  /** Com piu-node e identidade técnica: enlace LNNP real com este nó (conectado agora, visto por último). */
  link?: { online: boolean; lastSeen: number | null; address: string | null };
}

export interface WalletTx {
  id: string; icon: string; title: string; date: string; status: string; value: string; fresh?: boolean;
  /** Com piu-node: valor com sinal (entrada positiva) e horário (ms). */
  amount?: number; at?: number;
}

export type HoursPolicy = 'always' | 'night' | 'day';

export interface Policies { media: boolean; unknown: boolean; community: boolean }

/** Família de equipamento oferecida no assistente “Adicionar equipamento”. */
export interface DeviceFamily {
  id: string;
  icon: string;
  name: string;
  cls: string;
  badge: string;
  desc: string;
  disabled?: boolean;
  install?: boolean;
  isRadio?: boolean;
  isAp?: boolean;
  pkg?: string;
  cmd?: string;
  found?: string;
  addr?: string;
  where?: string;
  hw?: string;
  ifs?: string;
  result?: NodeClass;
  bw?: string;
  lat?: string;
  nb?: string;
  model?: string;
  short?: string;
  defName?: string;
  defPub?: string;
  ifaces?: Iface[];
}

export interface ToastData { icon: string; title: string; body: string }
