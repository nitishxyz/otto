const env = process.env.EXPO_PUBLIC_ENV;
const bundleIdentifier = env
  ? `com.ottocode.mobile.${env}`
  : `com.ottocode.mobile`;
const scheme = env ? `ottocode{env}` : `ottocode`;

const name = env ? `ottocode (${env.toUpperCase()})` : "ottocode";

const config = {
  expo: {
    name: name,
    slug: "ottocode",
    version: "0.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: scheme,
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    updates: {
      url: "https://u.expo.dev/3835c3a5-17ae-4009-b0f1-da4060cfacae",
    },
    runtimeVersion: {
      policy: "appVersion",
    },
   ios: {
     supportsTablet: false,
     bundleIdentifier: bundleIdentifier,
     infoPlist: {
       ITSAppUsesNonExemptEncryption: false,
        NSLocationWhenInUseUsageDescription:
          "This app does not use your location.",
     },
   },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      package: bundleIdentifier,
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#161616",
          dark: {
            backgroundColor: "#161616",
          },
        },
      ],

      [
        "expo-secure-store",
        {
          configureAndroidBackup: true,
          faceIDPermission:
            "Allow $(PRODUCT_NAME) to access your Face ID biometric data.",
        },
      ],
      "expo-web-browser",
      "expo-build-properties",
      "expo-sqlite",
      "react-native-edge-to-edge",
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.0",
          },
          android: {
            compileSdkVersion: 35,
          },
        },
      ],
      ["expo-font"],
      [
        "react-native-vision-camera",
        {
          cameraPermissionText:
            "$(PRODUCT_NAME) needs access to your camera to scan QR codes.",
          enableMicrophonePermission: false,
          enableCodeScanner: true,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "3835c3a5-17ae-4009-b0f1-da4060cfacae",
      },
    },
    owner: "slashforge",
  },
};

export default config;
