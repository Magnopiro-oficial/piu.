/** Plugin do Expo: aplica `releaseSigningGradle.js` no `android/app/build.gradle` gerado pelo prebuild. */
const { withAppBuildGradle } = require('expo/config-plugins');
const { addReleaseSigning } = require('./releaseSigningGradle');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
