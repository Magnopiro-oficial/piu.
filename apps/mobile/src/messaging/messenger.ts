/**
 * Mensageiro: liga as sessões cifradas (Double Ratchet dentro do envelope selado), o roteador
 * store-and-forward e o transporte por perto. Puro TypeScript, testável no Node.
 *
 * - Enviar: cifra na sessão do contato, guarda na fila do roteador e entrega a cada vizinho conectado.
 *   Quem não é o destino só guarda e repassa (se estiver com o Modo nó ligado), sem conseguir ler.
 * - Receber: o roteador confere integridade, autenticidade, validade e duplicatas; a sessão decifra.
 * - Confirmação de entrega: o destino responde com um recibo DENTRO da sessão (os relays não sabem
 *   que é um recibo). Ao receber o recibo, a mensagem vira "entregue" e sai da fila.
 * - Estado salvo (`export`): sessões, fila própria, ids vistos (contra replay) e contatos.
 *   Contém segredos: o app guarda cifrado (lib/persist.ts).
 */
import { AlertBook, type AlertCategory, type AlertNotice, type AlertSeverity, type AlertStatus, type AlertView, checkDraft, decodeAlertPayload, encodeAlertPayload, noticeFor, sortViews, type Vote } from './communityAlerts';
import { hoursAllow, type HoursPolicy } from './hours';
import { isJpegBase64 } from './photo';
import { isLunesAddress } from '../lib/ss58';
import { mentionIds } from './mentions';
import { type AutoDownload, shouldAutoDownload } from '../lib/mediaCore';
import { type PaidNotice, type PaymentRequest, readPaidNotice, readPayRequest, type WirePaidNotice, type WirePayRequest, wirePaidNotice, wirePayRequest } from '../lib/paymentRequest';
import { fromUtf8, toHex, utf8 } from '../protocol/bytes';
import { sha256 } from '@noble/hashes/sha2.js';
import { random } from '../protocol/suite';
import { DEFAULT_HOPS, directDest, envelopeId, type Header, HOP_OFFSET, openDirect, parseHeader, Priority } from '../protocol/envelope';
import { type CarryItem, CarryKind, CarryLimiter, carryOf, OPEN_MESH_CARRY, type CarryReceipt, decodeCarryReceipt, GATEWAY_INBOX_IDENTITY, GATEWAY_TX_IDENTITY, gatewayKindOf, type OpenedCarry, RECEIPT_TTL_SEC, returnIdentity, sealCarry, sealCarryReceipt } from '../protocol/carry';
import { decodeProofV2Frame, encodeProofV2Frame, isProofV2Frame, makeDeliveryProof, MAX_PROOFS_PER_FRAME, sealDeliveryProof, SEALED_PROOF_BYTES, VALIDATOR_PROOF_PK } from '../protocol/proof';
import { identityId, type Identity, type IdentityKind, type KeyPair, type PublicIdentity, verifyBinding } from '../protocol/keys';
import { randomDelaySec, Router, type TransportClass } from '../protocol/router';
import type { SentVia } from '../transport/types';
import { SessionManager } from '../protocol/sessions';
import type { EndorsementJson } from '../protocol/phoneNode';
/** Pedido de aval como chega pelo mensageiro (modo nó). */
export interface EndorseRequestWire { phonePk: string; createdAt: number; bondOk: boolean; cancel: boolean }
import { stripBidi } from './bidi';
import { b64url, unb64url } from './card';
import { CreditBook, type Lot } from './credits';
import { buildEvidence, type EvidenceFile } from './evidence';
import { AcceptedInvites, type AcceptedInvite, DeliveryDays } from './usage';
import { canPost, decodeGroupText, decodeState, encodeGroupText, encodeState, GROUP_INVITE_MAX_USES, GROUP_INVITE_TTL_SEC, type GroupKind, type GroupPriority, groupPriority, type GroupMember, type GroupState, groupKeyOf, isAdmin, isMemberOf, MAX_GROUP_MEMBERS, newGroupId, newKey, type ChannelVisibility } from './groups';
import { EnvelopeKind, MsgType, type Opened, sealGroup } from '../protocol/envelope';
import { toPublic } from '../protocol/keys';
import { decodePresence, encodePresence, isPresenceFrame, makePresence, NEAR_COOLDOWN_SEC, NEAR_FEES, NEAR_INVITE_MAX, NEAR_INVITE_TTL_SEC, type NearProx, type Presence, type PresenceBody, PRESENCE_EVERY_SEC, PRESENCE_HOPS, proxOf } from './nearby';

export interface Contact {
  /** `piu:…` da identidade do contato. */
  id: string;
  /** Qual das MINHAS identidades conversa com este contato (listas separadas). */
  via: IdentityKind;
  pub: PublicIdentity;
  name: string;
  /** Escreveu primeiro (usou o meu convite) sem que eu tivesse o código dele. */
  request?: boolean;
  /** Código do convite do cartão que EU escaneei: vai nas primeiras mensagens até a sessão firmar. */
  invite?: string;
  /** Endereço Lunes que o contato compartilhou comigo (`wa`); só contato público aceito. */
  lunes?: string;
  /**
   * Veio só de um grupo (entrou pelo link, indicado, membro do mesmo grupo): eu nunca aceitei a pessoa
   * em conversa direta. Não recebe meu endereço Lunes nem minha foto e não me liga, cobra ou manda
   * arquivo, até eu escrever, cobrar ou ligar para ela (ou adicionar pelo cartão).
   */
  groupOnly?: boolean;
}

/** Convite emitido por mim (o código vai no QR). Uso único; vence com o cartão. */
interface Invite { code: string; kind: IdentityKind; expiresAt: number }

/**
 * Por onde um envelope passou, do ponto de vista deste aparelho (os nós no caminho não se
 * identificam). `peer`: vizinho que entregou ou recebeu; `via`: classe do enlace com ele; `bytes`:
 * tamanho real do envelope; `hops`: saltos usados até aqui (só no recebimento); `priority`: a do
 * cabeçalho do envelope.
 */
export interface RouteInfo { peer: string; via?: TransportClass; bytes: number; hops?: number; priority: Priority }

const SENT_MEDIA = new Set(['nearby', 'ble', 'lan', 'lora', 'piulora', 'sim']);
/** Resposta do transporte com o meio usado (o resto é ignorado). */
function isSentVia(r: unknown): r is SentVia {
  if (!r || typeof r !== 'object') return false;
  const x = r as { medium?: unknown; fallback?: unknown };
  return typeof x.medium === 'string' && SENT_MEDIA.has(x.medium) && (x.fallback === undefined || x.fallback === 'away' || x.fallback === 'failed');
}

/** Localização em texto curto (graus decimais, 5 casas ≈ 1 m). */
export interface WireLocation { lat: number; lon: number }
/** Valida `[lat, lon]` recebido; `undefined` se não for uma coordenada. */
export function readWireLocation(v: unknown): WireLocation | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [lat, lon] = v;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}
const wireLocation = (l: WireLocation): [number, number] => [Math.round(l.lat * 1e5) / 1e5, Math.round(l.lon * 1e5) / 1e5];

/** `expireSec`: mensagem temporária (some esse tempo depois de `sentAt`). `loc`: localização. */
export interface IncomingText { msgId: string; text: string; sentAt: number; expireSec?: number; loc?: WireLocation; route?: RouteInfo;
  /** Grupo: a mensagem me menciona (`@Nome`). */
  mentioned?: boolean }
export interface IncomingFile { msgId: string; name: string; size: number; mime: string; blocks: number; data: Uint8Array; sentAt?: number; expireSec?: number; route?: RouteInfo;
  /** "Baixar mídia automaticamente" não deixou baixar agora: espera a pessoa tocar em "Baixar". */
  held?: boolean }

export interface MessengerEvents {
  /** Mensagem nova de um contato conhecido. */
  message(contactId: string, m: IncomingText): void;
  /** Alguém que tem o meu código escreveu pela primeira vez (pedido de conversa). */
  newContact(c: Contact, m: IncomingText): void;
  /**
   * `encaminhada`: saiu deste aparelho para um vizinho (com `route`: meio, tamanho e prioridade reais
   * do envelope); `entregue`: o destino confirmou.
   */
  status(msgId: string, status: 'encaminhada' | 'entregue' | 'expirada', route?: RouteInfo): void;
  /** O transporte confirmou por qual meio a mensagem saiu (e, no LoRa Automático, por que trocou de rádio). */
  routed?(msgId: string, via: SentVia): void;
  /** O contato leu estas mensagens minhas (confirmação de leitura dele). */
  read(contactId: string, msgIds: string[]): void;
  /** O contato está digitando (dura alguns segundos). */
  typing(contactId: string): void;
  /** Sinal da chamada de voz (`{ t: 'cl' }`, validado em src/calls/callSignals.ts) de um contato aceito. */
  callSignal(contactId: string, payload: unknown, route?: RouteInfo): void;
  /** Arquivo: progresso de envio (blocos confirmados) ou de recebimento. */
  fileProgress(msgId: string, done: number, total: number, dir: 'out' | 'in'): void;
  /** Arquivo recebido inteiro, com integridade conferida (SHA-256). */
  fileReceived(contactId: string, f: IncomingFile): void;
  /** Arquivo enviado: o destino confirmou que montou e conferiu. */
  fileDelivered(msgId: string): void;
  /** Alguém começou a enviar um arquivo (para mostrar o balão em andamento). */
  fileOffered(contactId: string, f: Omit<IncomingFile, 'data'>): void;
  /** Estado de um grupo mudou (criado, entrei, membros, regras, chave) ou fui removido (`removed`). */
  groupUpdated(g: GroupState, change: 'joined' | 'updated' | 'removed'): void;
  /** Mensagem nova num grupo, canal ou comunidade. */
  groupMessage(groupId: string, fromId: string, fromName: string, m: IncomingText): void;
  /**
   * Alerta da comunidade novo ou mudado (classificação, encerramento, validade). `notice`: o que
   * merece aviso (communityAlerts.ts, `noticeFor`); `null` só atualiza a lista.
   */
  communityAlert(v: AlertView, notice: AlertNotice | null): void;
  /** Pedido para entrar num grupo meu que exige aprovação. */
  joinRequest(groupId: string, who: { id: string; name: string }): void;
  /**
   * Um contato (ou membro de um grupo meu) mandou um aviso assinado (lib/devicesCore.ts): aparelho
   * revogado ou troca de aparelho. Texto do aviso e as chaves públicas de quem mandou. Quem chama
   * confere a assinatura e, na revogação, chama `rotateForRevocation`.
   */
  notice(contactId: string, notice: string, pub: PublicIdentity): void;
  /** Um contato público mandou (ou removeu, `null`) a foto do perfil: JPEG pequeno em base64. */
  peerPhoto(contactId: string, jpegBase64: string | null): void;
  /** Um contato público compartilhou (ou parou de compartilhar, `null`) o endereço Lunes dele. Já conferido. */
  peerWallet(contactId: string, address: string | null): void;
  /**
   * Modo nó (docs/economia/no-celular.md): um contato público aceito pediu meu aval para a chave de
   * operador do celular dele (hex). Quem chama decide (lib/phoneNodeCore.ts) e responde com `sendEndorsement`.
   */
  endorseRequest(contactId: string, req: EndorseRequestWire): void;
  /** Modo nó: um contato público aceito mandou um aval (forma conferida; a assinatura, quem chama confere). */
  endorsement(contactId: string, e: EndorsementJson): void;
  /** Modo nó: um contato público aceito avisou desde quando está no modo nó (s; 0 = saiu). */
  nodeStatus(contactId: string, since: number): void;
  /** Lote de créditos fechado (só registro local: o pagamento depende da liquidação, ainda não ligada). */
  lotClosed(lot: Lot): void;
  /** Um convite meu foi usado (registrado em `acceptedInvites`): o QR precisa mostrar um código novo. */
  inviteUsed(info: AcceptedInvite): void;
  /** Por perto: perfis visíveis mudaram (chegou, saiu, venceu). */
  nearbyChanged(): void;
  /** Por perto: pedido de conversa pago recebido (convite de alguém que me viu visível). */
  nearRequest(r: NearRequest): void;
  /** Por perto: quem eu convidei aceitou. A pessoa vira contato público e a conversa abre. */
  nearAccepted(c: Contact, fee: number): void;
  /**
   * Pedido de pagamento (lib/paymentRequest.ts) de um contato aceito: endereço Lunes dele, valor
   * (opcional) e descrição. `r.id` é o id da mensagem na conversa. Pagar é pela carteira Lunes da
   * pessoa; o Piu só mostra.
   */
  paymentRequest(contactId: string, r: PaymentRequest, sentAt: number, route?: RouteInfo): void;
  /** O contato avisou que pagou um pedido meu (com os hashes, se informou). Nada é marcado como pago sem conferir na Mainnet. */
  paymentPaid(contactId: string, n: PaidNotice): void;
  /**
   * Recibo de uma carga minha (`carry`, docs/carteira/transacoes-pela-malha.md), dito por um gateway.
   * NÃO é prova: qualquer relay que viu a carga pode forjar. A carteira confere na Mainnet.
   */
  carryReceipt(envelopeId: string, r: CarryReceipt): void;
  /** Este aparelho está como gateway (`setGateway`) e chegou uma carga: quem chama entrega (lib/carryGateway.ts). */
  gatewayCarry(c: OpenedCarry): void;
  /** Estado mudou: salvar `export()`. */
  changed(): void;
}

/** Privacidade → "Quem pode me encontrar" (ver `Messenger.setDiscovery`). */
export type Discovery = 'all' | 'contacts' | 'none';

/** Perfil de Por perto visível agora (só enquanto eu também estou visível). */
export interface NearPeer { id: string; name: string; fee: number; photo?: string; prox: NearProx; via: string; common: string; at: number }
/** Pedido de conversa recebido por Por perto. `status`: o que eu respondi (nada sai do aparelho ao recusar). */
export interface NearRequest { id: string; from: string; name: string; fee: number; msg: string; prox: NearProx; at: number; sentAt: number; status: 'pending' | 'accepted' | 'declined' | 'blocked' }
interface NearIn extends NearRequest { pub: PublicIdentity }
interface NearOut { to: string; pub: PublicIdentity; name: string; fee: number; at: number }
interface NearEntry { p: Presence; traveled: number; via?: TransportClass }
const wirePub = (p: PublicIdentity) => ({ s: b64url(p.signPk), a: b64url(p.agreePk), b: b64url(p.binding) });
const unwirePub = (w: { s: string; a: string; b: string }): PublicIdentity => ({ signPk: unb64url(w.s), agreePk: unb64url(w.a), binding: unb64url(w.b) });
const MAX_NEAR_PENDING = 50;

/**
 * Limites do nó escolhidos pela pessoa (FUN-017). Valem para mensagens de TERCEIROS: as próprias
 * sempre saem. `hours`: 'night' = só das 22h às 7h; uma faixa (messaging/hours.ts) = só dentro dela
 * (hora local, reavaliada no `tick`).
 */
export interface NodePolicy {
  maxBytes: number;
  retentionSec: number;
  /** Tráfego de terceiros por dia (bytes); acima disso, para de retransmitir até o dia seguinte. */
  dailyBytes: number;
  /** Banda para terceiros (bytes por segundo); `Infinity` = sem limite. */
  bytesPerSec: number;
  hours: HoursPolicy;
}

export interface MessengerOptions {
  identities: Record<IdentityKind, Identity>;
  node: KeyPair;
  /**
   * Chave técnica do nó por dia (LNNP §12.1: no celular, o índice de `deriveNodeKey` gira). Com isto,
   * `node` é ignorado e a chave troca na virada do dia (UTC). Recibos já assinados guardam a chave
   * deles e continuam válidos.
   */
  nodeKeyFor?: (day: number) => KeyPair;
  relay: boolean;
  /** Relógio em segundos. */
  now: () => number;
  /** Entrega bytes a um vizinho pelo transporte. */
  /** Resolve com o meio usado (`SentVia`) quando o transporte sabe; sem isso, `void`. */
  transmit: (peerId: string, bytes: Uint8Array) => Promise<SentVia | void | unknown>;
  events: Partial<MessengerEvents>;
  /** Ajuste de Privacidade "Atraso aleatório no envio". */
  randomDelay?: () => boolean;
  /** Ajuste de Privacidade "Igualar tamanho das mensagens". */
  pad?: () => boolean;
  state?: string;
  /**
   * Chave pública X25519 do validador para selar as provas de entrega v2. Padrão:
   * `VALIDATOR_PROOF_PK` (protocol/proof.ts). `null`: só a prova v1 (que não rende no validador v2).
   */
  validatorProofPk?: Uint8Array | null;
}

