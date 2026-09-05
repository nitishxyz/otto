import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";

export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    if (Platform.OS === "web") return;

    if (AppState.currentState !== null) {
      focusManager.setFocused(AppState.currentState === "active");
    }
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (state.isConnected !== null) {
        onlineManager.setOnline(
          state.isConnected && state.isInternetReachable !== false,
        );
      }
    });

    return () => {
      subscription.remove();
      unsubscribeNetwork();
      focusManager.setFocused(undefined);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
