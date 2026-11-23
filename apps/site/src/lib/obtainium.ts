// Link "Baixar pelo Obtainium". A configuração vem de packaging/obtainium/net.piu.app.json (a mesma do README e
// da entrada no diretório do Obtainium): só releases com "Android" no título, só o arquivo Piu-X.Y.Z.apk e só
// APK assinado com o certificado oficial. `node packaging/obtainium/check-filters.mjs` confere contra o GitHub.
//
// O link usa a página de redirecionamento do diretório do Obtainium: tenta abrir o app e, sem ele instalado,
// mostra onde baixá-lo (o obtainium:// puro não faz nada nesse caso).
import entry from '../../../../packaging/obtainium/net.piu.app.json';
import { ANDROID_CERT_SHA256 } from './androidRelease';

const config = entry.configs[0];
const pinned = (JSON.parse(config.additionalSettings).allowedSigningCertHashes as string).replace(/[^0-9a-f]/gi, '').toLowerCase();
if (pinned !== ANDROID_CERT_SHA256) throw new Error('obtainium: o certificado de net.piu.app.json difere de ANDROID_CERT_SHA256.');

export const OBTAINIUM_URL = `https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/${encodeURIComponent(JSON.stringify(config))}`;
/** Selo oficial "Get it on Obtainium" (assets/graphics do repositório do Obtainium, sem a margem transparente). */
export const OBTAINIUM_BADGE = '/badge-obtainium.png';
