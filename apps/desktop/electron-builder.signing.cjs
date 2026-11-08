// Assinatura de código (macOS e Windows), ligada sozinha quando há certificado no ambiente.
// O electron-builder.yml estende este arquivo (`extends`); a lógica fica em
// scripts/electron-signing/index.cjs, compartilhada com o outro app Electron do monorepo.
// Sem certificado: ad-hoc no macOS e sem assinatura no Windows, como antes.
// Com Developer ID, o Piu Desktop usa os próprios entitlements (./entitlements.mac.plist): os do monorepo
// mais o microfone da chamada de voz (o Provider não usa microfone). Testado em test/macSigning.test.ts.
const path = require('node:path');

const ENTITLEMENTS = path.join(__dirname, 'entitlements.mac.plist');

function desktopSigning(env = process.env, options) {
  const cfg = require('../../scripts/electron-signing/index.cjs').signingConfig(env, options);
  if (!cfg.mac.entitlements) return cfg;
  return { ...cfg, mac: { ...cfg.mac, entitlements: ENTITLEMENTS, entitlementsInherit: ENTITLEMENTS } };
}

// O electron-builder chama a função com o pedido dele (não com o ambiente): o ambiente vem de process.env.
module.exports = () => desktopSigning();
module.exports.desktopSigning = desktopSigning;
