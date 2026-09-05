import { RootProvider } from "../src/providers/root-provider";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useUnistyles } from "react-native-unistyles";

void SplashScreen.preventAutoHideAsync().catch(console.warn);

function AppStack() {
  const { theme } = useUnistyles();

  useEffect(() => {
    void SplashScreen.hideAsync().catch(console.warn);
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background.default } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
      <Stack.Screen name="tutorial" options={{ gestureEnabled: false }} />
      <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
      <Stack.Screen name="(app)" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

function RootLayout() {
  return (
    <RootProvider>
      <AppStack />
    </RootProvider>
  );
}

export default RootLayout;
