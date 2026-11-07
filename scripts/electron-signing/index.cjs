'use strict';
/**
 * Assinatura de código dos apps Electron do Piu (apps/desktop e apps/provider-desktop).
 *
 * O electron-builder.yml de cada app faz `extends: ./electron-builder.signing.cjs`, que chama
 * `signingConfig()` daqui. O YAML não tem condição; este arquivo decide pelo ambiente:
 *
 *   macOS
 *     - Sem certificado (hoje): assinatura ad-hoc ("-"), sem hardened runtime, sem notarização.
 *       Igual ao que o yml fazia antes: o pacote fica íntegro e roda nos Macs com chip M, mas o
 *       Gatekeeper avisa "desenvolvedor não identificado".
 *     - Com Developer ID Application (CSC_LINK + CSC_KEY_PASSWORD, ou CSC_NAME = identidade já
 *       instalada no keychain): assina com ela, hardened runtime ligado, entitlements mínimos
 *       (entitlements.mac.plist ao lado) e notarização pelo notarytool quando houver credencial:
 *         APPLE_API_KEY (caminho do .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER   ← preferido
 *         APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 *         APPLE_KEYCHAIN_PROFILE (+ APPLE_KEYCHAIN)
 *       Quem lê essas variáveis é o próprio electron-builder (26.x: `mac.notarize` é só liga/desliga).
 *
 *   Windows
 *     - Sem certificado (hoje): instalador sem assinatura (o SmartScreen avisa).
 *     - WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD: certificado .pfx/.p12 (Authenticode).
 *     - Azure Trusted Signing: AZURE_TRUSTED_SIGNING_ENDPOINT / _ACCOUNT_NAME / _CERTIFICATE_PROFILE /
 *       _PUBLISHER_NAME + credencial do Entra ID (AZURE_TENANT_ID, AZURE_CLIENT_ID e
 *       AZURE_CLIENT_SECRET). Só funciona com o build rodando no Windows (usa PowerShell + signtool).
 *     - Sem nenhum dos dois, `win.cscLink` fica "" de propósito: senão o electron-builder cairia no
 *       CSC_LINK (o .p12 da Apple) e tentaria assinar o .exe com ele.
 *
 * Detalhes, compra dos certificados e conferência: docs/distribuicao/assinatura.md.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENTITLEMENTS = path.join(__dirname, 'entitlements.mac.plist');

const has = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';
const missing = (env, keys) => keys.filter(k => !has(env, k));

/** Qual credencial de notarização está completa (ou null). Parcial = erro, para não sair sem notarizar calado. */
function notaryMethod(env) {
  const groups = [
    ['api-key', ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']],
    ['apple-id', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']],
  ];
  for (const [name, keys] of groups) {
    const absent = missing(env, keys);
    if (absent.length === 0) {
      if (name === 'api-key' && !fs.existsSync(env.APPLE_API_KEY)) {
        throw new Error(`[assinatura] APPLE_API_KEY deve ser o CAMINHO do arquivo AuthKey_XXXX.p8 (não encontrado: ${env.APPLE_API_KEY})`);
      }
      return name;
    }
    // APPLE_TEAM_ID sozinho é comum (outros usos); só reclama se veio parte da credencial de verdade.
    const relevant = name === 'apple-id' ? keys.filter(k => k !== 'APPLE_TEAM_ID') : keys;
    if (relevant.some(k => has(env, k))) {
      throw new Error(`[assinatura] Notarização (${name}) incompleta: faltam ${absent.join(', ')}`);
    }
  }
  if (has(env, 'APPLE_KEYCHAIN_PROFILE')) return 'keychain-profile';
  return null;
}

/** Bloco `mac` do electron-builder. */
function macSigning(env = process.env) {
  const viaP12 = has(env, 'CSC_LINK');
  const viaKeychain = has(env, 'CSC_NAME');
  if (!viaP12 && !viaKeychain) {
    return {
      mode: 'adhoc',
      notary: null,
      // Ad-hoc ("-"): sem certificado da Apple, mas o pacote fica íntegro e roda nos Macs com chip M
      // (binário arm64 sem assinatura nenhuma é recusado como "danificado").
      // Hardened runtime desligado: com ad-hoc ele recusa os frameworks do Electron (sem Team ID,
      // a validação de biblioteca falha). `notarize: false` evita que APPLE_* soltos no ambiente
      // façam o electron-builder mandar um app ad-hoc para a Apple (seria recusado).
      config: { identity: '-', hardenedRuntime: false, notarize: false },
    };
  }
  const notary = notaryMethod(env);
  return {
    mode: viaP12 ? 'developer-id (CSC_LINK)' : `developer-id (CSC_NAME="${env.CSC_NAME}")`,
    notary,
    // Sem `identity`: o electron-builder procura "Developer ID Application" no keychain temporário
    // criado com o CSC_LINK, ou usa o CSC_NAME.
    config: {
      hardenedRuntime: true,
      entitlements: ENTITLEMENTS,
      entitlementsInherit: ENTITLEMENTS,
      notarize: notary != null,
    },
  };
}

const AZURE_SIGNING = ['AZURE_TRUSTED_SIGNING_ENDPOINT', 'AZURE_TRUSTED_SIGNING_ACCOUNT_NAME', 'AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE', 'AZURE_TRUSTED_SIGNING_PUBLISHER_NAME'];
const AZURE_AUTH = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];

/** Bloco `win` do electron-builder. */
function winSigning(env = process.env, platform = process.platform) {
  const azure = AZURE_SIGNING.some(k => has(env, k));
  const pfx = has(env, 'WIN_CSC_LINK');
  if (azure && pfx) throw new Error('[assinatura] Windows: defina WIN_CSC_LINK OU Azure Trusted Signing, não os dois.');
  if (azure) {
    const absent = missing(env, [...AZURE_SIGNING, ...AZURE_AUTH]);
    if (absent.length) throw new Error(`[assinatura] Azure Trusted Signing incompleto: faltam ${absent.join(', ')}`);
    if (platform !== 'win32') {
      // O módulo TrustedSigning (PowerShell + signtool) só roda no Windows; no Linux/Wine o build quebraria.
      return { mode: 'unsigned (Azure configurado, mas o build não está no Windows)', config: { cscLink: '' } };
    }
    return {
      mode: 'azure-trusted-signing',
      config: {
        azureSignOptions: {
          publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME,
          endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
          codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME,
          certificateProfileName: env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE,
        },
      },
    };
  }
  // .pfx: o electron-builder lê WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD sozinho.
  if (pfx) return { mode: 'authenticode (WIN_CSC_LINK)', config: {} };
  return { mode: 'unsigned', config: { cscLink: '' } };
}

/** Configuração parcial (só assinatura) que o electron-builder.yml de cada app estende. */
function signingConfig(env = process.env, { log = true, platform = process.platform } = {}) {
  const mac = macSigning(env);
  const win = winSigning(env, platform);
  if (log) {
    const notary = mac.mode === 'adhoc' ? 'não' : mac.notary ?? 'NÃO (sem credencial APPLE_*: o Gatekeeper ainda bloqueia o download)';
    console.log(`  • assinatura  macOS=${mac.mode}  notarização=${notary}  Windows=${win.mode}`);
  }
  return { mac: mac.config, win: win.config };
}

module.exports = { signingConfig, macSigning, winSigning, ENTITLEMENTS };
