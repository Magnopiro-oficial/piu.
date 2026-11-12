/** Plugin do Expo: aplica `releaseAbiGradle.js` no `android/app/build.gradle` gerado pelo prebuild. */
const { withAppBuildGradle } = require('expo/config-plugins');
const { addReleaseAbiLock } = require('./releaseAbiGradle');

module.exports = function withReleaseAbi(config) {
  return withAppBuildGradle(config, cfg => {
    cfg.modResults.contents = addReleaseAbiLock(cfg.modResults.contents);
    return cfg;
  });
};
