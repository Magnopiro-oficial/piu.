// Assinatura de código (macOS e Windows), ligada sozinha quando há certificado no ambiente.
// O electron-builder.yml estende este arquivo (`extends`); a lógica fica em
// scripts/electron-signing/index.cjs, compartilhada com o outro app Electron do monorepo.
// Sem certificado: ad-hoc no macOS e sem assinatura no Windows, como antes.
module.exports = () => require('../../scripts/electron-signing/index.cjs').signingConfig();