/** Conteúdo dentro da sessão. Curto de propósito: cada byte conta em LoRa e Bluetooth. */
type Payload =
  /** Texto. `e`: mensagem temporária, some `e` segundos depois de enviada (nos dois lados). */
  | { t: 'm'; i: string; x: string; n?: string; k?: string; e?: number; /** localização [lat, lon] */ l?: [number, number] }
  /** Confirmação de leitura (só se o ajuste de quem leu estiver ligado). */
  | { t: 'r'; i: string[] }
  /** "digitando…": sinal efêmero, sem fila, prazo de segundos e sem prova de entrega. */
  | { t: 'ty' }
  /** Chamada de voz: sinal (src/calls/callSignals.ts) e chave efêmera. */
  | { t: 'cl'; s: unknown; k?: string }
  | { t: 'a'; i: string[] }
  /** Oferta de arquivo: nome, tamanho, tipo, total de blocos e SHA-256 do conteúdo. */
  | { t: 'f'; i: string; n: string; s: number; m: string; c: number; h: string; e?: number }
  /** Blocos recebidos (confirmação parcial) e arquivo montado e conferido. */
  | { t: 'fa'; i: string; k: number[] }
  | { t: 'fd'; i: string }
  /** Quem recebe pede os blocos (tocou em "Baixar" depois de a oferta ficar esperando). */
  | { t: 'fw'; i: string }
  /** Estado do grupo, enviado por um admin. */
  | { t: 'g'; s: string }
  /** Pedido para entrar (código do convite do grupo) e aviso de saída/remoção. */
  | { t: 'gj'; g: string; c: string; n?: string }
  /**
   * "Quem pode convidar: Todos os membros": o membro indica contatos ao admin (`ga`) e avisa cada
   * convidado de quais admins vão mandar o estado (`gv`), para o convidado aceitar o estado de quem
   * ainda não é contato dele.
   */
  | { t: 'ga'; g: string; m: WireMember[] }
  | { t: 'gv'; g: string; a: WireMember[] }
  | { t: 'gl'; g: string }
  | { t: 'gr'; g: string }
  /** Aviso assinado (lib/devicesCore.ts): aparelho revogado ou troca de aparelho, para os contatos. */
  | { t: 'rv'; n: string }
  /** Foto do perfil público (JPEG de 96 px em base64; vazio = removida). Só entre contatos públicos. */
  | { t: 'pp'; p: string }
  /** Endereço Lunes (SS58) para os contatos públicos pagarem pela Carteira; vazio = parei de compartilhar. */
  | { t: 'wa'; a: string }
  /**
   * Modo nó: pedido de aval (`ar`, chave de operador do celular em hex) e aval (`av`). Prioridade baixa,
   * só entre contatos públicos aceitos. Apps antigos não conhecem os tipos e descartam (`t !== 'm'`).
   */
  | { t: 'ar'; p: string; c?: number; b?: 0 | 1; x?: 1 }
  | { t: 'av'; e: EndorsementJson }
  /** Modo nó: desde quando estou no modo nó (s; 0 = saí). Só para contatos públicos aceitos. */
  | { t: 'ns'; s: number }
  /** Por perto: convite pago (id, texto até 140, taxa) e aceite de quem recebeu. Recusa não manda nada. */
  | { t: 'ni'; i: string; x: string; f: number; n?: string }
  | { t: 'na'; i: string }
  /** Pedido de pagamento (`pq`: id, endereço Lunes, valor em planck como texto, descrição, validade) e aviso "já paguei" (`pd`). */
  | WirePayRequest
  | WirePaidNotice;

/** Membro em trânsito: id, nome e chaves públicas em base64url. */
interface WireMember { id: string; n: string; s: string; a: string; b: string }
const toWire = (id: string, name: string, pub: PublicIdentity): WireMember => ({ id, n: name.slice(0, 40), s: b64url(pub.signPk), a: b64url(pub.agreePk), b: b64url(pub.binding) });
/** Confere chaves e vínculo; `null` se algo não bate. */
function fromWire(w: unknown): { id: string; name: string; pub: PublicIdentity } | null {
  try {
    const x = w as WireMember;
    if (typeof x?.id !== 'string' || typeof x.s !== 'string') return null;
    const pub = { signPk: unb64url(x.s), agreePk: unb64url(x.a), binding: unb64url(x.b) };
    if (!verifyBinding(pub) || identityId(pub.signPk, pub.agreePk) !== x.id) return null;
    return { id: x.id, name: String(x.n ?? '').slice(0, 40), pub };
  } catch { return null; }
}
/** Indicação de um membro: vale 7 dias (como o convite do grupo). */
interface Vouch { via: IdentityKind; admins: string[]; at: number }
const MAX_INVITE_BATCH = 20;
/** Avisos de revogação da mesma pessoa: uma troca de chave dos grupos a cada 10 min, no máximo. */
const REVOKE_ROTATE_EVERY_SEC = 10 * 60;

/** Pedido para entrar aguardando um admin (só no aparelho do admin). */
interface PendingJoin { id: string; name: string; via: IdentityKind; pub: PublicIdentity; at: number }

/** Envio de arquivo em andamento (só na memória: o conteúdo não vai para o armazenamento do app). */
interface FileJob { msgId: string; to: string; data: Uint8Array; total: number; next: number; acked: Set<number>; inFlight: Set<number>; paused: boolean }
interface FileRx { msgId: string; from: string; name: string; size: number; mime: string; total: number; hash: string; parts: Map<number, Uint8Array>; bytes: number; at: number; sentAt?: number; e?: number; held?: boolean }

/** Bloco de arquivo: 12 KB de dados por envelope (cabe no preenchimento de 16 KB). */
export const FILE_BLOCK = 12 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/**
 * Teto de bytes dos recebimentos automáticos ao mesmo tempo (montados na memória). Acima dele a
 * oferta fica esperando "Baixar", em vez de 8 × 50 MB derrubarem o app (auditoria 2026-11-06, B-06).
 */
export const MAX_RX_BYTES = 64 * 1024 * 1024;
/** Quantos blocos sem confirmação podem estar na malha ao mesmo tempo. */
const FILE_WINDOW = 8;
const BLOCK_TAG = 0x01;

interface Outgoing { env: string; msgId: string; to: string; bytes: string; forwarded: boolean; /** criada (s) */ at?: number; /** primeira saída (s) e meio */ fwdAt?: number; via?: TransportClass; peers?: string[]; /** prioridade do envelope */ pr?: Priority }

/** Prova de entrega circulando pela malha (pública: não diz quem é o destino). */
interface Proof { secret: Uint8Array; at: number; sentTo: Set<string> }
const PROOF_MAGIC = [0x50, 0x52]; // "PR": quadro de provas (envelopes começam com a versão 0)
/** A prova circula enquanto a mensagem ainda pode estar na malha. */
const PROOF_TTL_SEC = 48 * 3600;
/**
 * Prova de entrega v2 selada para o validador (protocol/proof.ts; docs/economia/prova-de-entrega-v2.md).
 * Circula pelo quadro "P2" como a v1 (só repassa prova de envelope que passou por aqui) e fica guardada
 * por 8 dias (vida máxima do envelope + 1 dia) para ir no arquivo de evidências.
 */
interface ProofV2 { sealed: Uint8Array; at: number; sentTo: Set<string> }
const PROOF_V2_KEEP_SEC = 8 * 86400;
/** Envelopes com prova v2 guardada. */
const MAX_PROOFS_V2 = 2000;
/**
 * Provas v2 DIFERENTES guardadas por envelope. Ninguém consegue barrar a prova verdadeira mandando
 * uma falsa antes (o aparelho não abre a prova selada para saber qual é a boa); o validador
 * descarta as que não conferem.
 */
const PROOFS_V2_PER_ENVELOPE = 3;

/** Métricas locais do diagnóstico (sem telemetria): por dia, só neste aparelho. */
export interface DayMetrics { sent: number; delivered: number; expired: number; lat: number[]; queue: number[]; hops: Record<string, number>; relayed: number; altRoutes: number; via: Record<string, { ok: number; fail: number; lat: number[] }> }
const emptyDay = (): DayMetrics => ({ sent: 0, delivered: 0, expired: 0, lat: [], queue: [], hops: {}, relayed: 0, altRoutes: 0, via: {} });
const MAX_SAMPLES = 300;
/** Prioridade gravada no cabeçalho do envelope (protocol/envelope.ts, `parseHeader`). */
const headerPriority = (bytes: Uint8Array): Priority => { try { return parseHeader(bytes).priority; } catch { return Priority.Normal; } };

/**
 * Prazo de uma mensagem sem rota (FUN-011): 48 h, como no design ("não encontrou rota em 48 h",
 * "Expira em 47 h"). Vale para conversa, grupo e arquivo; as telas leem daqui (lib/route.ts).
 */
export const MESSAGE_TTL_SEC = 48 * 3600;
const TTL_SEC = MESSAGE_TTL_SEC;
const MAX_TEXT = 4000;
/** "digitando…": vale 15 s na malha e sai no máximo a cada 4 s por contato. */
const TYPING_TTL_SEC = 15;
const TYPING_EVERY_SEC = 4;
/** Mensagens temporárias: no máximo o prazo maior do design (7 dias); no mínimo 1 min. */
const MAX_EXPIRE_SEC = 7 * 86400;
const validExpire = (e: unknown) => (typeof e === 'number' && Number.isInteger(e) && e >= 60 && e <= MAX_EXPIRE_SEC ? e : undefined);
const MAX_CONTACTS_FROM_STRANGERS = 50;
const MAX_DELIVERED_IDS = 5000;
const INVITE_TTL_SEC = 24 * 3600;
const MAX_INVITES = 100;
const randomHex = (n: number) => toHex(random(n));
/** Cargas minhas esperando recibo ao mesmo tempo (cada uma custa uma comparação de destino por envelope que chega). */
const MAX_CARRIES = 32;
/** `bytes`: o envelope, enquanto ainda devo espalhá-lo (volta para a fila ao reabrir o app); `null` depois do recibo final. */
interface CarryOut { seed: Uint8Array; me: Identity; expiresAt: number; about: CarryKind.Tx | CarryKind.Evidence; ref: string; bytes: Uint8Array | null }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const refHex = (ref: string) => ref.toLowerCase().replace(/^0x/, '');

export class Messenger {
  readonly router: Router;
  private managers: Record<IdentityKind, SessionManager>;
  private contacts = new Map<string, Contact>();
  private outbox = new Map<string, Outgoing>();
  private delivered: string[] = [];
  private deliveredSet = new Set<string>();
  private peers = new Map<string, TransportClass>();
  private invites = new Map<string, Invite>();
  private fileJobs = new Map<string, FileJob>();
  private groups = new Map<string, GroupState>();
  /** Chave anterior de cada grupo (mensagens que já estavam na malha quando a chave trocou). */
  private prevKeys = new Map<string, { keyV: number; key: string }>();
  private pendingJoins = new Map<string, PendingJoin[]>();
  /** Grupos para os quais um contato me indicou (admins de quem aceito o primeiro estado). */
  private vouched = new Map<string, Vouch>();
  /** Envelopes de grupo meus → id da mensagem (para mostrar "encaminhada"). */
  private groupOut = new Map<string, string>();
  private fileRx = new Map<string, FileRx>();
  private wantRelay: boolean;
  private policy: NodePolicy | null = null;
  /** Bytes de terceiros enviados hoje (dia local) e o balde de banda. */
  private relayDay = { day: '', bytes: 0 };
  private bw = { tokens: 0, at: 0 };
  /** Hora local (0–23), minuto, dia da semana (0 = domingo) e dia; injetáveis nos testes. */
  clock: { hour: () => number; day: () => string; minute?: () => number; weekday?: () => number } = {
    hour: () => new Date().getHours(), day: () => new Date().toDateString(), minute: () => new Date().getMinutes(), weekday: () => new Date().getDay(),
  };
  private o: MessengerOptions;
  /** Nome enviado na primeira mensagem para quem ainda não nos conhece. */
  displayName = '';

  constructor(o: MessengerOptions) {
    this.o = o;
    const st = o.state ? JSON.parse(o.state) : null;
    this.managers = {
      public: st?.s?.public ? SessionManager.import(o.identities.public, st.s.public) : new SessionManager(o.identities.public),
      anon: st?.s?.anon ? SessionManager.import(o.identities.anon, st.s.anon) : new SessionManager(o.identities.anon),
    };
    this.wantRelay = o.relay;
    this.credits = new CreditBook(st?.cr);
    this.deliveryDays = new DeliveryDays(st?.ud);
    this.accepted = new AcceptedInvites(st?.ia);
    this.alertBook = new AlertBook(st?.ca);
    for (const [k, d] of (st?.mx ?? []) as [string, DayMetrics][]) this.days.set(k, d);
    for (const [id, x] of (st?.p2 ?? []) as [string, { s: string; at: number }][]) {
      const sealed = unb64url(x.s);
      if (sealed.length === SEALED_PROOF_BYTES && o.now() - x.at < PROOF_V2_KEEP_SEC) this.keepProofV2(id, sealed, new Set(), x.at);
    }
    this.nodeDay = Math.floor(o.now() / 86400);
    this.routerOpts = {
      node: o.nodeKeyFor ? o.nodeKeyFor(this.nodeDay) : o.node,
      identities: [o.identities.public, o.identities.anon],
      relay: o.relay,
      acceptDest: (d, e) => this.managers.public.acceptsDest(d, e) || this.managers.anon.acceptsDest(d, e),
      openExtra: (bytes, h, now) => this.openCarryEnvelope(bytes, h, now),
      // Grupo: só abre mensagem de quem ainda é membro e pode publicar (canal: só admins). Comunidade:
      // qualquer membro, porque alertas e classificações vêm de todos; o texto dos avisos continua só
      // de admins (conferido em `onGroupEnvelope`).
      isMember: (fromId, gid) => { const g = this.groups.get(gid); return !!g && (g.kind === 'community' ? isMemberOf(g, fromId) : canPost(g, fromId)); },
    };
    this.router = new Router(this.routerOpts);
    // Cargas minhas: a identidade de retorno (para o recibo) e o envelope de volta na fila (antes dos ids vistos).
    for (const [id, c] of (st?.cy ?? []) as [string, { s: string; x: number; k: number; r: string; b?: string }][]) {
      if (c.x + RECEIPT_TTL_SEC <= o.now() || (c.k !== CarryKind.Tx && c.k !== CarryKind.Evidence) || typeof c.r !== 'string') continue;
      const seed = unb64url(c.s);
      if (seed.length !== 32) continue;
      let bytes = c.b ? unb64url(c.b) : null;
      if (bytes && this.router.send(bytes, o.now()).status !== 'stored') bytes = null;
      this.carries.set(id, { seed, me: returnIdentity(seed), expiresAt: c.x, about: c.k, ref: refHex(c.r), bytes });
    }
    if (!st) return;
    for (const t of (st.g ?? []) as string[]) {
      const via = (JSON.parse(t) as { via?: IdentityKind }).via === 'anon' ? 'anon' : 'public';
      const g = decodeState(t, via);
      if (g) this.groups.set(g.id, g);
    }
    for (const [gid, k] of (st.gp ?? []) as [string, { keyV: number; key: string }][]) this.prevKeys.set(gid, k);
    for (const [gid, list] of (st.gq ?? []) as [string, { id: string; name: string; via: IdentityKind; s: string; a: string; b: string; at: number }[]][])
      this.pendingJoins.set(gid, list.map(p => ({ id: p.id, name: p.name, via: p.via, at: p.at, pub: { signPk: unb64url(p.s), agreePk: unb64url(p.a), binding: unb64url(p.b) } })));
    this.rotatedFor = Array.isArray(st.rk) ? (st.rk as string[]).slice(-200) : [];
    for (const [gid, v] of (st.gv ?? []) as [string, Vouch][]) if (v.at + GROUP_INVITE_TTL_SEC > o.now()) this.vouched.set(gid, v);
    this.refreshGroupKeys();
    for (const c of st.c ?? []) this.contacts.set(c.id, { id: c.id, via: c.via, name: c.name, request: !!c.r, ...(c.o ? { groupOnly: true } : {}), invite: c.k || undefined, lunes: c.w || undefined, pub: { signPk: unb64url(c.s), agreePk: unb64url(c.a), binding: unb64url(c.b) } });
    for (const i of (st.inv ?? []) as Invite[]) if (i.expiresAt > o.now()) this.invites.set(i.code, i);
    // A fila própria volta antes dos ids vistos (senão os próprios envelopes contariam como repetidos).
    for (const q of (st.q ?? []) as Outgoing[]) {
      if (this.router.send(unb64url(q.bytes), o.now()).status === 'stored') this.outbox.set(q.env, q);
    }
    this.router.importSeen(st.seen ?? [], o.now());
    for (const d of st.d ?? []) this.markDelivered(d);
    // Por perto: até quando fiquei visível, pedidos, convites feitos e a regra dos 30 dias.
    const nb = st.nb as { u?: number; i?: (Omit<NearIn, 'pub'> & { k: { s: string; a: string; b: string } })[]; o?: [string, Omit<NearOut, 'pub'> & { k: { s: string; a: string; b: string } }][]; ka?: [string, number][]; ks?: [string, number][]; h?: string[] } | undefined;
    if (nb) {
      this.shownUntil = nb.u ?? 0;
      for (const r of nb.i ?? []) { const { k, ...rest } = r; this.nearIn.set(r.id, { ...rest, pub: unwirePub(k) }); }
      for (const [id, x] of nb.o ?? []) { const { k, ...rest } = x; this.nearOut.set(id, { ...rest, pub: unwirePub(k) }); }
      for (const [id, at] of nb.ka ?? []) this.nearAsked.set(id, at);
      for (const [id, at] of nb.ks ?? []) this.nearSent.set(id, at);
      for (const id of nb.h ?? []) this.nearHidden.add(id);
    }
  }

  /** Opções do roteador (a chave do nó troca aqui, sem refazer o roteador e a fila). */
  private routerOpts: ConstructorParameters<typeof Router>[0];
  private nodeDay: number;
  /** Chave técnica do nó em uso (pública), para o diagnóstico. */
  get nodePk() { return this.routerOpts.node.pk; }

  /** Virada do dia: chave técnica nova (só com `nodeKeyFor`). */
  private rotateNodeKey() {
    const day = Math.floor(this.o.now() / 86400);
    if (!this.o.nodeKeyFor || day === this.nodeDay) return;
    this.nodeDay = day;
    this.routerOpts.node = this.o.nodeKeyFor(day);
  }

  set relay(v: boolean) { this.wantRelay = v; this.applyRelay(); }

  /** Aplica os limites do nó: espaço e prazo no roteador; banda, tráfego diário e horário aqui. */
  setPolicy(p: NodePolicy) {
    this.policy = p;
    this.router.limits.maxBytes = p.maxBytes;
    this.router.limits.maxRetentionSec = p.retentionSec;
    this.applyRelay();
  }

