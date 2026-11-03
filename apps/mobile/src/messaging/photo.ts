/** Foto do perfil que um contato manda (JPEG de 96 px em base64): validação sem dependência nativa. */
export const MAX_PEER_PHOTO_B64 = 24 * 1024;
/** JPEG em base64 (começa com `/9j/`, o marcador SOI), dentro do limite. */
export const isJpegBase64 = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= MAX_PEER_PHOTO_B64 && /^\/9j\/[A-Za-z0-9+/]+=*$/.test(s);
