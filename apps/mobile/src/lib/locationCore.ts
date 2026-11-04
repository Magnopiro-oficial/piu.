/**
 * Localização em texto curto (design: "Localização · Texto curto · chega até por LoRa"). TypeScript
 * puro, testado.
 *
 * O app não lê o GPS (não há módulo de localização instalado): a pessoa digita ou cola as
 * coordenadas, ou um link de mapa que as contenha. Vai como duas coordenadas (5 casas decimais,
 * ~1 m) e um nome opcional do lugar, dentro da mensagem cifrada: cabe em poucos bytes.
 */

export interface Location { lat: number; lon: number }
/** Nome opcional do lugar (ex.: "Portão do galpão"). */
export const MAX_PLACE_LABEL = 60;

const NUM = '([-+]?\\d{1,3}(?:[.,]\\d+)?)';
/** Formas aceitas, da mais específica à mais geral. */
const PATTERNS: RegExp[] = [
  // OpenStreetMap: ?mlat=..&mlon=..
  new RegExp(`mlat=${NUM}.*?mlon=${NUM}`, 'i'),
  // Google Maps: /@lat,lon,zoom ; ?q=lat,lon ; query=lat,lon ; ll=lat,lon ; Apple: ?ll= / &q=
  new RegExp(`@${NUM},\\s*${NUM}`),
  new RegExp(`[?&](?:q|query|ll|daddr|destination)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i'),
  // geo:lat,lon
  new RegExp(`geo:${NUM},${NUM}`, 'i'),
];
/** Texto só com as duas coordenadas: "lat, lon", "lat lon" ou "lat;lon" (vírgula decimal só com separador ; ou espaço). */
const PLAIN = /^\s*([-+]?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/;
const PLAIN_COMMA_DECIMAL = /^\s*([-+]?\d{1,3}(?:,\d+)?)\s*[; ]\s*([-+]?\d{1,3}(?:,\d+)?)\s*$/;

const toNum = (s: string) => Number(s.replace(',', '.'));
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

function valid(lat: number, lon: number): Location | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round5(lat), lon: round5(lon) };
}

/** Lê coordenadas digitadas ou de um link de mapa colado. `null` se não achar uma coordenada válida. */
export function parseLocation(input: string): Location | null {
  const t = input.trim();
  if (!t || t.length > 2000) return null;
  for (const re of [PLAIN, PLAIN_COMMA_DECIMAL]) {
    const m = t.match(re);
    if (m) return valid(toNum(m[1]), toNum(m[2]));
  }
  let s = t;
  try { s = decodeURIComponent(t); } catch { /* fica como veio */ }
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) return valid(toNum(m[1]), toNum(m[2]));
  }
  return null;
}

/** "-23.55052, -46.63331" (ponto decimal: é o que os mapas leem ao colar). */
export const formatCoords = (l: Location) => `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`;

/** Nome do lugar limpo (uma linha, até `MAX_PLACE_LABEL`). */
export const cleanPlaceLabel = (s: string) => [...s.replace(/\s+/g, ' ').trim()].slice(0, MAX_PLACE_LABEL).join('');

/**
 * Texto que vai junto com as coordenadas: o nome do lugar, ou as próprias coordenadas (assim quem
 * recebe numa versão sem o balão de localização ainda lê algo útil).
 */
export const locationText = (l: Location, label: string) => cleanPlaceLabel(label) || formatCoords(l);
/** Nome do lugar a partir do texto recebido (vazio se o texto eram só as coordenadas). */
export const placeFromText = (l: Location, text: string) => (text.trim() === formatCoords(l) ? '' : cleanPlaceLabel(text));

/** Link que abre o app de mapas do aparelho. */
export function mapUrl(l: Location, os: 'android' | 'ios' | 'web' | string): string {
  const c = `${l.lat},${l.lon}`;
  if (os === 'android') return `geo:${c}?q=${c}`;
  if (os === 'ios') return `https://maps.apple.com/?ll=${c}&q=${c}`;
  return `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=17/${l.lat}/${l.lon}`;
}
