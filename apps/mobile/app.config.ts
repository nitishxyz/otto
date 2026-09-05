import type { ExpoConfig } from "expo/config";

const env = process.env.EXPO_PUBLIC_ENV;
const projectId = process.env.EAS_PROJECT_ID;
const owner = process.env.EXPO_OWNER;
const bundleIdentifier = env
  ? `com.ottocode.mobile.${env}`
  : `com.ottocode.mobile`;
const scheme = env ? `ottocode${env}` : `ottocode`;

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
    updates: projectId
      ? {
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: "ON_ERROR_RECOVERY",
        }
      : { enabled: false },
    runtimeVersion: {
      policy: "appVersion",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: bundleIdentifier,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#f7f8f6",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
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
          backgroundColor: "#f7f8f6",
          dark: {
            backgroundColor: "#f7f8f6",
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
      "expo-sqlite",
      "react-native-edge-to-edge",
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "16.4",
          },
          android: {
            compileSdkVersion: 36,
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
      ...(projectId ? { eas: { projectId } } : {}),
    },
    ...(owner ? { owner } : {}),
  } satisfies ExpoConfig,
};

export default config;
