import "./polyfills/ai";

import "fast-text-encoding";
import "react-native-url-polyfill/auto";
import "@/utils/unistyles";

import "expo-router/entry";

try {
  // Reanimated v3+ exposes configureReanimatedLogger; older builds may not
  const { configureReanimatedLogger } = require("react-native-reanimated");
  if (configureReanimatedLogger) {
    configureReanimatedLogger({
      level: "warn",
      strict: true,
      onWarn: (...args: any[]) => {
        console.warn(...args, new Error().stack);
      },
    });
  }
} catch (e) {
  // Silently ignore if logger API is unavailable
}
