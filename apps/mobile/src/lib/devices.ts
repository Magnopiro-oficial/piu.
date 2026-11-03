/**
 * Registro dos aparelhos desta identidade, salvo no aparelho (cifrado em repouso, `persist.ts`).
 * - `dev.self`: chave própria deste aparelho (Ed25519 aleatória; nunca sai dele).
 * - `dev.list`: os outros aparelhos (pareados daqui ou o de origem das chaves), com revogação.
 * - `dev.notices`: avisos de revogação assinados ainda não distribuídos aos contatos.
 * "Apagar dados locais" apaga tudo isso junto: o aparelho ganha uma chave nova.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { b64url, unb64url } from '../messaging/card';
import type { Identity } from '../protocol';
import { createRevocation, decodeRevocation, deviceIdOf, type DevicePlatform, type DeviceRecord, encodeRevocation, markRevoked, newDeviceKey, type RevocationNotice, type RevokeReason, upsertDevice } from './devicesCore';
import { persistNow, readPersisted } from './persist';
import { requestSessionRotation } from './migrationState';

interface SelfKey { sk: string; pk: string; since: number }
const SELF = 'dev.self', LIST = 'dev.list', NOTICES = 'dev.notices';
const EMPTY: DeviceRecord[] = [];
const now = () => Math.floor(Date.now() / 1000);

export const thisPlatform: DevicePlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'other';
export const PLATFORM_LABEL: Record<DevicePlatform, string> = { android: 'Android', ios: 'iPhone', web: 'Navegador', other: 'Aparelho' };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Chave deste aparelho; criada na primeira vez. */
export function thisDeviceKey(): { sk: Uint8Array; pk: Uint8Array; since: number } {
  let s = readPersisted<SelfKey>(SELF);
  if (!s?.sk || !s.pk) {
    const k = newDeviceKey();
    s = { sk: b64url(k.sk), pk: b64url(k.pk), since: now() };
    void persistNow(SELF, s).catch(() => {});
  }
  return { sk: unb64url(s.sk), pk: unb64url(s.pk), since: s.since };
}

/** Registro deste aparelho (para a lista e para a oferta de migração). */
export function thisDevice(): DeviceRecord {
  const k = thisDeviceKey();
  return { id: deviceIdOf(k.pk), pk: b64url(k.pk), name: 'Este aparelho', platform: thisPlatform, via: 'this', addedAt: k.since };
}

const others = () => readPersisted<DeviceRecord[]>(LIST) ?? EMPTY;

async function save(list: DeviceRecord[]) { const p = persistNow(LIST, list); emit(); await p; }

/** Acrescenta (ou atualiza) um aparelho desta identidade. */
export async function addDevice(d: Omit<DeviceRecord, 'id' | 'addedAt'> & { addedAt?: number }) {
  const id = deviceIdOf(unb64url(d.pk));
  if (id === thisDevice().id) return;
  await save(upsertDevice(others(), { ...d, id, addedAt: d.addedAt ?? now() }));
}

/**
 * Desconecta ou revoga um aparelho: marca no registro, assina um aviso por identidade (pública e
 * anônima, separados para não ligar uma à outra), guarda os avisos para distribuição e pede a
 * rotação das chaves de sessão.
 */
export async function revokeDevice(id: string, reason: RevokeReason, identities: { public: Identity; anon: Identity }): Promise<RevocationNotice[]> {
  const d = others().find(x => x.id === id);
  if (!d || d.revokedAt) return [];
  const at = now();
  const notices = [createRevocation(identities.public, d, reason, at), createRevocation(identities.anon, d, reason, at)];
  const pending = readPersisted<string[]>(NOTICES) ?? [];
  await persistNow(NOTICES, [...pending, ...notices.map(encodeRevocation)]);
  await save(markRevoked(others(), id, reason, at));
  await requestSessionRotation(reason === 'lost' ? 'aparelho revogado' : 'aparelho desconectado');
  return notices;
}

/**
 * Para o líder (distribuição pelo protocolo): avisos assinados ainda não enviados aos contatos.
 * `by` diz de qual identidade é cada aviso (chave de assinatura em base64url).
 */
export function pendingRevocations(): RevocationNotice[] {
  return (readPersisted<string[]>(NOTICES) ?? []).flatMap(s => { try { return [decodeRevocation(s)]; } catch { return []; } });
}

/** Tira da fila os avisos já distribuídos (pela assinatura). */
export async function markRevocationsSent(sigs: string[]) {
  const set = new Set(sigs);
  await persistNow(NOTICES, (readPersisted<string[]>(NOTICES) ?? []).filter(s => { try { return !set.has(decodeRevocation(s).sig); } catch { return false; } }));
}

/** Lista para a tela: este aparelho primeiro, depois os ativos, depois os revogados. */
export function useDevices(): DeviceRecord[] {
  const list = useSyncExternalStore(subscribe, others, others);
  const rank = (d: DeviceRecord) => (d.revokedAt ? 1 : 0);
  return [thisDevice(), ...[...list].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt)];
}

/** Aparelhos com as suas chaves e ainda ativos (este incluído), para contadores como o do Perfil. */
export function useActiveDeviceCount(): number {
  const list = useSyncExternalStore(subscribe, others, others);
  return 1 + list.filter(d => !d.revokedAt).length;
}
