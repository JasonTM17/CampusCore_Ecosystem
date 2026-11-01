const LOCAL_CLEARTEXT_PLUGIN = './plugins/with-local-cleartext-traffic';

module.exports = ({ config }) => {
  const localCleartext = process.env.CAMPUSUTE_MOBILE_PROFILE === 'local'
    && process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_LOCAL === '1';

  if (!localCleartext) return config;

  return {
    ...config,
    plugins: [...(config.plugins ?? []), LOCAL_CLEARTEXT_PLUGIN],
  };
};
