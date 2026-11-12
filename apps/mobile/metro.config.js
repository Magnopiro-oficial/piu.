const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// O app não usa estes pacotes. Eles só existem em node_modules como "peer" do react-native-drawer-layout
// (expo-router) e o Skia tenta carregá-los dentro de try/catch. Aqui eles ficam "não instalados" para o
// Metro: o require opcional do Skia cai no catch e nada deles entra no pacote. A parte nativa sai pelo
// `expo.autolinking.exclude` do package.json. Um import obrigatório deles faz o build falhar, de propósito:
// para voltar a usar um deles, tire o nome daqui e do package.json.
const FORA_DO_APP = /^react-native-(reanimated|worklets|gesture-handler)(\/|$)/;

const anterior = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (FORA_DO_APP.test(moduleName)) {
    throw new Error(`${moduleName} fica fora do Piu (ver apps/mobile/metro.config.js)`);
  }
  return (anterior ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