  /** Estado dos limites, para a tela de diagnóstico. */
  relayStatus() {
    this.rollDay();
    const p = this.policy;
    const reason = !this.wantRelay ? 'off' : p && !this.inHours() ? 'hours' : p && this.relayDay.bytes >= p.dailyBytes ? 'daily' : null;
    return { relaying: this.router.relay, reason: reason as null | 'off' | 'hours' | 'daily', bytesToday: this.relayDay.bytes };
  }

  /** Dentro do horário escolhido (Sempre, 22h–7h ou Personalizado)? */
  private inHours() {
    const p = this.policy;
    if (!p) return true;
    const c = this.clock;
    return hoursAllow(p.hours, { weekday: c.weekday?.() ?? new Date().getDay(), minutes: c.hour() * 60 + (c.minute?.() ?? 0) });
  }
  private rollDay() { const d = this.clock.day(); if (d !== this.relayDay.day) this.relayDay = { day: d, bytes: 0 }; }
  private applyRelay() {
    this.rollDay();
    const p = this.policy;
    const allowed = this.wantRelay && (!p || (this.inHours() && this.relayDay.bytes < p.dailyBytes));
    this.router.relay = allowed;
  }

  addContact(c: Contact) {
    if (!verifyBinding(c.pub) || identityId(c.pub.signPk, c.pub.agreePk) !== c.id) throw new Error('Chaves do contato inválidas.');
    const mine = [this.o.identities.public.id, this.o.identities.anon.id];
    if (mine.includes(c.id)) throw new Error('Este é o seu próprio código.');
    const cur = this.contacts.get(c.id);
    const next: Contact = { ...c, name: c.name || cur?.name || '', lunes: c.lunes ?? cur?.lunes, request: false };
    delete next.groupOnly;
    this.contacts.set(c.id, next);
    this.o.events.changed?.();
  }

  /** Eu escrevi, mandei arquivo, cobrei ou liguei para quem veio só de grupo: passa a ser contato aceito. */
  private acceptDirect(c: Contact) {
    if (!c.groupOnly) return;
    delete c.groupOnly;
    this.o.events.changed?.();
  }

  getContact(id: string) { return this.contacts.get(id); }
  listContacts() { return [...this.contacts.values()]; }

  /**
   * Apaga o contato deste aparelho: sai da lista, a fila própria para ele é descartada (inclusive
   * envelopes que ainda não saíram) e envios/recebimentos de arquivo com ele param. Depois disso,
   * uma mensagem dele só entra com um convite novo (como um desconhecido).
   */
  removeContact(id: string) {
    this.contacts.delete(id);
    for (const [k, q] of this.outbox) if (q.to === id) { this.outbox.delete(k); this.router.forget(k); }
    // Controles, recibos e blocos de arquivo para ele que ainda estão na fila do roteador.
    for (const [k, to] of this.ownTo) if (to === id) { this.ownTo.delete(k); this.router.forget(k); }
    for (const [k, j] of this.fileJobs) if (j.to === id) this.fileJobs.delete(k);
    for (const [k, r] of this.fileRx) if (r.from === id) this.fileRx.delete(k);
    this.typingAt.delete(id);
    this.o.events.changed?.();
  }

  /** Envelopes próprios na fila do roteador → contato de destino (só nesta execução). */
  private ownTo = new Map<string, string>();
  private pruneOwn() { for (const k of this.ownTo.keys()) if (!this.router.has(k)) this.ownTo.delete(k); }

  /** Mensagens ainda na fila para um contato (aguardando rota ou confirmação). */
  pendingFor(contactId: string) { return [...this.outbox.values()].filter(q => q.to === contactId).map(q => q.msgId); }

  /** Cifra e enfileira. `msgId` é o id da mensagem na conversa (para os estados). */
  /**
   * Convite atual para o QR da identidade `kind`: o mesmo enquanto não for usado e tiver mais de 1 h
   * de validade; `fresh` revoga os anteriores dessa identidade e gera outro ("Gerar novo código").
   */
  issueInvite(kind: IdentityKind, fresh = false): { code: string; expiresAt: number } {
    const now = this.o.now();
    for (const [k, i] of this.invites) if (i.expiresAt <= now || (fresh && i.kind === kind)) this.invites.delete(k);
    if (!fresh) {
      const cur = [...this.invites.values()].filter(i => i.kind === kind && i.expiresAt - now > 3600).sort((a, b) => b.expiresAt - a.expiresAt)[0];
      if (cur) return { code: cur.code, expiresAt: cur.expiresAt };
    }
    const inv: Invite = { code: randomHex(8), kind, expiresAt: now + INVITE_TTL_SEC };
    this.invites.set(inv.code, inv);
    while (this.invites.size > MAX_INVITES) this.invites.delete(this.invites.keys().next().value!);
    this.o.events.changed?.();
    return { code: inv.code, expiresAt: inv.expiresAt };
  }

  /**
   * Texto para o contato. `expireSec`: mensagem temporária (o envelope também vence antes, se o prazo
   * for menor que o da fila).
   */
  sendText(contactId: string, msgId: string, text: string, expireSec?: number, loc?: WireLocation) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    this.acceptDirect(c);
    const x = text.slice(0, MAX_TEXT);
    const mgr = this.managers[c.via];
    const p: Payload = { t: 'm', i: msgId, x };
    if (loc) { if (!readWireLocation([loc.lat, loc.lon])) throw new Error('Coordenadas inválidas.'); p.l = wireLocation(loc); }
    const e = validExpire(expireSec);
    if (e) p.e = e;
    const firm = mgr.get(contactId)?.established;
    if (!firm && c.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    if (!firm && c.invite) p.k = c.invite; // prova que escaneei o QR (uso único do lado de lá)
    this.enqueue(c, p, msgId, Priority.Normal, false, e ? Math.min(TTL_SEC, e) : TTL_SEC);
  }

