const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLocalCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest entry is missing');
    application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
};
