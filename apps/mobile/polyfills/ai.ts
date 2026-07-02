import "fast-text-encoding";
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  const setupPolyfills = async () => {
    try {
      const rn = require("react-native/Libraries/Utilities/PolyfillFunctions");
      const { TextEncoderStream, TextDecoderStream } = await import(
        "@stardazed/streams-text-encoding"
      );

      if (!("TextEncoderStream" in globalThis)) {
        rn.polyfillGlobal("TextEncoderStream", () => TextEncoderStream);
      }

      if (!("TextDecoderStream" in globalThis)) {
        rn.polyfillGlobal("TextDecoderStream", () => TextDecoderStream);
      }
    } catch {}
  };

  setupPolyfills();
}
