const appConfig = require('./app.json');

const googleMapsApiKey = String(
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
  || process.env.GOOGLE_MAPS_API_KEY
  || ''
).trim();

const googleServicesFile = String(
  process.env.GOOGLE_SERVICES_JSON
  || appConfig.expo.android?.googleServicesFile
  || './google-services.json'
).trim();

module.exports = () => {
  const config = appConfig.expo;

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile,
      config: {
        ...(config.android?.config || {}),
        googleMaps: {
          ...(config.android?.config?.googleMaps || {}),
          apiKey: googleMapsApiKey,
        },
      },
    },
  };
};