  /**
   * Pedido de pagamento para um contato (regra 7.3). `r.id` vira o id da mensagem: os estados
   * (encaminhada, entregue) chegam por `status` como nas mensagens de texto. O envelope vence junto
   * com o pedido, se este for mais curto que o prazo da fila.
   */
  sendPayRequest(contactId: string, r: PaymentRequest) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    const now = this.o.now();
    if (r.expiresAt <= now) throw new Error('Este pedido já venceu.');
    const w = wirePayRequest(r);
    if (!readPayRequest(w, now)) throw new Error('Pedido inválido.');
    this.acceptDirect(c);
    this.enqueue(c, w, r.id, Priority.Normal, false, Math.min(TTL_SEC, r.expiresAt - now));
  }

  /** "Já paguei" para quem pediu (só contato aceito). Sem fila própria de estados: é um aviso. */
  sendPaid(contactId: string, n: PaidNotice) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    const w = wirePaidNotice(n);
    if (!readPaidNotice(w)) throw new Error('Aviso inválido.');
    this.enqueue(c, w, null, Priority.Normal);
  }

  /**
   * Confirmação de leitura: quem chama só chama com o ajuste "Confirmação de leitura" ligado. Cada
   * mensagem é confirmada uma vez. Só para contato aceito.
   */
  sendRead(contactId: string, msgIds: string[]) {
    const c = this.contacts.get(contactId);
    if (!c || c.request || this.blocked.has(contactId)) return;
    const fresh = msgIds.filter(i => typeof i === 'string' && i.length <= 64 && !this.deliveredSet.has(`${contactId}|read|${i}`)).slice(0, 64);
    if (!fresh.length) return;
    for (const i of fresh) this.markDelivered(`${contactId}|read|${i}`);
    this.enqueue(c, { t: 'r', i: fresh }, null, Priority.Normal);
  }

  private typingAt = new Map<string, number>();
  /**
   * "digitando…" para o contato (quem chama só chama com o ajuste ligado). Sem fila: sem vizinho por
   * perto, não sai; com vizinho, vale 15 s na malha e não gera prova de entrega.
   */
  sendTyping(contactId: string) {
    const c = this.contacts.get(contactId);
    const now = this.o.now();
    if (!c || c.request || !this.peers.size || !this.managers[c.via].get(contactId)?.established) return false;
    if (now - (this.typingAt.get(contactId) ?? -Infinity) < TYPING_EVERY_SEC) return false;
    this.typingAt.set(contactId, now);
    this.enqueue(c, { t: 'ty' }, null, Priority.Low, false, TYPING_TTL_SEC);
    return true;
  }

  /**
   * Sinal da chamada de voz. Ao vivo (convite, aceite, recusa…): como o "digitando", sem fila e só com
   * vizinho por perto, mas com prioridade alta e 30 s de validade, e nunca pelo LoRa (flag `live` no
   * envelope: nem eu nem quem repassa põe no ar). Pedido de chamada e resposta: pela fila da malha
   * (até 24 h, LoRa inclusive); `msgId` volta como "entregue" quando o contato confirmar.
   */
  sendCallSignal(contactId: string, payload: { t: 'cl'; s: unknown; k?: string }, o: { live: boolean; ttlSec: number; msgId?: string }): boolean {
    const c = this.contacts.get(contactId);
    if (!c || c.request || !this.managers[c.via].get(contactId)?.established) return false;
    if (o.live && !this.peers.size) return false;
    // Ligar ou pedir chamada para quem veio só de grupo aceita a pessoa (senão a resposta dela cairia).
    const st = (payload.s as { t?: string } | undefined)?.t;
    if (st === 'invite' || st === 'request') this.acceptDirect(c);
    this.enqueue(c, payload, o.live ? null : o.msgId ?? null, o.live ? Priority.High : Priority.Normal, false, o.ttlSec, o.live);
    return true;
  }

  /** Último vizinho por onde o contato chegou direto (1 salto) e quando; base para "dá para ligar ao vivo?". */
  private direct = new Map<string, { peer: string; at: number }>();
  directLink(contactId: string, maxAgeSec: number): string | null {
    const d = this.direct.get(contactId);
    return d && this.peers.has(d.peer) && this.o.now() - d.at <= maxAgeSec ? d.peer : null;
  }

  private enqueue(c: Contact, p: Payload | Uint8Array, msgId: string | null, priority: Priority, bulk = false, ttlSec = TTL_SEC, live = false) {
    const now = this.o.now();
    const body = p instanceof Uint8Array ? p : utf8(JSON.stringify(p));
    const sealed = this.managers[c.via].seal(c.pub, body, { now, ttlSec, priority, bulk, live, pad: this.o.pad?.() ?? true });
    const delaySec = msgId && this.o.randomDelay?.() ? randomDelaySec() : 0;
    const r = this.router.send(sealed.bytes, now, { delaySec });
    if (r.status === 'stored') { this.ownTo.set(sealed.id, c.id); if (this.ownTo.size > 5000) this.pruneOwn(); }
    if (msgId && r.status === 'stored') { this.outbox.set(sealed.id, { env: sealed.id, msgId, to: c.id, bytes: b64url(sealed.bytes), forwarded: false, at: now, pr: priority }); if (!(p instanceof Uint8Array) && p.t === 'm') this.day().sent++; }
    this.o.events.changed?.();
    this.flushAll();
  }

  // ── arquivos (FUN-009): oferta, blocos com confirmação, pausa/retomada e SHA-256 no fim ──

  /** Começa a enviar um arquivo para o contato. `msgId` é o id do balão na conversa. */
  sendFile(contactId: string, msgId: string, f: { name: string; mime: string; data: Uint8Array }, expireSec?: number) {
    const c = this.contacts.get(contactId);
    if (!c) throw new Error('Contato desconhecido.');
    if (f.data.length === 0 || f.data.length > MAX_FILE_BYTES) throw new Error('Arquivo vazio ou maior que 50 MB.');
    this.acceptDirect(c);
    const total = Math.ceil(f.data.length / FILE_BLOCK);
    const job: FileJob = { msgId, to: contactId, data: f.data, total, next: 0, acked: new Set(), inFlight: new Set(), paused: false };
    this.fileJobs.set(msgId, job);
    const e = validExpire(expireSec);
    this.enqueue(c, { t: 'f', i: msgId, n: f.name.slice(0, 120), s: f.data.length, m: f.mime.slice(0, 80), c: total, h: toHex(sha256(f.data)), ...(e ? { e } : {}) }, null, Priority.Normal);
    this.pumpFile(job);
    return { blocks: total };
  }

  /** Pausar/retomar pelo usuário. Retomar continua de onde parou (só os blocos que faltam). */
  setFilePaused(msgId: string, paused: boolean) {
    const job = this.fileJobs.get(msgId);
    if (!job) return false;
    job.paused = paused;
    if (!paused) { job.inFlight.clear(); job.next = 0; this.pumpFile(job); }
    return true;
  }

  /** Ajuste "Baixar mídia automaticamente". Padrão: sempre (como antes do ajuste existir). */
  private autoDownload: AutoDownload = 'always';
  setAutoDownload(a: AutoDownload) { this.autoDownload = a; }

  /** "Baixar" num arquivo que ficou esperando: pede os blocos a quem enviou. */
  downloadFile(contactId: string, msgId: string) {
    const rx = this.fileRx.get(`${contactId}|${msgId}`);
    const c = this.contacts.get(contactId);
    if (!rx || !c) return false;
    if (rx.held) { rx.held = false; this.o.events.fileProgress?.(msgId, 0, rx.total, 'in'); }
    this.enqueue(c, { t: 'fw', i: msgId }, null, Priority.High);
    return true;
  }

  /** O envio ainda existe nesta execução do app? (depois de reabrir, o conteúdo não fica guardado). */
  hasFileJob(msgId: string) { return this.fileJobs.has(msgId); }

  private pumpFile(job: FileJob) {
    const c = this.contacts.get(job.to);
    if (!c || job.paused) return;
    while (job.inFlight.size < FILE_WINDOW) {
      while (job.next < job.total && (job.acked.has(job.next) || job.inFlight.has(job.next))) job.next++;
      if (job.next >= job.total) break;
      const k = job.next++;
      job.inFlight.add(k);
      const id = utf8(job.msgId);
      const chunk = job.data.subarray(k * FILE_BLOCK, (k + 1) * FILE_BLOCK);
      const body = new Uint8Array(1 + 1 + id.length + 4 + chunk.length);
      body[0] = BLOCK_TAG; body[1] = id.length; body.set(id, 2);
      new DataView(body.buffer).setUint32(2 + id.length, k);
      body.set(chunk, 6 + id.length);
      // Mídia nunca vai por LoRa (flag bulk no envelope).
      this.enqueue(c, body, null, Priority.Low, true);
    }
  }

  private onBlock(from: string, pt: Uint8Array) {
    if (pt.length < 7) return;
    const n = pt[1];
    if (n === 0 || n > 64 || pt.length < 6 + n) return;
    const msgId = fromUtf8(pt.subarray(2, 2 + n));
    const k = new DataView(pt.buffer, pt.byteOffset).getUint32(2 + n);
    const rx = this.fileRx.get(`${from}|${msgId}`);
    if (!rx || rx.held || k >= rx.total) return; // esperando "Baixar": não guarda nem confirma
    const data = pt.slice(6 + n);
    if (data.length > FILE_BLOCK || (k < rx.total - 1 && data.length !== FILE_BLOCK)) return;
    if (!rx.parts.has(k)) { rx.parts.set(k, data); rx.bytes += data.length; }
    if (rx.bytes > rx.size) { this.fileRx.delete(`${from}|${msgId}`); return; }
    const c = this.contacts.get(from);
    if (!c) return;
    this.o.events.fileProgress?.(msgId, rx.parts.size, rx.total, 'in');
    // Confirma cada bloco (repetido também: a confirmação anterior pode ter se perdido).
    this.enqueue(c, { t: 'fa', i: msgId, k: [k] }, null, Priority.High);
    if (rx.parts.size < rx.total) return;
    const whole = new Uint8Array(rx.size);
    let o = 0;
    for (let i = 0; i < rx.total; i++) { const part = rx.parts.get(i)!; whole.set(part, o); o += part.length; }
    this.fileRx.delete(`${from}|${msgId}`);
    if (o !== rx.size || toHex(sha256(whole)) !== rx.hash) return; // integridade não confere: descarta
    this.enqueue(c, { t: 'fd', i: msgId }, null, Priority.High);
    this.o.events.fileReceived?.(from, { msgId, name: rx.name, size: rx.size, mime: rx.mime, blocks: rx.total, data: whole, sentAt: rx.sentAt, expireSec: rx.e });
  }

  private onFileControl(from: string, p: Payload, sentAt?: number) {
    const c = this.contacts.get(from);
    if (!c) return;
    if (p.t === 'f') {
      // Oferta só de contato já aceito (nem pedido de conversa, nem quem veio só de grupo).
      if (c.request || c.groupOnly) return;
      // Tamanho e blocos como número inteiro: texto ("0x10") ou fração furavam o teto de memória.
      if (typeof p.i !== 'string' || p.i.length > 64 || !Number.isInteger(p.s) || !Number.isInteger(p.c) || !(p.s > 0 && p.s <= MAX_FILE_BYTES) || p.c !== Math.ceil(p.s / FILE_BLOCK) || typeof p.h !== 'string' || !/^[0-9a-f]{64}$/.test(p.h)) return;
      const key = `${from}|${p.i}`;
      if (this.fileRx.has(key) || this.deliveredSet.has(`${from}|file|${p.i}`)) return;
      // Poucos recebimentos simultâneos (memória); ofertas esperando "Baixar" não guardam blocos.
      const held = [...this.fileRx.values()].filter(r => r.held).length;
      if (this.fileRx.size - held >= 8 || held >= 100) return;
      const e = validExpire(p.e);
      // "Baixar mídia automaticamente" (Wi-Fi e cabo / Sempre / Nunca) pelo meio dos vizinhos de agora;
      // e só se couber no teto de memória junto com o que já está chegando.
      const inFlight = [...this.fileRx.values()].reduce((sum, r) => sum + (r.held ? 0 : r.size), 0);
      const hold = !shouldAutoDownload(this.autoDownload, this.peers.values()) || inFlight + p.s > MAX_RX_BYTES;
      this.fileRx.set(key, { msgId: p.i, from, name: stripBidi(String(p.n)).slice(0, 120), size: p.s, mime: String(p.m).slice(0, 80), total: p.c, hash: p.h, parts: new Map(), bytes: 0, at: this.o.now(), sentAt, e, held: hold });
      this.markDelivered(`${from}|file|${p.i}`);
      this.o.events.fileOffered?.(from, { msgId: p.i, name: stripBidi(String(p.n)).slice(0, 120), size: p.s, mime: String(p.m).slice(0, 80), blocks: p.c, sentAt, expireSec: e, ...(hold ? { held: true } : {}), ...(this.rx ? { route: this.rx } : {}) });
      return;
    }
    if (p.t !== 'fa' && p.t !== 'fd' && p.t !== 'fw') return;
    const job = typeof p.i === 'string' ? this.fileJobs.get(p.i) : undefined;
    if (!job || job.to !== from) return;
    if (p.t === 'fa' && Array.isArray(p.k)) {
      for (const k of p.k.slice(0, 64)) if (Number.isInteger(k) && k >= 0 && k < job.total) { job.acked.add(k); job.inFlight.delete(k); }
      this.o.events.fileProgress?.(job.msgId, job.acked.size, job.total, 'out');
      this.pumpFile(job);
    } else if (p.t === 'fw') { // quem recebe tocou em "Baixar": manda de novo o que ainda não foi confirmado
      job.inFlight.clear(); job.next = 0;
      this.pumpFile(job);
    } else if (p.t === 'fd') { // montado e conferido do lado de lá (pode chegar antes da última confirmação de bloco)
      this.fileJobs.delete(job.msgId);
      this.o.events.fileDelivered?.(job.msgId);
    }
  }

  // ── Por perto (DS Por perto; ECO §5): presença, convite pago e pedidos ──

  /** Visível até (s), taxa, nome e foto do perfil público. `until` 0 ou passado = invisível. */
  private near: { until: number; fee: number; name: string; photo?: string | null } = { until: 0, fee: 3, name: '' };
  /** Fim do último anúncio que saiu daqui (s): só aceito convite enviado enquanto eu estava visível. */
  private shownUntil = 0;
  private lastAnnounce = -Infinity;
  private presences = new Map<string, NearEntry>();
  private presenceSeen = new Set<string>();
  /** Hash da minha foto já enviada a cada vizinho (a foto vai uma vez; o resto do anúncio é pequeno). */
  private photoSent = new Map<string, string>();
  private nearIn = new Map<string, NearIn>();
  private nearOut = new Map<string, NearOut>();
  /** Quem me convidou e quando / quem eu convidei e quando (30 dias sem insistência, nos dois lados). */
  private nearAsked = new Map<string, number>();
  private nearSent = new Map<string, number>();
  /** Perfis denunciados: não aparecem mais para mim em Por perto (só neste aparelho). */
  private nearHidden = new Set<string>();

  /**
   * Privacidade → "Quem pode me encontrar" (identidade pública). `all`: Por perto anuncia (quando
   * visível) e aceita pedidos pagos. `contacts`: fora de Por perto (nem anuncia nem recebe pedidos);
   * pedidos de conversa só de quem tem o meu código. `none`: também descarta os pedidos pelo código da
   * identidade pública (só eu adiciono, lendo o código da pessoa). A anônima não muda.
   */
  private discovery: Discovery = 'all';

  setDiscovery(d: Discovery) {
    if (d === this.discovery) return;
    const was = this.nearVisible();
    this.discovery = d;
    const now = this.nearVisible();
    if (was && !now) {
      this.withdraw();
      if (this.presences.size) { this.presences.clear(); this.o.events.nearbyChanged?.(); }
    } else if (now && !was) this.announce();
  }

  /** Por perto ativo: visível pelo prazo escolhido e "Quem pode me encontrar" em Todos. */
  private nearVisible() { return this.discovery === 'all' && this.near.until > this.o.now(); }

  /**
   * Visibilidade de Por perto (desliga sozinha em 1 h: quem chama passa o fim, em segundos). Ao ficar
   * invisível, sai a retirada do anúncio e a lista de perfis some (é recíproco: invisível não vê ninguém).
   */
  setNearby(o: { until: number | null; fee: number; name: string; photo?: string | null }) {
    const was = this.nearVisible();
    const fee = (NEAR_FEES as readonly number[]).includes(o.fee) ? o.fee : 3;
    const changed = fee !== this.near.fee || o.name !== this.near.name || (o.photo ?? '') !== (this.near.photo ?? '');
    this.near = { until: o.until ?? 0, fee, name: o.name, photo: o.photo };
    const now = this.nearVisible();
    if (was && !now) {
      this.withdraw();
      if (this.presences.size) { this.presences.clear(); this.o.events.nearbyChanged?.(); }
    } else if (now && (!was || changed)) this.announce();
  }

  private presenceBody(until: number): PresenceBody {
    return makePresence(this.o.identities.public, { name: this.near.name, fee: this.near.fee, photo: this.near.photo, now: this.o.now(), until, withPhoto: true });
  }

  /** Anuncia a presença a um vizinho (ou a todos). Só enquanto visível. */
  private announce(peerId?: string) {
    if (!this.nearVisible()) return;
    const body = this.presenceBody(this.near.until);
    this.shownUntil = Math.max(this.shownUntil, body.x);
    if (!peerId) this.lastAnnounce = this.o.now();
    for (const p of peerId ? [peerId] : [...this.peers.keys()]) {
      const withPhoto = !!body.photo && this.photoSent.get(p) !== body.ph;
      if (withPhoto) this.photoSent.set(p, body.ph);
      this.o.transmit(p, encodePresence(body, PRESENCE_HOPS, withPhoto)).catch(() => {});
    }
    this.o.events.changed?.();
  }

  /** Retirada: anúncio que vence na hora. Quem recebe apaga o perfil. */
  private withdraw() {
    const now = this.o.now();
    const body = this.presenceBody(now);
    this.shownUntil = Math.min(this.shownUntil, now);
    for (const p of this.peers.keys()) this.o.transmit(p, encodePresence(body, PRESENCE_HOPS, false)).catch(() => {});
    this.o.events.changed?.();
  }

  private onPresence(from: string, b: Uint8Array) {
    const now = this.o.now();
    const p = decodePresence(b, now);
    if (!p || p.id === this.o.identities.public.id || p.id === this.o.identities.anon.id) return;
    const traveled = PRESENCE_HOPS - p.hops;
    const key = `${p.id}|${p.at}|${p.until}`;
    const cur = this.presences.get(p.id);
    if (this.presenceSeen.has(key)) {
      // Mesmo anúncio por outro caminho: fica a menor distância.
      if (cur && cur.p.at === p.at && traveled < cur.traveled) { cur.traveled = traveled; cur.via = this.peers.get(from); this.o.events.nearbyChanged?.(); }
      return;
    }
    this.presenceSeen.add(key);
    while (this.presenceSeen.size > 2000) this.presenceSeen.delete(this.presenceSeen.values().next().value!);
    // Recíproco: só guardo perfis enquanto eu também estou visível.
    if (this.nearVisible() && !this.blocked.has(p.id) && (!cur || cur.p.at <= p.at)) {
      if (p.until <= now) this.presences.delete(p.id);
      else {
        const photo = p.photo ?? (cur && cur.p.photoHash === p.photoHash ? cur.p.photo : undefined);
        this.presences.set(p.id, { p: { ...p, photo }, traveled, via: this.peers.get(from) });
        while (this.presences.size > 200) this.presences.delete(this.presences.keys().next().value!);
      }
      this.o.events.nearbyChanged?.();
    }
    // Repasse (Modo nó): poucos saltos, nunca de volta a quem mandou.
    if (p.hops > 0 && this.router.relay) {
      const out = encodePresence(p.body, p.hops - 1, !!p.photo);
      for (const peer of this.peers.keys()) if (peer !== from) this.o.transmit(peer, out).catch(() => {});
    }
  }

  private nearTick() {
    const now = this.o.now();
    if (this.nearVisible() && now - this.lastAnnounce >= PRESENCE_EVERY_SEC) this.announce();
    let changed = false;
    for (const [id, e] of this.presences) if (e.p.until <= now || !this.nearVisible()) { this.presences.delete(id); changed = true; }
    if (changed) this.o.events.nearbyChanged?.();
    let saved = false;
    for (const [id, r] of this.nearIn) if (now - r.sentAt > NEAR_INVITE_TTL_SEC) { this.nearIn.delete(id); saved = true; }
    for (const [id, x] of this.nearOut) if (now - x.at > NEAR_INVITE_TTL_SEC + 3600) { this.nearOut.delete(id); saved = true; }
    for (const m of [this.nearAsked, this.nearSent]) for (const [id, at] of m) if (now - at >= NEAR_COOLDOWN_SEC) { m.delete(id); saved = true; }
    if (saved) { this.o.events.nearbyChanged?.(); this.o.events.changed?.(); }
  }

  /** Perfis visíveis agora, do mais perto ao mais longe. Vazio enquanto eu estiver invisível. */
  nearbyProfiles(): NearPeer[] {
    if (!this.nearVisible()) return [];
    const now = this.o.now();
    const medium = (v?: TransportClass) => (v === 'direct' ? 'Wi-Fi Direct' : v === 'ble' ? 'Bluetooth' : 'por perto');
    return [...this.presences.values()]
      .filter(e => e.p.until > now && !this.blocked.has(e.p.id) && !this.nearHidden.has(e.p.id))
      .sort((a, b) => a.traveled - b.traveled || b.p.at - a.p.at)
      .map(e => ({
        id: e.p.id, name: e.p.name, fee: e.p.fee, photo: e.p.photo, prox: proxOf(e.traveled), at: e.p.at,
        via: e.traveled === 0 ? `${medium(e.via)} · direto` : e.traveled === 1 ? '1 salto' : `${e.traveled} saltos`,
        common: this.inCommon(e.p.id),
      }));
  }

  /**
   * Denunciar perfil: some da minha lista de Por perto (só neste aparelho). Para onde vai a denúncia
   * depende da política de moderação da Lunes, ainda não definida: nada sai do aparelho.
   */
  hideNear(id: string) {
    this.nearHidden.add(id);
    while (this.nearHidden.size > 500) this.nearHidden.delete(this.nearHidden.values().next().value!);
    this.o.events.nearbyChanged?.();
    this.o.events.changed?.();
  }

  /** "Em comum": só o que este aparelho sabe (grupos públicos com a pessoa, ou se já é contato). */
  private inCommon(id: string) {
    const groups = [...this.groups.values()].filter(g => g.via === 'public' && isMemberOf(g, id)).map(g => g.name);
    const known = this.contacts.get(id);
    const parts = [
      ...(known && !known.request ? ['já é seu contato'] : []),
      ...(groups.length === 1 ? [groups[0]!] : groups.length > 1 ? [`${groups.length} grupos`] : []),
    ];
    return parts.length ? parts.join(' · ') : 'Nenhum';
  }

  /** Fim da espera (s) para convidar de novo a mesma pessoa (30 dias), ou `null` se pode convidar. */
  nearInviteBlockedUntil(profileId: string) {
    const at = this.nearSent.get(profileId);
    return at != null && this.o.now() - at < NEAR_COOLDOWN_SEC ? at + NEAR_COOLDOWN_SEC : null;
  }

  /**
   * Convite pago pela malha: envelope para a identidade pública anunciada, com o texto e a taxa que a
   * pessoa anunciou. A reserva do valor fica com quem chama (registro local até a Mainnet).
   */
  sendNearInvite(profileId: string, text: string) {
    const now = this.o.now();
    if (this.discovery !== 'all') throw new Error('Por perto está desligado em Privacidade → Quem pode me encontrar.');
    if (!this.nearVisible()) throw new Error('Fique visível em Por perto para convidar.');
    const e = this.presences.get(profileId);
    if (!e || e.p.until <= now) throw new Error('Esta pessoa não está mais por perto.');
    const x = text.trim();
    if (!x || [...x].length > NEAR_INVITE_MAX) throw new Error(`Escreva de 1 a ${NEAR_INVITE_MAX} caracteres.`);
    if (this.nearInviteBlockedUntil(profileId) != null) throw new Error('Sem insistência: um convite por pessoa a cada 30 dias.');
    const id = randomHex(8);
    const c: Contact = { id: profileId, via: 'public', pub: e.p.pub, name: e.p.name };
    this.nearOut.set(id, { to: profileId, pub: e.p.pub, name: e.p.name, fee: e.p.fee, at: now });
    this.nearSent.set(profileId, now);
    this.enqueue(c, { t: 'ni', i: id, x, f: e.p.fee, ...(this.near.name ? { n: this.near.name.slice(0, 40) } : {}) }, null, Priority.Normal, false, NEAR_INVITE_TTL_SEC);
    return { id, fee: e.p.fee, name: e.p.name };
  }

  private onNearInvite(m: Opened, used: IdentityKind, p: Extract<Payload, { t: 'ni' }>) {
    const now = this.o.now(), from = m.fromId;
    if (used !== 'public' || this.blocked.has(from)) return; // a anônima nunca recebe pedido de Por perto
    if (this.discovery !== 'all') return; // "Quem pode me encontrar": fora de Por perto, descarta
    const known = this.contacts.get(from);
    if (known && !known.request) return;
    // Só convite enviado enquanto eu estava visível, e ainda dentro das 24 h.
    if (!this.shownUntil || m.sentAt > this.shownUntil + 60 || now - m.sentAt > NEAR_INVITE_TTL_SEC) return;
    // A taxa é de quem recebe: convite abaixo da taxa vigente não entra.
    if (!(NEAR_FEES as readonly number[]).includes(p.f) || p.f < this.near.fee) return;
    const x = typeof p.x === 'string' ? p.x.trim() : '';
    if (typeof p.i !== 'string' || !/^[0-9a-f]{16}$/.test(p.i) || !x || [...x].length > NEAR_INVITE_MAX || this.nearIn.has(p.i)) return;
    const asked = this.nearAsked.get(from);
    if (asked != null && now - asked < NEAR_COOLDOWN_SEC) return; // sem insistência
    if ([...this.nearIn.values()].filter(r => r.status === 'pending').length >= MAX_NEAR_PENDING) return;
    const seen = this.presences.get(from);
    const r: NearIn = {
      id: p.i, from, pub: m.from, name: typeof p.n === 'string' && stripBidi(p.n).trim() ? stripBidi(p.n).trim().slice(0, 40) : seen?.p.name || 'Alguém por perto',
      fee: p.f, msg: x, prox: seen ? proxOf(seen.traveled) : 'mais longe', at: now, sentAt: m.sentAt, status: 'pending',
    };
    this.nearAsked.set(from, now);
    this.nearIn.set(r.id, r);
    const { pub: _pub, ...pub } = r;
    this.o.events.nearRequest?.(pub);
    this.o.events.nearbyChanged?.();
    this.o.events.changed?.();
  }

  /** Pedidos recebidos (pendentes e respondidos), do mais novo ao mais antigo. Somem 24 h depois do envio. */
  nearRequests(): NearRequest[] {
    return [...this.nearIn.values()].sort((a, b) => b.at - a.at).map(({ pub: _p, ...r }) => ({ ...r }));
  }

  /**
   * Responde um pedido. Aceitar: a pessoa vira contato público e recebe o aceite (o valor é de quem
   * aceitou). Recusar: nada sai daqui (o convite só expira). Bloquear: como recusar, e novos pedidos e
   * mensagens dessa identidade são descartados.
   */
  answerNear(id: string, answer: 'accept' | 'decline' | 'block'): { contact: Contact; request: NearRequest } | null {
    const r = this.nearIn.get(id);
    if (!r || r.status !== 'pending') return null;
    if (this.o.now() - r.sentAt > NEAR_INVITE_TTL_SEC) { this.nearIn.delete(id); this.o.events.changed?.(); throw new Error('Este pedido expirou.'); }
    let contact: Contact | null = null;
    if (answer === 'accept') {
      contact = { id: r.from, via: 'public', pub: r.pub, name: r.name };
      this.addContact(contact);
      this.enqueue(contact, { t: 'na', i: r.id }, null, Priority.High);
      r.status = 'accepted';
    } else if (answer === 'block') {
      r.status = 'blocked';
      this.blocked.add(r.from);
      this.presences.delete(r.from);
    } else r.status = 'declined';
    this.o.events.nearbyChanged?.();
    this.o.events.changed?.();
    const { pub: _p, ...req } = r;
    return contact ? { contact, request: req } : null;
  }

  private onNearAccept(from: string, sentAt: number, p: Extract<Payload, { t: 'na' }>) {
    const o = typeof p.i === 'string' ? this.nearOut.get(p.i) : undefined;
    if (!o || o.to !== from || sentAt - o.at > NEAR_INVITE_TTL_SEC + 60) return;
    this.nearOut.delete(p.i);
    const contact: Contact = { id: from, via: 'public', pub: o.pub, name: o.name };
    this.addContact(contact);
    this.o.events.nearAccepted?.(contact, o.fee);
    this.o.events.changed?.();
  }

  // ── grupos, canais e comunidades (FUN-006/007/008) ─────────────────────

  private myId(via: IdentityKind) { return this.o.identities[via].id; }
  getGroup(id: string) { return this.groups.get(id); }
  listGroups() { return [...this.groups.values()]; }
  pendingJoinsOf(gid: string) { return (this.pendingJoins.get(gid) ?? []).map(p => ({ id: p.id, name: p.name })); }

  private refreshGroupKeys() {
    const keys = [];
    for (const g of this.groups.values()) {
      keys.push(groupKeyOf(g));
      const prev = this.prevKeys.get(g.id);
      if (prev) keys.push(groupKeyOf({ id: g.id, keyV: prev.keyV, key: prev.key }));
    }
    this.router.groupKeys = keys;
  }

  /** Cria um grupo, canal ou comunidade comigo como admin e envia o estado a cada membro. */
  createGroup(o: { kind: GroupKind; name: string; desc?: string; via: IdentityKind; memberIds: string[]; send?: 'all' | 'admins'; inv?: 'all' | 'admins'; approve?: boolean; visibility?: ChannelVisibility; parent?: string; postMods?: boolean; prio?: GroupPriority }): GroupState {
    const me = this.o.identities[o.via];
    const members: GroupMember[] = [{ id: me.id, name: o.via === 'public' ? this.displayName || 'Você' : '', role: 'admin', pub: toPublic(me) }];
    for (const id of o.memberIds) {
      const c = this.contacts.get(id);
      if (!c || c.via !== o.via || c.request) throw new Error('Só contatos aceitos da mesma identidade entram no grupo.');
      if (!members.some(m => m.id === id)) members.push({ id, name: c.name, role: 'member', pub: c.pub });
    }
    if (members.length > MAX_GROUP_MEMBERS) throw new Error(`Até ${MAX_GROUP_MEMBERS} membros.`);
    const g: GroupState = {
      id: newGroupId(), kind: o.kind, name: o.name.trim().slice(0, 60), desc: (o.desc ?? '').slice(0, 200), via: o.via, rev: 1, keyV: 1, key: newKey(), members,
      send: o.kind === 'group' ? o.send ?? 'all' : 'admins', inv: o.inv ?? 'admins', approve: o.approve ?? true,
      visibility: o.kind === 'channel' ? o.visibility ?? 'private' : undefined, postMods: o.kind === 'channel' ? !!o.postMods : undefined, children: o.kind === 'community' ? [] : undefined, parent: o.parent,
      // Prioridade (canal de alerta): definida pelo admin na criação, vai no cabeçalho de cada publicação.
      ...(o.kind === 'channel' && o.prio === 'high' ? { prio: 'high' as const } : {}),
    };
    this.groups.set(g.id, g);
    this.refreshGroupKeys();
    this.distribute(g);
    // Dentro de uma comunidade minha: entra na lista dela.
    const parent = o.parent ? this.groups.get(o.parent) : undefined;
    if (parent && isAdmin(parent, me.id)) this.updateGroup(parent.id, { children: [...(parent.children ?? []), { id: g.id, name: g.name, kind: o.kind === 'channel' ? 'channel' : 'group' }] });
    this.o.events.changed?.();
    return g;
  }

  /** Envia o estado atual a cada membro (menos eu), pela sessão 1:1 de cada um. */
  private distribute(g: GroupState) {
    const me = this.myId(g.via);
    for (const m of g.members) {
      if (m.id === me) continue;
      let c = this.contacts.get(m.id);
      if (!c) { c = { id: m.id, via: g.via, pub: m.pub, name: m.name, groupOnly: true }; this.contacts.set(c.id, c); }
      this.enqueue(c, { t: 'g', s: encodeState(g, m.role === 'admin' ? 'admin' : 'member', m.id) }, null, Priority.High);
    }
  }

  private assertAdmin(gid: string) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    if (!isAdmin(g, this.myId(g.via))) throw new Error('Só admins mudam o grupo.');
    return g;
  }

  /** Muda nome, regras ou a lista de uma comunidade (admin). */
  updateGroup(gid: string, patch: Partial<Pick<GroupState, 'name' | 'desc' | 'send' | 'inv' | 'approve' | 'visibility' | 'children' | 'postMods'>>) {
    const g = this.assertAdmin(gid);
    const p = { ...patch };
    // Nome e descrição: mesmos limites da criação (e do estado recebido, groups.ts).
    if (p.name !== undefined) { p.name = p.name.trim().slice(0, 60); if (!p.name) throw new Error('O nome não pode ficar vazio.'); }
    if (p.desc !== undefined) p.desc = p.desc.trim().slice(0, 200);
    const next: GroupState = { ...g, ...p, rev: g.rev + 1 };
    if (next.kind !== 'group') next.send = 'admins';
    this.groups.set(gid, next);
    this.distribute(next);
    // Renomeado dentro de uma comunidade minha: a lista dela mostra o nome novo.
    const parent = next.parent ? this.groups.get(next.parent) : undefined;
    if (p.name && p.name !== g.name && parent?.children?.some(x => x.id === gid) && isAdmin(parent, this.myId(parent.via)))
      this.updateGroup(parent.id, { children: parent.children.map(x => (x.id === gid ? { ...x, name: next.name } : x)) });
    this.o.events.changed?.();
    return next;
  }

  /** Membro comum pode convidar? ("Quem pode convidar: Todos os membros"; só em grupo, nunca em canal.) */
  canInvite(gid: string) {
    const g = this.groups.get(gid);
    if (!g) return false;
    const me = this.myId(g.via);
    return isAdmin(g, me) || (g.kind === 'group' && g.inv === 'all' && isMemberOf(g, me));
  }

  /**
   * Acrescenta contatos ao grupo. Admin: entra na hora (a chave não muda). Membro, com "Quem pode
   * convidar: Todos os membros": a indicação vai aos admins (que conferem a regra de novo e, com
   * "Aprovar quem entra", deixam o pedido aguardando), e cada convidado é avisado de quais admins vão
   * mandar o estado. Devolve o estado atual (sem mudança, no caso do membro).
   */
  addMembers(gid: string, ids: string[]) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    const me = this.myId(g.via);
    if (!this.canInvite(gid)) throw new Error('Sem permissão para convidar.');
    if (!isAdmin(g, me)) return this.inviteAsMember(g, ids);
    const members = [...g.members];
    for (const id of ids) {
      const c = this.contacts.get(id);
      if (!c || c.via !== g.via) continue;
      if (!members.some(m => m.id === id)) members.push({ id, name: c.name, role: 'member', pub: c.pub });
    }
    if (members.length > MAX_GROUP_MEMBERS) throw new Error(`Até ${MAX_GROUP_MEMBERS} membros.`);
    const next = { ...g, members, rev: g.rev + 1 };
    this.groups.set(gid, next);
    this.distribute(next);
    this.o.events.changed?.();
    return next;
  }

  private inviteAsMember(g: GroupState, ids: string[]) {
    const picked = ids.slice(0, MAX_INVITE_BATCH).map(id => this.contacts.get(id)).filter((c): c is Contact => !!c && c.via === g.via && !c.request && !isMemberOf(g, c.id));
    if (!picked.length) return g;
    const me = this.myId(g.via);
    const admins = g.members.filter(m => m.role === 'admin' && m.id !== me);
    const wire = picked.map(c => toWire(c.id, c.name, c.pub));
    for (const m of admins) this.enqueue(this.contacts.get(m.id) ?? { id: m.id, via: g.via, pub: m.pub, name: m.name }, { t: 'ga', g: g.id, m: wire }, null, Priority.High);
    const adminWire = admins.map(m => toWire(m.id, m.name, m.pub));
    for (const c of picked) this.enqueue(c, { t: 'gv', g: g.id, a: adminWire }, null, Priority.High);
    return g;
  }

  /** Admin recebe a indicação de um membro: confere a regra e o remetente, e adiciona (ou deixa aguardando). */
  private onMemberInvite(from: string, p: Extract<Payload, { t: 'ga' }>) {
    const g = typeof p.g === 'string' ? this.groups.get(p.g) : undefined;
    if (!g || g.kind !== 'group' || g.inv !== 'all' || !isAdmin(g, this.myId(g.via)) || !isMemberOf(g, from) || !Array.isArray(p.m)) return;
    const add: string[] = [];
    for (const w of p.m.slice(0, MAX_INVITE_BATCH)) {
      const x = fromWire(w);
      if (!x || isMemberOf(g, x.id) || this.blocked.has(x.id) || x.id === this.myId(g.via)) continue;
      if (g.approve) {
        const list = (this.pendingJoins.get(g.id) ?? []).filter(q => q.id !== x.id);
        if (list.length >= 100) break;
        this.pendingJoins.set(g.id, [...list, { id: x.id, name: x.name, via: g.via, pub: x.pub, at: this.o.now() }]);
        this.o.events.joinRequest?.(g.id, { id: x.id, name: x.name });
        continue;
      }
      if (!this.contacts.has(x.id)) this.contacts.set(x.id, { id: x.id, via: g.via, pub: x.pub, name: x.name, groupOnly: true });
      add.push(x.id);
    }
    if (add.length) this.addMembers(g.id, add);
    this.o.events.changed?.();
  }

  /** Convidado: guarda de quais admins aceitar o primeiro estado (só se a indicação veio de contato aceito). */
  private onVouch(from: string, p: Extract<Payload, { t: 'gv' }>) {
    const c = this.contacts.get(from);
    if (!c || c.request || typeof p.g !== 'string' || !/^[0-9a-f]{32}$/.test(p.g) || this.groups.has(p.g) || !Array.isArray(p.a)) return;
    const admins = p.a.slice(0, 20).map(fromWire).filter(x => !!x).map(x => x!.id);
    if (!admins.length) return;
    this.vouched.set(p.g, { via: c.via, admins, at: this.o.now() });
    while (this.vouched.size > 100) this.vouched.delete(this.vouched.keys().next().value!);
    this.o.events.changed?.();
  }

  /** Remove alguém e troca a chave do grupo (v → v+1): quem saiu não lê nada novo. */
  removeMember(gid: string, id: string) {
    const g = this.assertAdmin(gid);
    if (!isMemberOf(g, id)) return g;
    this.prevKeys.set(gid, { keyV: g.keyV, key: g.key });
    const next: GroupState = { ...g, members: g.members.filter(m => m.id !== id), rev: g.rev + 1, keyV: g.keyV + 1, key: newKey() };
    if (!next.members.some(m => m.role === 'admin')) throw new Error('O grupo precisa de pelo menos um admin.');
    this.groups.set(gid, next);
    this.refreshGroupKeys();
    this.distribute(next);
    const c = this.contacts.get(id);
    if (c) this.enqueue(c, { t: 'gr', g: gid }, null, Priority.High);
    this.o.events.changed?.();
    return next;
  }

  /** Torna alguém admin (ou membro de novo). */
  setRole(gid: string, id: string, role: 'admin' | 'mod' | 'member') {
    const g = this.assertAdmin(gid);
    const next = { ...g, members: g.members.map(m => (m.id === id ? { ...m, role } : m)), rev: g.rev + 1 };
    if (!next.members.some(m => m.role === 'admin')) throw new Error('O grupo precisa de pelo menos um admin.');
    this.groups.set(gid, next);
    this.distribute(next);
    this.o.events.changed?.();
    return next;
  }

  /** Sair: avisa os admins (que trocam a chave) e apaga o grupo deste aparelho. */
  leaveGroup(gid: string) {
    const g = this.groups.get(gid);
    if (!g) return;
    const me = this.myId(g.via);
    for (const m of g.members) {
      if (m.role !== 'admin' || m.id === me) continue;
      const c = this.contacts.get(m.id) ?? { id: m.id, via: g.via, pub: m.pub, name: m.name };
      this.enqueue(c, { t: 'gl', g: gid }, null, Priority.High);
    }
    this.groups.delete(gid); this.prevKeys.delete(gid); this.alertBook.dropCommunity(gid);
    this.refreshGroupKeys();
    this.o.events.changed?.();
  }

  /** Envia texto ao grupo (envelope de grupo, cifrado com a chave atual). */
  sendGroupText(gid: string, msgId: string, text: string, loc?: WireLocation) {
    const g = this.groups.get(gid);
    if (!g) throw new Error('Grupo desconhecido.');
    const me = this.o.identities[g.via];
    if (!canPost(g, me.id)) throw new Error(g.kind === 'group' ? 'Só admins publicam neste grupo.' : 'Só admins publicam aqui.');
    if (loc && !readWireLocation([loc.lat, loc.lon])) throw new Error('Coordenadas inválidas.');
    const now = this.o.now();
    const x = text.slice(0, MAX_TEXT);
    // `@Nome` de membros vira a lista de ids mencionados (vai cifrada junto do texto).
    const mentions = mentionIds(x, g.members, me.id);
    const sealed = sealGroup({ from: me, group: groupKeyOf(g), type: MsgType.Text, body: encodeGroupText(msgId, x, mentions, loc && wireLocation(loc)), now, ttlSec: TTL_SEC, priority: groupPriority(g), pad: this.o.pad?.() ?? true });
    const delaySec = this.o.randomDelay?.() ? randomDelaySec() : 0;
    const r = this.router.send(sealed.bytes, now, { delaySec });
    if (r.status === 'stored') this.groupOut.set(sealed.id, msgId);
    this.o.events.changed?.();
    this.flushAll();
  }

  /** Prioridade com que as publicações deste grupo saem (para a tela de rota). */
  groupPriority(gid: string) { const g = this.groups.get(gid); return g ? groupPriority(g) : Priority.Normal; }

  /** Convite do grupo (link/QR): vale 7 dias e até 50 usos. `fresh` revoga o anterior. */
  groupInvite(gid: string, fresh = false) {
    const g = this.assertAdmin(gid);
    const now = this.o.now();
    if (!fresh && g.invite && g.invite.expiresAt > now && g.invite.uses < GROUP_INVITE_MAX_USES) return g.invite;
    const invite = { code: toHex(random(8)), expiresAt: now + GROUP_INVITE_TTL_SEC, uses: 0 };
    this.groups.set(gid, { ...g, invite });
    this.o.events.changed?.();
    return invite;
  }

  /** Quem escaneou o convite do grupo pede para entrar (vai para o admin que gerou o convite). */
  requestJoin(admin: Contact, gid: string, code: string) {
    const c = this.contacts.get(admin.id) ?? admin;
    if (!this.contacts.has(c.id)) { this.addContact({ ...c, invite: undefined }); }
    const p: Payload = { t: 'gj', g: gid, c: code };
    if (c.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    this.enqueue(this.contacts.get(c.id)!, p, null, Priority.High);
  }

  /** Membro de uma comunidade pede para entrar num grupo/canal dela (vai para os admins do grupo). */
  requestJoinChild(communityId: string, childId: string) {
    const com = this.groups.get(communityId);
    if (!com || !com.children?.some(x => x.id === childId)) throw new Error('Grupo fora desta comunidade.');
    const p: Payload = { t: 'gj', g: childId, c: 'community:' + communityId };
    if (com.via === 'public' && this.displayName) p.n = this.displayName.slice(0, 40);
    const me = this.myId(com.via);
    for (const m of com.members) {
      if (m.role !== 'admin' || m.id === me) continue;
      const c = this.contacts.get(m.id) ?? { id: m.id, via: com.via, pub: m.pub, name: m.name, groupOnly: true };
      if (!this.contacts.has(c.id)) this.contacts.set(c.id, c);
      this.enqueue(c, p, null, Priority.High);
    }
  }

  /**
   * Envia um aviso (ex.: aparelho revogado) a todos os contatos aceitos da identidade `via` e aos
   * admins dos grupos dessa identidade em que não sou admin (mesmo que não sejam contatos): eles trocam
   * a chave do grupo ao conferir o aviso. `skip`: quem já recebeu (não manda de novo). Devolve para
   * quem saiu agora.
   */
  broadcastNotice(via: IdentityKind, notice: string, skip: Iterable<string> = []): string[] {
    const sent = new Set<string>(skip);
    const out: string[] = [];
    for (const c of this.contacts.values()) if (c.via === via && !c.request && !sent.has(c.id)) { sent.add(c.id); out.push(c.id); this.enqueue(c, { t: 'rv', n: notice }, null, Priority.High); }
    const me = this.myId(via);
    for (const g of this.groups.values()) {
      if (g.via !== via || isAdmin(g, me)) continue;
      for (const m of g.members) {
        if (m.role !== 'admin' || sent.has(m.id)) continue;
        sent.add(m.id); out.push(m.id);
        this.enqueue({ id: m.id, via, pub: m.pub, name: m.name }, { t: 'rv', n: notice }, null, Priority.High);
      }
    }
    return out;
  }

  /** Avisos de revogação já tratados (cada aviso troca a chave uma vez só). */
  private rotatedFor: string[] = [];
  /** Última troca de chave por aviso de cada pessoa (s, só na memória). */
  private revokeRotatedAt = new Map<string, number>();

  /** Troca a chave do grupo sem tirar ninguém (v → v+1). Só admin. */
  rotateKey(gid: string) {
    const g = this.assertAdmin(gid);
    this.prevKeys.set(gid, { keyV: g.keyV, key: g.key });
    const next: GroupState = { ...g, rev: g.rev + 1, keyV: g.keyV + 1, key: newKey() };
    this.groups.set(gid, next);
    this.refreshGroupKeys();
    this.distribute(next);
    this.o.events.groupUpdated?.(next, 'updated');
    this.o.events.changed?.();
    return next;
  }

  /**
   * Aparelho revogado (design: "Grupos trocam de chave conforme os nós recebem o aviso"). Troca a
   * chave de cada grupo em que sou admin e `who` participa; `who` = eu mesmo quando a revogação é
   * minha (aí valem os grupos da identidade `via`). Uma vez por aviso (`noticeId`). Devolve os grupos.
   *
   * Um admin só por grupo troca, para dois admins não publicarem chaves diferentes na mesma revisão:
   * quem revogou, se for admin; senão, o admin de menor id.
   */
  rotateForRevocation(who: string, noticeId: string, via?: IdentityKind): GroupState[] {
    if (this.rotatedFor.includes(noticeId)) return [];
    this.rotatedFor.push(noticeId);
    while (this.rotatedFor.length > 200) this.rotatedFor.shift();
    // Aviso de outra pessoa: no máximo uma troca de chave por pessoa a cada 10 min (quem assina avisos
    // sem parar não faz os grupos trocarem de chave sem parar). A minha revogação sempre troca.
    const mine = who === this.o.identities.public.id || who === this.o.identities.anon.id;
    const now = this.o.now();
    if (!mine) {
      const last = this.revokeRotatedAt.get(who);
      if (last !== undefined && now - last < REVOKE_ROTATE_EVERY_SEC) return [];
      this.revokeRotatedAt.delete(who);
      this.revokeRotatedAt.set(who, now);
      while (this.revokeRotatedAt.size > 200) this.revokeRotatedAt.delete(this.revokeRotatedAt.keys().next().value as string);
    }
    const out: GroupState[] = [];
    for (const g of [...this.groups.values()]) {
      const me = this.myId(g.via);
      if (via && g.via !== via) continue;
      if (!isAdmin(g, me) || !isMemberOf(g, who)) continue;
      const leader = isAdmin(g, who) ? who : g.members.filter(m => m.role === 'admin').map(m => m.id).sort()[0];
      if (leader !== me) continue;
      out.push(this.rotateKey(g.id));
    }
    this.o.events.changed?.();
    return out;
  }

  /**
   * Foto do perfil público para os contatos públicos (nunca pela identidade anônima, nunca para
   * pedidos de conversa ainda não aceitos nem para bloqueados). `to`: só um contato (novo contato).
   * Vai marcada como mídia: nunca passa por LoRa.
   */
  /**
   * Endereço Lunes para os contatos públicos (nunca pela identidade anônima, nunca para pedidos de
   * conversa ainda não aceitos nem para bloqueados), para aparecerem como destinatários na Carteira.
   * `null` = parei de compartilhar. `to`: só um contato (novo contato).
   */
  sendWalletAddress(address: string | null, to?: string) {
    if (address && !isLunesAddress(address)) throw new Error('Endereço Lunes inválido.');
    for (const c of this.contacts.values()) {
      if (c.via !== 'public' || c.request || c.groupOnly || this.blocked.has(c.id) || (to && c.id !== to)) continue;
      this.enqueue(c, { t: 'wa', a: address ?? '' }, null, Priority.Low, false);
    }
  }

  /** Contato público aceito (não bloqueado) para o modo nó, ou erro. */
  private nodeContact(contactId: string): Contact {
    const c = this.contacts.get(contactId);
    if (!c || c.via !== 'public' || c.request || this.blocked.has(c.id)) throw new Error('Aval só entre contatos públicos aceitos.');
    return c;
  }

  /**
   * Modo nó: pede aval a um contato público aceito para a chave de operador deste celular (hex).
   * `createdAt` (s): o pedido vence 3 dias depois; `bondOk`: minha caução já finalizou; `cancel`: desisto.
   */
  requestEndorsement(contactId: string, phonePk: string, o: { createdAt: number; bondOk: boolean; cancel?: boolean } = { createdAt: this.o.now(), bondOk: false }) {
    if (!/^[0-9a-f]{64}$/.test(phonePk)) throw new Error('Chave de celular inválida.');
    this.enqueue(this.nodeContact(contactId), { t: 'ar', p: phonePk, c: o.createdAt, b: o.bondOk ? 1 : 0, ...(o.cancel ? { x: 1 as const } : {}) }, null, Priority.Low, true);
  }

  /** Modo nó: avisa um contato público aceito desde quando estou no modo nó (0 = saí). */
  sendNodeStatus(contactId: string, since: number) {
    this.enqueue(this.nodeContact(contactId), { t: 'ns', s: Math.max(0, Math.floor(since)) }, null, Priority.Low, true);
  }

  /** Modo nó: manda o aval (já assinado pela chave de operador deste celular) a um contato público aceito. */
  sendEndorsement(contactId: string, e: EndorsementJson) {
    this.enqueue(this.nodeContact(contactId), { t: 'av', e }, null, Priority.Low, true);
  }

  sendProfilePhoto(jpegBase64: string | null, to?: string) {
    for (const c of this.contacts.values()) {
      if (c.via !== 'public' || c.request || c.groupOnly || this.blocked.has(c.id) || (to && c.id !== to)) continue;
      this.enqueue(c, { t: 'pp', p: jpegBase64 ?? '' }, null, Priority.Low, true);
    }
  }

  /**
   * Contatos bloqueados: o que eles mandam é descartado sem confirmação (quem mandou não é avisado,
   * a mensagem só não é entregue), e eles não recebem a foto do perfil.
   */
  private blocked = new Set<string>();
  setBlocked(ids: Iterable<string>) { this.blocked = new Set(ids); }
  isBlocked(id: string) { return this.blocked.has(id); }

  /** Admin aprova ou recusa um pedido pendente. */
  answerJoin(gid: string, id: string, accept: boolean) {
    const list = this.pendingJoins.get(gid) ?? [];
    const p = list.find(x => x.id === id);
    this.pendingJoins.set(gid, list.filter(x => x.id !== id));
    if (!p) return;
    if (accept) {
      if (!this.contacts.has(p.id)) this.contacts.set(p.id, { id: p.id, via: p.via, pub: p.pub, name: p.name, groupOnly: true });
      this.addMembers(gid, [p.id]);
    }
    this.o.events.changed?.();
  }

  private onJoinRequest(from: string, via: IdentityKind, pub: PublicIdentity, p: Extract<Payload, { t: 'gj' }>) {
    const g = typeof p.g === 'string' ? this.groups.get(p.g) : undefined;
    if (!g || g.via !== via || !isAdmin(g, this.myId(via))) return;
    const inv = g.invite;
    // Pedido por convite (código do link) ou por fazer parte da comunidade que reúne o grupo.
    const viaCommunity = typeof p.c === 'string' && p.c.startsWith('community:') && g.parent === p.c.slice(10)
      && !!this.groups.get(g.parent) && isMemberOf(this.groups.get(g.parent)!, from);
    const viaInvite = !!inv && inv.code === p.c && inv.expiresAt > this.o.now() && inv.uses < GROUP_INVITE_MAX_USES;
    if (!viaCommunity && !viaInvite) return;
    if (isMemberOf(g, from)) { this.distribute(g); return; }
    const name = typeof p.n === 'string' && via === 'public' ? stripBidi(p.n).slice(0, 40) : '';
    if (viaInvite && inv) this.groups.set(g.id, { ...g, invite: { ...inv, uses: inv.uses + 1 } });
    if (g.approve) {
      const list = (this.pendingJoins.get(g.id) ?? []).filter(x => x.id !== from);
      if (list.length >= 100) return;
      this.pendingJoins.set(g.id, [...list, { id: from, name, via, pub, at: this.o.now() }]);
      this.o.events.joinRequest?.(g.id, { id: from, name });
      this.o.events.changed?.();
      return;
    }
    if (!this.contacts.has(from)) this.contacts.set(from, { id: from, via, pub, name, groupOnly: true });
    this.addMembers(g.id, [from]);
  }

  private onGroupControl(from: string, p: Payload) {
    if (p.t === 'g') {
      const cur0 = (() => { try { return this.groups.get((JSON.parse(p.s) as { id?: string }).id ?? ''); } catch { return undefined; } })();
      const contact = this.contacts.get(from);
      const gid0 = (() => { try { return String((JSON.parse(p.s) as { id?: string }).id ?? ''); } catch { return ''; } })();
      // Indicado por um membro: aceita o primeiro estado só dos admins que ele apontou (prazo de 7 dias).
      const vouch = !cur0 ? this.vouched.get(gid0) : undefined;
      const vouchOk = !!vouch && vouch.admins.includes(from) && vouch.at + GROUP_INVITE_TTL_SEC > this.o.now();
      const via = cur0?.via ?? (contact && !contact.request ? contact.via : vouchOk ? vouch!.via : contact?.via);
      if (!via) return;
      const g = decodeState(p.s, via);
      if (!g) return;
      const cur = this.groups.get(g.id);
      // Só aceita de quem é admin (no estado que eu já tenho; num grupo novo, no próprio estado e sendo contato aceito ou indicado).
      if (cur ? !isAdmin(cur, from) : !isAdmin(g, from) || ((!contact || contact.request) && !vouchOk)) return;
      if (!cur) this.vouched.delete(g.id);
      if (!isAdmin(g, from)) return;
      if (cur && (g.rev <= cur.rev || g.keyV < cur.keyV)) return; // sem voltar atrás
      const me = this.myId(via);
      if (!isMemberOf(g, me)) { this.dropGroup(g.id, cur); return; }
      if (cur && g.keyV > cur.keyV) this.prevKeys.set(g.id, { keyV: cur.keyV, key: cur.key });
      // Código de convite só fica com admins.
      if (!isAdmin(g, me)) delete g.invite; else if (cur?.invite && !g.invite) g.invite = cur.invite;
      this.groups.set(g.id, g);
      this.refreshGroupKeys();
      this.o.events.groupUpdated?.(g, cur ? 'updated' : 'joined');
      this.o.events.changed?.();
      return;
    }
    if (p.t !== 'gr' && p.t !== 'gl') return;
    const g = typeof p.g === 'string' ? this.groups.get(p.g) : undefined;
    if (!g) return;
    if (p.t === 'gr' && isAdmin(g, from)) this.dropGroup(g.id, g);
    if (p.t === 'gl' && isMemberOf(g, from) && isAdmin(g, this.myId(g.via))) this.removeMember(g.id, from);
  }

  private dropGroup(gid: string, cur: GroupState | undefined) {
    this.groups.delete(gid); this.prevKeys.delete(gid);
    this.alertBook.dropCommunity(gid);
    this.refreshGroupKeys();
    if (cur) this.o.events.groupUpdated?.(cur, 'removed');
    this.o.events.changed?.();
  }

  private onGroupEnvelope(m: Opened) {
    const gid = m.group?.id;
    const g = gid ? this.groups.get(gid) : undefined;
    if (!g || m.type !== MsgType.Text) return;
    if (g.kind === 'community') {
      const w = decodeAlertPayload(m.body);
      if (w) { this.onAlertPayload(g, m.fromId, m.sentAt, w); return; }
    }
    const t = decodeGroupText(m.body);
    if (!t) return;
    // Comunidade: o roteador abre de qualquer membro (alertas); texto dos avisos, só de quem publica.
    if (!canPost(g, m.fromId)) return;
    const key = `${gid}|${m.fromId}|${t.i}`;
    if (this.deliveredSet.has(key)) return;
    this.markDelivered(key);
    if (m.fromId === this.myId(g.via)) return; // minha própria, voltando pela malha
    const who = g.members.find(x => x.id === m.fromId);
    const mentioned = !!t.m?.includes(this.myId(g.via));
    const loc = readWireLocation(t.l);
    this.o.events.groupMessage?.(g.id, m.fromId, who?.name || 'Membro', { msgId: t.i, text: t.x, sentAt: m.sentAt, ...(mentioned ? { mentioned } : {}), ...(loc ? { loc } : {}), ...(this.rx ? { route: this.rx } : {}) });
    this.o.events.changed?.();
  }

  // ── alertas da comunidade (communityAlerts.ts) ───────────────────────

  private alertBook: AlertBook;
  /** Estado de cada alerta na última vez que avisei a tela (para saber o que mudou). */
  private alertSeen = new Map<string, AlertStatus>();

  private alertView(id: string): AlertView | null {
    const a = this.alertBook.get(id);
    const g = a ? this.groups.get(a.community) : undefined;
    return a && g ? this.alertBook.view(id, g.members, this.myId(g.via), this.o.now(), g.name) : null;
  }

  /** Recalcula e avisa a tela do alerta (com o que merece notificação). */
  private emitAlert(id: string, fresh: boolean) {
    const v = this.alertView(id);
    if (!v) return;
    const prev = fresh ? null : this.alertSeen.get(id) ?? v.status;
    this.alertSeen.set(id, v.status);
    this.o.events.communityAlert?.(v, noticeFor(prev, v));
  }

  private onAlertPayload(g: GroupState, from: string, sentAt: number, w: NonNullable<ReturnType<typeof decodeAlertPayload>>) {
    const key = `${g.id}|${from}|${w.i}`;
    if (this.deliveredSet.has(key)) return;
    this.markDelivered(key);
    const now = this.o.now();
    if (w.kind === 'alert') {
      const who = g.members.find(x => x.id === from);
      const r = this.alertBook.addAlert({ id: w.i, community: g.id, author: from, authorName: who?.name || 'Membro', cat: w.cat, sev: w.sev, title: w.title, text: w.text, area: w.area, at: sentAt, until: sentAt + w.dur }, now, g.members);
      if (r !== 'ok') return;
      this.o.events.changed?.();
      if (from !== this.myId(g.via)) this.emitAlert(w.i, true);
      return;
    }
    const a = this.alertBook.get(w.alert);
    if (a && a.community !== g.id) return; // voto para alerta de outra comunidade
    const ok = w.kind === 'vote' ? this.alertBook.addVote(w.alert, from, w.v, sentAt, w.i, g.members, w.n) : this.alertBook.addClose(w.alert, from, sentAt, g.members);
    if (!ok) return;
    this.o.events.changed?.();
    if (a) this.emitAlert(a.id, false);
  }

  private sealAlert(g: GroupState, body: Uint8Array, ttlSec: number, priority: Priority) {
    const me = this.o.identities[g.via];
    const now = this.o.now();
    const sealed = sealGroup({ from: me, group: groupKeyOf(g), type: MsgType.Text, body, now, ttlSec: Math.max(60, Math.min(TTL_SEC, ttlSec)), priority, pad: this.o.pad?.() ?? true });
    const delaySec = this.o.randomDelay?.() ? randomDelaySec() : 0;
    this.router.send(sealed.bytes, now, { delaySec });
    this.o.events.changed?.();
    this.flushAll();
  }

  private assertCommunity(gid: string) {
    const g = this.groups.get(gid);
    if (!g || g.kind !== 'community') throw new Error('Comunidade desconhecida.');
    return g;
  }

  /**
   * Publica um alerta na comunidade (qualquer membro). Vai no grupo da comunidade, cifrado com a
   * chave dela e com prioridade Alta. Limite: 3 ativos por membro e 1 a cada 10 min.
   */
  publishAlert(gid: string, d: { cat: AlertCategory; sev: AlertSeverity; title: string; text: string; area?: string; durSec: number }): AlertView {
    const g = this.assertCommunity(gid);
    const me = this.myId(g.via);
    const bad = checkDraft({ ...d, dur: d.durSec });
    if (bad) throw new Error(bad);
    const now = this.o.now();
    const limit = this.alertBook.canPublish(g.id, me, now, g.members);
    if (limit) throw new Error(limit);
    const id = randomHex(16);
    const title = d.title.trim(), text = d.text.trim(), area = (d.area ?? '').trim();
    const name = g.members.find(m => m.id === me)?.name || (g.via === 'public' ? this.displayName : '') || 'Você';
    if (this.alertBook.addAlert({ id, community: g.id, author: me, authorName: name, cat: d.cat, sev: d.sev, title, text, area, at: now, until: now + d.durSec }, now, g.members) !== 'ok')
      throw new Error('Não foi possível publicar o alerta.');
    this.markDelivered(`${g.id}|${me}|${id}`);
    this.sealAlert(g, encodeAlertPayload({ kind: 'alert', i: id, cat: d.cat, sev: d.sev, title, text, area, dur: d.durSec }), d.durSec, Priority.High);
    const v = this.alertView(id)!;
    this.alertSeen.set(id, v.status);
    return v;
  }

  /** "Confirmo" ou "Não procede" (um voto por membro; pode mudar). O autor não classifica o próprio. */
  voteAlert(alertId: string, v: Vote): AlertView {
    const cur = this.alertView(alertId);
    if (!cur) throw new Error('Alerta não encontrado.');
    if (!cur.canVote) throw new Error(cur.mine ? 'Você publicou este alerta: quem classifica são os outros membros.' : 'Este alerta não aceita mais classificação.');
    if (cur.myVote === v) return cur;
    const g = this.groups.get(cur.community)!;
    const me = this.myId(g.via);
    const now = this.o.now();
    const i = randomHex(16);
    const n = this.alertBook.nextVoteRev(alertId, me);
    this.alertBook.addVote(alertId, me, v, now, i, g.members, n);
    this.markDelivered(`${g.id}|${me}|${i}`);
    this.sealAlert(g, encodeAlertPayload({ kind: 'vote', i, alert: alertId, v, n }), cur.until - now, Priority.Normal);
    const out = this.alertView(alertId)!;
    this.alertSeen.set(alertId, out.status);
    return out;
  }

  /** Encerra o alerta (o autor, ou admin/moderador da comunidade). */
  closeAlert(alertId: string): AlertView {
    const cur = this.alertView(alertId);
    if (!cur) throw new Error('Alerta não encontrado.');
    if (!cur.canClose) throw new Error('Só quem publicou, admins e moderadores encerram o alerta.');
    const g = this.groups.get(cur.community)!;
    const me = this.myId(g.via);
    const now = this.o.now();
    const i = randomHex(16);
    this.alertBook.addClose(alertId, me, now, g.members);
    this.markDelivered(`${g.id}|${me}|${i}`);
    this.sealAlert(g, encodeAlertPayload({ kind: 'close', i, alert: alertId }), cur.until - now, Priority.Normal);
    const out = this.alertView(alertId)!;
    this.alertSeen.set(alertId, out.status);
    return out;
  }

  /** Um alerta (de uma comunidade em que estou). */
  communityAlert(id: string) { return this.alertView(id); }

  /** Alertas das minhas comunidades (ou de uma), na ordem da lista. */
  communityAlerts(gid?: string): AlertView[] {
    const out: AlertView[] = [];
    for (const a of this.alertBook.all()) {
      if (gid && a.community !== gid) continue;
      const v = this.alertView(a.id);
      if (v) out.push(v);
    }
    return sortViews(out);
  }

  /** Posso publicar agora nesta comunidade? Motivo, ou `null`. */
  alertLimit(gid: string): string | null {
    const g = this.groups.get(gid);
    if (!g || g.kind !== 'community') return 'Comunidade desconhecida.';
    return this.alertBook.canPublish(g.id, this.myId(g.via), this.o.now(), g.members);
  }

  /** Vencidos há mais de 24 h saem do aparelho; quem venceu agora atualiza a tela (sem notificar). */
  private tickAlerts() {
    const now = this.o.now();
    if (this.alertBook.prune(now)) this.o.events.changed?.();
    for (const a of this.alertBook.all()) {
      const before = this.alertSeen.get(a.id);
      if (!before) { const v = this.alertView(a.id); if (v) this.alertSeen.set(a.id, v.status); continue; }
      if (before !== 'expired' && before !== 'closed' && now >= a.until) this.emitAlert(a.id, false);
    }
    for (const id of [...this.alertSeen.keys()]) if (!this.alertBook.get(id)) this.alertSeen.delete(id);
  }

  // ── créditos, provas de entrega e métricas ───────────────────────────

  readonly credits: CreditBook;
  /** Dias com entrega confirmada para contatos distintos (andamento do bônus). */
  readonly deliveryDays: DeliveryDays;
  private accepted: AcceptedInvites;
  private proofs = new Map<string, Proof>();
  private proofsV2 = new Map<string, ProofV2[]>();
  private days = new Map<string, DayMetrics>();

  private day(): DayMetrics {
    const k = this.clock.day();
    let d = this.days.get(k);
    if (!d) { d = emptyDay(); this.days.set(k, d); while (this.days.size > 7) this.days.delete(this.days.keys().next().value!); }
    return d;
  }
  private sample(arr: number[], v: number) { arr.push(Math.max(0, v)); if (arr.length > MAX_SAMPLES) arr.shift(); }

  /** Métricas dos últimos 7 dias (diagnóstico local). */
  metrics() {
    const days = [...this.days.values()];
    const sum = (f: (d: DayMetrics) => number) => days.reduce((a, d) => a + f(d), 0);
    const all = (f: (d: DayMetrics) => number[]) => days.flatMap(f).sort((a, b) => a - b);
    const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
    const hops: Record<string, number> = {};
    for (const d of days) for (const [k, v] of Object.entries(d.hops)) hops[k] = (hops[k] ?? 0) + v;
    const via: Record<string, { ok: number; fail: number; median: number | null }> = {};
    for (const d of days) for (const [k, v] of Object.entries(d.via)) {
      const cur = via[k] ?? { ok: 0, fail: 0, median: null };
      via[k] = { ok: cur.ok + v.ok, fail: cur.fail + v.fail, median: null };
    }
    for (const k of Object.keys(via)) via[k].median = pct(days.flatMap(d => d.via[k]?.lat ?? []).sort((a, b) => a - b), 0.5);
    const lat = all(d => d.lat), queue = all(d => d.queue);
    const today = this.day();
    return {
      sent: sum(d => d.sent), delivered: sum(d => d.delivered), expired: sum(d => d.expired),
      latencyMedian: pct(lat, 0.5), latencyP95: pct(lat, 0.95), queueMean: queue.length ? queue.reduce((a, b) => a + b, 0) / queue.length : null, queueMax: queue.at(-1) ?? null,
      hops, via, relayedToday: today.relayed, altRoutes: sum(d => d.altRoutes), thirdPartyBytes: this.router.thirdPartyBytes(), queued: this.outbox.size,
    };
  }

  /** Quem entrou em contato comigo pelo meu convite (registro local), mais recentes primeiro. */
  acceptedInvites(): AcceptedInvite[] { return this.accepted.all(); }

  /**
   * Arquivo de evidências deste aparelho (`EvidenceFile` v1 do validador): recibos que o meu roteador
   * assinou e as provas de entrega que conheço (as guardadas nos créditos e as que circulam agora).
   */
  evidence(): EvidenceFile {
    return buildEvidence(this.credits.list(), [...this.proofs].map(([id, p]) => [id, p.secret] as [string, Uint8Array]),
      [...this.proofsV2].flatMap(([id, ps]) => ps.map(p => [id, p.sealed] as [string, Uint8Array])));
  }

  private get validatorPk(): Uint8Array | null {
    return this.o.validatorProofPk === undefined ? VALIDATOR_PROOF_PK : this.o.validatorProofPk;
  }

  /**
   * Qual das minhas identidades é o destino deste envelope direto (pelo destino lógico). `null` se não
   * der para saber com certeza (as duas aceitam, nenhuma aceita ou erro): aí não sai prova v2, em vez
   * de assinar com a identidade errada.
   */
  private recipientOf(bytes: Uint8Array): Identity | null {
    const { public: pub, anon } = this.o.identities;
    try {
      const h = parseHeader(bytes);
      const is = (d: Uint8Array) => d.length === h.dest.length && d.every((b, i) => b === h.dest[i]);
      const p = is(directDest(pub.agreePk, h.expiresAt)) || this.managers.public.acceptsDest(h.dest, h.expiresAt);
      const a = is(directDest(anon.agreePk, h.expiresAt)) || this.managers.anon.acceptsDest(h.dest, h.expiresAt);
      return p === a ? null : p ? pub : anon;
    } catch {
      return null;
    }
  }

  /**
   * Sou o destino e abri o envelope: assino a prova v2 com o pseudônimo da identidade que recebeu e
   * selo para o validador. Sem a chave do validador, ou sem saber qual identidade recebeu, nada.
   */
  private addProofV2(bytes: Uint8Array, id: string, ackSecret: Uint8Array) {
    const vpk = this.validatorPk;
    if (!vpk) return;
    const me = this.recipientOf(bytes);
    if (!me) return;
    let sealed: Uint8Array;
    try { sealed = sealDeliveryProof(makeDeliveryProof(bytes, me, ackSecret, this.o.now(), vpk), vpk); } catch { return; }
    this.keepProofV2(id, sealed, new Set(), this.o.now(), true);
    for (const p of this.peers.keys()) this.sendProofsV2(p);
  }

  /**
   * Guarda uma prova v2 (até 3 diferentes por envelope). `false` se repetida ou sem vaga. A minha
   * (`own`, sou o destino) entra na frente e tira a última se não houver vaga.
   */
  private keepProofV2(id: string, sealed: Uint8Array, sentTo: Set<string>, at = this.o.now(), own = false): boolean {
    const list = this.proofsV2.get(id) ?? [];
    if (list.some(x => x.sealed.length === sealed.length && x.sealed.every((b, i) => b === sealed[i]))) return false;
    if (own) { list.unshift({ sealed, at, sentTo }); list.length = Math.min(list.length, PROOFS_V2_PER_ENVELOPE); }
    else if (list.length >= PROOFS_V2_PER_ENVELOPE) return false;
    else list.push({ sealed, at, sentTo });
    this.proofsV2.set(id, list);
    while (this.proofsV2.size > MAX_PROOFS_V2) this.proofsV2.delete(this.proofsV2.keys().next().value!);
    return true;
  }

  /** Provas v2 recentes que o vizinho ainda não recebeu de mim (até 8 por quadro). */
  private sendProofsV2(peerId: string) {
    const now = this.o.now();
    const batch: { envelopeId: string; sealed: Uint8Array }[] = [];
    for (const [id, list] of this.proofsV2) {
      const live = list.filter(p => now - p.at <= PROOF_V2_KEEP_SEC);
      if (!live.length) { this.proofsV2.delete(id); continue; }
      if (live.length !== list.length) this.proofsV2.set(id, live);
      for (const p of live) {
        if (batch.length >= MAX_PROOFS_PER_FRAME) break;
        if (now - p.at > PROOF_TTL_SEC || p.sentTo.has(peerId)) continue;
        batch.push({ envelopeId: id, sealed: p.sealed });
        p.sentTo.add(peerId);
      }
      if (batch.length >= MAX_PROOFS_PER_FRAME) break;
    }
    if (batch.length) this.o.transmit(peerId, encodeProofV2Frame(batch)).catch(() => {});
  }

  private onProofsV2(from: string, b: Uint8Array) {
    const items = decodeProofV2Frame(b);
    if (!items) return;
    let changed = false;
    for (const it of items) {
      // Como na v1: só guarda e repassa prova de envelope que passou por aqui.
      if (!this.router.hasSeen(it.envelopeId) || !this.keepProofV2(it.envelopeId, it.sealed, new Set([from]))) continue;
      if (this.credits.attachSealedProof(it.envelopeId, toHex(it.sealed))) changed = true;
    }
    if (changed) this.o.events.changed?.();
    for (const p of this.peers.keys()) if (p !== from) this.sendProofsV2(p);
  }

  private addProof(envId: string, secret: Uint8Array) {
    if (this.proofs.has(envId)) return;
    this.proofs.set(envId, { secret, at: this.o.now(), sentTo: new Set() });
    while (this.proofs.size > 2000) this.proofs.delete(this.proofs.keys().next().value!);
    if (this.credits.applyProof(envId, secret)) this.o.events.changed?.();
    for (const p of this.peers.keys()) this.sendProofs(p);
  }

  /** Envia a um vizinho as provas recentes que ele ainda não recebeu de mim (até 64 por quadro). */
  private sendProofs(peerId: string) {
    const now = this.o.now();
    const batch: [string, Proof][] = [];
    for (const [id, p] of this.proofs) {
      if (now - p.at > PROOF_TTL_SEC) { this.proofs.delete(id); continue; }
      if (!p.sentTo.has(peerId)) batch.push([id, p]);
      if (batch.length >= 64) break;
    }
    if (!batch.length) return;
    const out = new Uint8Array(3 + batch.length * 32);
    out[0] = PROOF_MAGIC[0]; out[1] = PROOF_MAGIC[1]; out[2] = batch.length;
    batch.forEach(([id, p], i) => { out.set(Uint8Array.from(id.match(/../g)!.map(x => parseInt(x, 16))), 3 + i * 32); out.set(p.secret, 3 + i * 32 + 16); p.sentTo.add(peerId); });
    this.o.transmit(peerId, out).catch(() => {});
  }

  private onProofs(from: string, b: Uint8Array) {
    const n = b[2];
    if (b.length !== 3 + n * 32 || n === 0) return;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const id = toHex(b.subarray(3 + i * 32, 3 + i * 32 + 16));
      const secret = b.slice(3 + i * 32 + 16, 3 + i * 32 + 32);
      // Só guarda e repassa prova de envelope que passou por aqui (contra enxurrada de provas falsas).
      if (this.proofs.has(id) || !this.router.hasSeen(id)) continue;
      if (this.credits.applyProof(id, secret)) changed = true;
      this.proofs.set(id, { secret, at: this.o.now(), sentTo: new Set([from]) });
    }
    if (changed) this.o.events.changed?.();
    for (const p of this.peers.keys()) if (p !== from) this.sendProofs(p);
  }

  // ── carga pela malha até um gateway (protocol/carry.ts) ──

  /** Cargas minhas esperando recibo: id do envelope → identidade descartável de retorno. */
  private carries = new Map<string, CarryOut>();
  private gatewayRoles = { tx: false, inbox: false };
  private carryLimit = new CarryLimiter();
  /** Malha aberta (LoRa): um vizinho virtual para todos no ar, com o teto de meio compartilhado. */
  private carryLimitAir = new CarryLimiter(OPEN_MESH_CARRY.perHour, OPEN_MESH_CARRY.burst);

  /**
   * Põe na malha uma carga para "qualquer gateway" (transação assinada ou pacote selado para o
   * validador). Sai mesmo com o Modo nó desligado (é minha); o recibo chega por `carryReceipt`.
   * `ref`: hash da transação ou `bundleRef` do pacote (confere o recibo).
   */
  carry(item: CarryItem, ref: string): { envelopeId: string; expiresAt: number } {
    const now = this.o.now();
    const s = sealCarry({ item, now, pad: this.o.pad?.() ?? true });
    const delaySec = this.o.randomDelay?.() ? randomDelaySec() : 0;
    if (this.router.send(s.bytes, now, { delaySec }).status !== 'stored') throw new Error('A fila do aparelho está cheia; a carga não entrou.');
    this.carries.set(s.id, { seed: s.returnSeed, me: returnIdentity(s.returnSeed), expiresAt: s.expiresAt, about: item.kind, ref: refHex(ref), bytes: s.bytes });
    // Cheio: sai o pacote de evidências mais antigo (o arquivo manual cobre); transação nunca sai daqui.
    while (this.carries.size > MAX_CARRIES) {
      const old = [...this.carries].find(([, c]) => c.about === CarryKind.Evidence)?.[0];
      if (!old) { this.carries.delete(s.id); this.router.forget(s.id); throw new Error('Cargas demais esperando recibo.'); }
      this.carries.delete(old); this.router.forget(old);
    }
    this.o.events.changed?.();
    this.flushAll();
    return { envelopeId: s.id, expiresAt: s.expiresAt };
  }

  /** Carga ainda na fila deste aparelho? (some ao vencer, ao ser esquecida ou com o recibo final) */
  carryQueued(envelopeId: string) { return this.router.has(envelopeId); }

  /** Para de levar e de esperar recibo (a carteira já confirmou na Mainnet, por exemplo). */
  forgetCarry(envelopeId: string) {
    if (!this.carries.delete(envelopeId)) return;
    this.router.forget(envelopeId);
    this.o.events.changed?.();
  }

  /**
   * Papel de gateway (quem chama liga só com o ajuste e com internet): `tx` aceita transações para a
   * Lunes; `inbox`, pacotes para a caixa do validador (só com a caixa configurada). Desligado, as cargas
   * passam por aqui como envelopes de terceiros.
   */
  setGateway(roles: { tx?: boolean; inbox?: boolean }) { this.gatewayRoles = { tx: !!roles.tx, inbox: !!roles.inbox }; }
  get gateway() { return { ...this.gatewayRoles }; }

  /** Recibo do gateway para a identidade descartável de quem mandou (a carga já foi tratada). */
  sendCarryReceipt(to: PublicIdentity, rc: CarryReceipt) {
    const now = this.o.now();
    this.router.send(sealCarryReceipt(to, rc, now).bytes, now);
    this.flushAll();
  }

  /** `openExtra` do roteador: só abre o que tem o destino do gateway (com o papel ligado) ou de uma carga minha. */
  private openCarryEnvelope(bytes: Uint8Array, h: Header, now: number): Opened | null {
    if (h.kind !== EnvelopeKind.Direct) return null;
    const kind = gatewayKindOf(h);
    if (kind !== null) {
      const on = kind === CarryKind.Tx ? this.gatewayRoles.tx : this.gatewayRoles.inbox;
      return on ? openDirect(bytes, kind === CarryKind.Tx ? GATEWAY_TX_IDENTITY : GATEWAY_INBOX_IDENTITY, now) : null;
    }
    for (const c of this.carries.values()) if (sameBytes(h.dest, directDest(c.me.agreePk, h.expiresAt))) return openDirect(bytes, c.me, now);
    return null;
  }

  private onCarry(m: Opened, bytes: Uint8Array) {
    const c = carryOf(m, bytes);
    if (c) { if (this.o.events.gatewayCarry) this.o.events.gatewayCarry(c); return; }
    const rc = decodeCarryReceipt(m.body);
    if (!rc) return;
    let h: Header;
    try { h = parseHeader(bytes); } catch { return; }
    for (const [id, out] of this.carries) {
      if (!sameBytes(h.dest, directDest(out.me.agreePk, h.expiresAt))) continue;
      // O recibo tem de falar da MESMA carga (hash da transação ou do pacote).
      if (rc.about !== out.about || toHex(rc.ref) !== out.ref) return;
      // Recibo final: paro de espalhar a minha cópia (outros nós já podem ter as deles).
      if (rc.status === 'finalized' || rc.status === 'accepted') { this.router.forget(id); out.bytes = null; }
      this.o.events.carryReceipt?.(id, rc);
      this.o.events.changed?.();
      return;
    }
  }

  peerConnected(peerId: string, via: TransportClass) { this.peers.set(peerId, via); this.flush(peerId); this.announce(peerId); }
  peerDisconnected(peerId: string) { this.peers.delete(peerId); this.photoSent.delete(peerId); }
  clearPeers() { this.peers.clear(); }

  /** Chamar de tempos em tempos: libera envios com atraso aleatório e apaga o que venceu. */
  tick() {
    this.rotateNodeKey();
    this.applyRelay();
    this.nearTick();
    const ct = this.credits.tick(this.o.now());
    if (ct.lot) this.o.events.lotClosed?.(ct.lot);
    if (ct.changed) this.o.events.changed?.();
    this.router.purge(this.o.now());
    this.pruneOwn();
    for (const [id, c] of this.carries) if (c.expiresAt + RECEIPT_TTL_SEC <= this.o.now()) this.carries.delete(id);
    this.tickAlerts();
    // Venceu o TTL sem confirmação: sai da fila e a conversa mostra "expirada" (com Reenviar).
    let changed = false;
    for (const [k, q] of this.outbox) {
      if (this.router.has(k)) continue;
      this.outbox.delete(k); changed = true;
      this.o.events.status?.(q.msgId, 'expirada');
      this.day().expired++;
    }
    if (changed) this.o.events.changed?.();
    this.flushAll();
  }

  private flushAll() { for (const p of this.peers.keys()) this.flush(p); }

  private flush(peerId: string) {
    const via = this.peers.get(peerId);
    if (!via) return;
    this.rotateNodeKey(); // recibo assinado sempre com a chave do dia
    const now = this.o.now();
    // Banda e tráfego diário só limitam mensagens de terceiros.
    let budget = Infinity;
    const p = this.policy;
    if (p) {
      this.rollDay();
      if (Number.isFinite(p.bytesPerSec)) {
        const burst = p.bytesPerSec * 2;
        this.bw.tokens = this.bw.at ? Math.min(burst, this.bw.tokens + (now - this.bw.at) * p.bytesPerSec) : burst;
        this.bw.at = now;
        budget = this.bw.tokens;
      }
      budget = Math.min(budget, Math.max(0, p.dailyBytes - this.relayDay.bytes));
    }
    const out = this.router.outgoing(peerId, via, now, { thirdPartyBudget: budget });
    let changed = false;
    /** Saltos restantes de cada envelope que sai (para contar os relays da entrega até aqui). */
    const hopsOut = new Map<string, number>();
    for (const bytes of out) {
      const id = envelopeId(bytes);
      hopsOut.set(id, bytes[HOP_OFFSET]);
      if (!this.router.isOwn(id)) {
        this.relayDay.bytes += bytes.length;
        if (Number.isFinite(this.bw.tokens)) this.bw.tokens = Math.max(0, this.bw.tokens - bytes.length);
      }
      const gm = this.groupOut.get(id);
      if (gm) { this.groupOut.delete(id); changed = true; this.o.events.status?.(gm, 'encaminhada', { peer: peerId, via, bytes: bytes.length, priority: headerPriority(bytes) }); }
      const q = this.outbox.get(id);
      /** Mensagem minha saindo pela primeira vez neste envio: recebe o meio confirmado pelo transporte. */
      const mine = gm ?? (q && !q.forwarded ? q.msgId : undefined);
      if (q && !q.forwarded) {
        q.forwarded = true; q.fwdAt = now; q.via = via; changed = true;
        this.o.events.status?.(q.msgId, 'encaminhada', { peer: peerId, via, bytes: bytes.length, priority: q.pr ?? headerPriority(bytes) });
        if (q.at != null) this.sample(this.day().queue, now - q.at);
      }
      if (q) { q.peers = [...new Set([...(q.peers ?? []), peerId])]; if (q.peers.length === 2) this.day().altRoutes++; }
      if (!this.router.isOwn(id)) this.day().relayed++;
      const vm = (this.day().via[via] ??= { ok: 0, fail: 0, lat: [] });
      this.o.transmit(peerId, bytes).then(r => {
        vm.ok++;
        if (mine && isSentVia(r)) this.o.events.routed?.(mine, r);
      }, () => { vm.fail++; /* o vizinho saiu; fica na fila para o próximo */ });
    }
    // Recibos que o roteador acabou de assinar (envelopes de terceiros): viram créditos pendentes.
    for (const rc of this.router.receipts.splice(0)) {
      const info = this.router.infoOf(rc.envelopeId);
      // O remetente põe DEFAULT_HOPS e cada salto tira 1: relays até mim = DEFAULT_HOPS − saltos ao sair.
      const left = hopsOut.get(rc.envelopeId);
      if (info) { this.credits.addReceipt(rc, { ...info, relays: left === undefined ? 1 : DEFAULT_HOPS - left - 1 }, via); changed = true; }
    }
    this.sendProofs(peerId);
    this.sendProofsV2(peerId);
    if (p && this.relayDay.bytes >= p.dailyBytes) this.applyRelay(); // chegou ao limite do dia
    if (changed) this.o.events.changed?.();
  }

  /** Bytes que chegaram de um vizinho. Dado de par não é confiável: nenhuma exceção sai daqui para o transporte. */
  receive(peerId: string, bytes: Uint8Array) {
    try { return this.receiveUnsafe(peerId, bytes); } catch { this.rx = null; return { status: 'rejected' as const, reason: 'erro ao processar' }; }
  }

  private receiveUnsafe(peerId: string, bytes: Uint8Array) {
    if (bytes.length >= 3 && bytes[0] === PROOF_MAGIC[0] && bytes[1] === PROOF_MAGIC[1]) { this.onProofs(peerId, bytes); return { status: 'rejected' as const, reason: 'prova' }; }
    if (isProofV2Frame(bytes)) { this.onProofsV2(peerId, bytes); return { status: 'rejected' as const, reason: 'prova' }; }
    if (isPresenceFrame(bytes)) { this.onPresence(peerId, bytes); return { status: 'rejected' as const, reason: 'presença' }; }
    // Cargas para gateway têm teto próprio por vizinho (cada uma custa a um gateway uma consulta à Mainnet).
    // Só a carga nova gasta: cópia repetida ou regravada o roteador descarta de graça.
    if (gatewayKindOf(bytes) !== null && this.router.isNew(bytes, this.o.now())) {
      const limit = this.peers.get(peerId) === 'lora' ? this.carryLimitAir : this.carryLimit;
      if (!limit.take(peerId, this.o.now())) return { status: 'rejected' as const, reason: 'limite de cargas' };
    }
    const r = this.router.ingest(bytes, peerId, this.o.now());
    this.rx = null;
    if (r.status === 'delivered') {
      // Sou o destino: conto os saltos (a prova de entrega sai depois de abrir, ver abaixo).
      const hopsUsed = Math.max(1, DEFAULT_HOPS - r.hopsLeft);
      const k = hopsUsed >= 4 ? '4+' : String(hopsUsed);
      this.day().hops[k] = (this.day().hops[k] ?? 0) + 1;
      // Rota real do que chegou: vai junto nos eventos desta entrega.
      this.rx = { peer: peerId, via: this.peers.get(peerId), bytes: bytes.length, hops: hopsUsed, priority: headerPriority(bytes) };
    }
    if (r.status === 'stored') { this.o.events.changed?.(); this.flushAll(); return r; } // retransmissão para terceiros
    if (r.status !== 'delivered') return r;
    const m = r.message;
    // Carga ou recibo (sem sessão, sem prova de entrega): nunca vai para as conversas.
    if (m.type === MsgType.Carry) { try { this.onCarry(m, bytes); } finally { this.rx = null; } return r; }
    if (m.kind === EnvelopeKind.Group) {
      // Prova de entrega: segredo que só quem decifrou conhece (vira crédito para os relays).
      this.addProof(m.id, m.ackSecret);
      try { if (!this.blocked.has(m.fromId)) this.onGroupEnvelope(m); } finally { this.rx = null; }
      if (r.stored) this.flushAll(); // os outros membros ainda precisam receber
      return r;
    }
    // Sinal efêmero ("digitando…") não publica prova: não gera crédito para quem repassou.
    // Prova v1 (legado, para os aparelhos antigos) e v2 (assinada por mim, selada para o validador).
    try { if (!this.onDirect(m)) { this.addProof(m.id, m.ackSecret); this.addProofV2(bytes, m.id, m.ackSecret); } } finally { this.rx = null; }
    return r;
  }

  /** Rota do envelope que está sendo aberto agora (só durante `receive`). */
  private rx: RouteInfo | null = null;

  /** Conteúdo de uma mensagem direta para mim. `true` = sinal efêmero (sem prova de entrega). */
  private onDirect(m: Opened): boolean {
    // Bloqueado: descarta antes de abrir a sessão (sem confirmação de entrega nem pedido de conversa).
    if (this.blocked.has(m.fromId)) return false;
    const via: IdentityKind = this.contacts.get(m.fromId)?.via ?? (this.managers.anon.get(m.fromId) ? 'anon' : 'public');
    // Abre na sessão da identidade que recebeu; tenta a outra se não abrir (primeira mensagem).
    let pt = this.managers[via].open(m), used: IdentityKind = via;
    if (!pt) { used = via === 'public' ? 'anon' : 'public'; pt = this.managers[used].open(m); }
    this.o.events.changed?.();
    if (!pt) return false;
    if (pt[0] === BLOCK_TAG) { this.onBlock(m.fromId, pt); return false; }
    let p: Payload;
    try { p = JSON.parse(fromUtf8(pt)); } catch { return false; }
    if (p?.t === 'fa' || p?.t === 'fd' || p?.t === 'f' || p?.t === 'fw') { this.onFileControl(m.fromId, p, m.sentAt); return false; }
    if (this.rx?.hops === 1 && this.contacts.has(m.fromId)) this.direct.set(m.fromId, { peer: this.rx.peer, at: this.o.now() });
    if (p?.t === 'cl') {
      const c = this.contacts.get(m.fromId);
      if (!c || c.request || c.groupOnly) return true;
      const s = (p as { s?: { t?: string; requestId?: unknown } }).s;
      // Pedido de chamada vem pela fila: confirma a entrega (o cartão de quem pediu vira "Entregue").
      const queued = s?.t === 'request' || s?.t === 'requestAnswer';
      if (s?.t === 'request' && typeof s.requestId === 'string' && s.requestId.length <= 64) this.enqueue(c, { t: 'a', i: [s.requestId] }, null, Priority.High);
      this.o.events.callSignal?.(m.fromId, p, this.rx ?? undefined);
      return !queued;
    }
    if (p?.t === 'ty') {
      const c = this.contacts.get(m.fromId);
      if (c && !c.request) this.o.events.typing?.(m.fromId);
      return true;
    }
    if (p?.t === 'r') {
      // Só confirma leitura de mensagem que eu mandei a este contato.
      if (this.contacts.has(m.fromId) && Array.isArray(p.i)) this.o.events.read?.(m.fromId, p.i.filter(x => typeof x === 'string' && x.length <= 64).slice(0, 64));
      return false;
    }
    if (p?.t === 'g' || p?.t === 'gl' || p?.t === 'gr') { this.onGroupControl(m.fromId, p); return false; }
    if (p?.t === 'ni') { this.onNearInvite(m, used, p); return false; }
    if (p?.t === 'na') { this.onNearAccept(m.fromId, m.sentAt, p); return false; }
    if (p?.t === 'pq' || p?.t === 'pd') {
      // Só de contato aceito: um "pedido de conversa" (código não conferido) não pode pedir dinheiro.
      const c = this.contacts.get(m.fromId);
      if (!c || c.request || c.groupOnly) return false;
      if (p.t === 'pd') { const n = readPaidNotice(p); if (n) this.o.events.paymentPaid?.(c.id, n); return false; }
      const r = readPayRequest(p, this.o.now());
      if (!r) return false;
      // Recibo sempre (como no texto: o anterior pode ter se perdido); mostra uma vez só.
      this.enqueue(c, { t: 'a', i: [r.id] }, null, Priority.High);
      const key = `${m.fromId}|${r.id}`;
      if (this.deliveredSet.has(key)) return false;
      this.markDelivered(key);
      this.o.events.paymentRequest?.(c.id, r, m.sentAt, this.rx ?? undefined);
      this.o.events.changed?.();
      return false;
    }
    if (p?.t === 'gj') { this.onJoinRequest(m.fromId, used, m.from, p); return false; }
    if (p?.t === 'ga') { this.onMemberInvite(m.fromId, p); return false; }
    if (p?.t === 'gv') { this.onVouch(m.fromId, p); return false; }
    if (p?.t === 'rv') {
      // De contato, ou de membro de um grupo em que sou admin (admin promovido pode não ser contato dele).
      const known = this.contacts.has(m.fromId) || [...this.groups.values()].some(g => isAdmin(g, this.myId(g.via)) && isMemberOf(g, m.fromId));
      if (known && typeof p.n === 'string' && p.n.length < 4096) this.o.events.notice?.(m.fromId, p.n, m.from);
      return false;
    }
    if (p?.t === 'wa') {
      const c = this.contacts.get(m.fromId);
      if (!c || c.via !== 'public' || c.request || used !== 'public' || typeof p.a !== 'string') return false;
      const a = p.a.trim();
      if (a && (a.length > 64 || !isLunesAddress(a))) return false;
      c.lunes = a || undefined;
      this.o.events.peerWallet?.(m.fromId, a || null);
      this.o.events.changed?.();
      return false;
    }
    if (p?.t === 'ar' || p?.t === 'av' || p?.t === 'ns') {
      const c = this.contacts.get(m.fromId);
      if (!c || c.via !== 'public' || c.request || used !== 'public') return false;
      if (p.t === 'ns') { if (Number.isInteger(p.s) && p.s >= 0) this.o.events.nodeStatus?.(c.id, p.s); return false; }
      if (p.t === 'ar') {
        if (typeof p.p !== 'string' || !/^[0-9a-f]{64}$/.test(p.p)) return false;
        // Sem `c` (pedido antigo): conta de quando chegou.
        const createdAt = Number.isInteger(p.c) ? p.c! : m.sentAt;
        this.o.events.endorseRequest?.(c.id, { phonePk: p.p, createdAt, bondOk: p.b === 1, cancel: p.x === 1 });
        return false;
      }
      const e = p.e as Partial<EndorsementJson> | undefined;
      if (e && typeof e.endorserPk === 'string' && typeof e.phonePk === 'string' && Number.isInteger(e.day) && typeof e.inPerson === 'boolean' && typeof e.sig === 'string' && e.sig.length === 128) {
        this.o.events.endorsement?.(c.id, { endorserPk: e.endorserPk, phonePk: e.phonePk, day: e.day!, inPerson: e.inPerson, sig: e.sig });
      }
      return false;
    }
    if (p?.t === 'pp') {
      const c = this.contacts.get(m.fromId);
      if (c && c.via === 'public' && !c.request && used === 'public' && typeof p.p === 'string') this.o.events.peerPhoto?.(m.fromId, p.p === '' ? null : isJpegBase64(p.p) ? p.p : null);
      return false;
    }
    if (p?.t === 'a' && Array.isArray(p.i)) {
      for (const id of p.i.slice(0, 64)) {
        for (const [k, q] of this.outbox) {
          if (q.msgId === id && q.to === m.fromId) {
            this.outbox.delete(k); this.router.forget(k); this.o.events.status?.(id, 'entregue');
            const d = this.day(); d.delivered++;
            this.deliveryDays.record(this.clock.day(), m.fromId);
            if (q.at != null) { this.sample(d.lat, this.o.now() - q.at); if (q.via) { const v = (d.via[q.via] ??= { ok: 0, fail: 0, lat: [] }); this.sample(v.lat, this.o.now() - q.at); } }
          }
        }
      }
      this.o.events.changed?.();
      return false;
    }
    if (p?.t !== 'm' || typeof p.i !== 'string' || typeof p.x !== 'string' || p.i.length > 64) return false;
    let c = this.contacts.get(m.fromId);
    // Sempre confirma (mesmo repetida: o recibo anterior pode ter se perdido).
    const isNew = !c;
    if (!c) {
      // Contato novo só com convite válido, emitido por mim para a identidade que recebeu, e ainda não usado.
      const inv = typeof p.k === 'string' ? this.invites.get(p.k) : undefined;
      if (!inv || inv.kind !== used || inv.expiresAt <= this.o.now()) { this.o.events.changed?.(); return false; }
      // "Quem pode me encontrar: Ninguém" (identidade pública): pedido pelo código é descartado, sem resposta.
      if (used === 'public' && this.discovery === 'none') return false;
      const strangers = [...this.contacts.values()].filter(x => x.request).length;
      if (strangers >= MAX_CONTACTS_FROM_STRANGERS) return false; // contra enxurrada de pedidos
      this.invites.delete(inv.code); // uso único
      const name = typeof p.n === 'string' && used === 'public' ? stripBidi(p.n).slice(0, 40) : '';
      const info: AcceptedInvite = { contactId: m.fromId, name, via: used, at: this.o.now() * 1000 };
      this.accepted.add(info);
      this.o.events.inviteUsed?.(info);
      c = { id: m.fromId, via: used, pub: m.from, name, request: true };
      this.contacts.set(c.id, c);
    }
    this.enqueue(c, { t: 'a', i: [p.i] }, null, Priority.High);
    const key = `${m.fromId}|${p.i}`;
    if (this.deliveredSet.has(key)) return false; // já mostrada
    this.markDelivered(key);
    const loc = readWireLocation(p.l);
    const msg: IncomingText = { msgId: p.i, text: p.x.slice(0, MAX_TEXT), sentAt: m.sentAt, expireSec: validExpire(p.e), ...(loc ? { loc } : {}), ...(this.rx ? { route: this.rx } : {}) };
    if (isNew) this.o.events.newContact?.(c, msg); else this.o.events.message?.(c.id, msg);
    this.o.events.changed?.();
    return false;
  }

  private markDelivered(key: string) {
    if (this.deliveredSet.has(key)) return;
    this.deliveredSet.add(key); this.delivered.push(key);
    while (this.delivered.length > MAX_DELIVERED_IDS) this.deliveredSet.delete(this.delivered.shift()!);
  }

  /** Estado completo para salvar (contém segredos das sessões). */
  export(): string {
    return JSON.stringify({
      v: 1,
      s: { public: this.managers.public.export(), anon: this.managers.anon.export() },
      inv: [...this.invites.values()],
      cr: this.credits.export(this.o.now()),
      p2: [...this.proofsV2].flatMap(([id, ps]) => ps.filter(p => this.o.now() - p.at < PROOF_V2_KEEP_SEC).map(p => [id, { s: b64url(p.sealed), at: p.at }])),
      mx: [...this.days],
      ud: this.deliveryDays.export(),
      ia: this.accepted.export(),
      g: [...this.groups.values()].map(g => encodeState(g, 'store')),
      gp: [...this.prevKeys],
      gv: [...this.vouched],
      rk: this.rotatedFor,
      ca: this.alertBook.export(),
      gq: [...this.pendingJoins].map(([gid, l]) => [gid, l.map(p => ({ id: p.id, name: p.name, via: p.via, at: p.at, s: b64url(p.pub.signPk), a: b64url(p.pub.agreePk), b: b64url(p.pub.binding) }))]),
      c: [...this.contacts.values()].map(c => ({ id: c.id, via: c.via, name: c.name, r: c.request ? 1 : 0, ...(c.groupOnly ? { o: 1 } : {}), k: c.invite ?? '', ...(c.lunes ? { w: c.lunes } : {}), s: b64url(c.pub.signPk), a: b64url(c.pub.agreePk), b: b64url(c.pub.binding) })),
      q: [...this.outbox.values()],
      cy: [...this.carries].map(([id, c]) => [id, { s: b64url(c.seed), x: c.expiresAt, k: c.about, r: c.ref, ...(c.bytes && this.router.has(id) ? { b: b64url(c.bytes) } : {}) }]),
      seen: this.router.exportSeen(),
      d: this.delivered,
      nb: {
        u: this.shownUntil,
        i: [...this.nearIn.values()].map(({ pub, ...r }) => ({ ...r, k: wirePub(pub) })),
        o: [...this.nearOut].map(([id, { pub, ...x }]) => [id, { ...x, k: wirePub(pub) }]),
        ka: [...this.nearAsked], ks: [...this.nearSent], h: [...this.nearHidden],
      },
    });
  }
}
