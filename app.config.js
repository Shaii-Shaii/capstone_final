const googleServicesFile = String(
  process.env.GOOGLE_SERVICES_JSON
  || './google-services.json'
).trim();

module.exports = {
  name: 'Donivra',
  slug: 'donivra',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './src/assets/images/donivra_logo_no_text.png',
  scheme: 'donivra',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Donivra needs camera access to scan your face and hair for donation screening.',
    },
  },
  android: {
    googleServicesFile,
    softwareKeyboardLayoutMode: 'resize',
    permissions: [
      'android.permission.CAMERA',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.DOWNLOAD_WITHOUT_NOTIFICATION',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
    adaptiveIcon: {
      backgroundColor: '#f4f1f1',
      foregroundImage: './src/assets/images/donivra_logo_no_text.png',
      monochromeImage: './src/assets/images/donivra_logo_no_text.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: 'com.anonymous.donivra',
  },
  androidStatusBar: {
    hidden: true,
    translucent: true,
    barStyle: 'light-content',
    backgroundColor: '#f4f1f1',
  },
  androidNavigationBar: {
    visible: 'sticky-immersive',
    barStyle: 'light-content',
    backgroundColor: '#080808',
    enforceContrast: false,
  },
  plugins: [
    'expo-router',
    '@maplibre/maplibre-react-native',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
        },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Donivra to use the camera for guided hair donation photo capture and AI hair screening.',
        recordAudioAndroid: false,
      },
    ],
    [
      'react-native-vision-camera',
      {
        cameraPermissionText: 'Donivra needs camera access to scan your face and hair for donation screening.',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './src/assets/images/donivra_logo_no_text.png',
        imageWidth: 144,
        resizeMode: 'contain',
        backgroundColor: '#f4f1f1',
        dark: {
          backgroundColor: '#f4f1f1',
        },
      },
    ],
    [
      'expo-notifications',
      {
        icon: './src/assets/images/donivra_logo_no_text.png',
        color: '#7f1d1d',
        defaultChannel: 'donivra-updates',
      },
    ],
    '@config-plugins/react-native-blob-util',
    '@config-plugins/react-native-pdf',
    '@react-native-community/datetimepicker',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: 'c7f749dc-f184-40cc-b85b-0c77fae5defa',
    },
  },
};
