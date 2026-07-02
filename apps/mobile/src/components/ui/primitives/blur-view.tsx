import React from "react";
import {
  BlurView as ExpoBlurView,
  type BlurMethod,
  type BlurTint,
  type BlurViewProps,
} from "expo-blur";
import { useUnistyles } from "react-native-unistyles";
import Color from "color";
import type { StyleProp, ViewStyle } from "react-native";

interface ThemedBlurViewProps extends Omit<BlurViewProps, 'tint'> {
  style?: StyleProp<ViewStyle>;
}

function BlurView({ style, ...props }: ThemedBlurViewProps) {
  const { theme, rt } = useUnistyles();
  // Treat any non-light theme as dark for tint + alpha purposes so the
  // BlurView doesn't render with a light frosted look on a dark background.
  const isDark = rt.themeName !== "light";
  
  // Add a semi-transparent background that matches the theme for seamless blending
  const bgColor = isDark 
    ? Color(theme.colors.background.default).alpha(0.92).toString()
    : Color(theme.colors.background.default).alpha(0.5).toString();

  return (
    <ExpoBlurView
      tint={(isDark ? "dark" : "light") as BlurTint}
      blurMethod={"dimezisBlurView" as BlurMethod}
      style={[{ backgroundColor: bgColor }, style]}
      {...props}
    />
  );
}

export default BlurView;
