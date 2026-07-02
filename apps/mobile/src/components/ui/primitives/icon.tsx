import { useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/utils/unistyles";

export type IconProps = {
  icon: React.ComponentType<any>;
  name: string;
  style?: StyleProp<ViewStyle>;
  size?: "sm" | "md" | "lg" | number;
  color?:
    | string
    | "primary"
    | "brand"
    | "secondary"
    | "success"
    | "warning"
    | "error"
    | "neutral"
    | "muted";
  mode?: "error" | "success" | "disabled";
  isDark?: boolean;
  theme: Theme;
};

const getIconSize = (size: IconProps["size"] = "md", theme: Theme) => {
  if (typeof size === "number") return size;

  // Fallback spacing values if theme not available
  const spacing = theme.spacing;

  switch (size) {
    case "sm":
      return spacing.xs;
    case "md":
      return spacing.sm;
    case "lg":
      return spacing.md;
  }
};

const getIconColor = (
  color: IconProps["color"],
  mode?: IconProps["mode"],
  isDark?: boolean
) => {
  // Get theme colors directly based on current theme context
  const isLight = !isDark;

  // Define colors per theme directly (no runtime dependency)
  const themeColors = {
    text: {
      default: isLight ? "#202329" : "#fafafa",
      subtle: isLight ? "rgba(32, 35, 41, 0.65)" : "rgba(250, 250, 250, 0.65)",
    },
    primary: isLight ? "#0d0f12" : "#f1f3f7",
    brand: "#4285f4",
    secondary: isLight ? "#007AFF" : "#0A84FF",
    success: "#16A34A",
    warning: isLight ? "#FF9500" : "#FF9F0A",
    error: isLight ? "#FF3B30" : "#FF453A",
    neutral: isLight ? "#6B7280" : "#98989D",
  };

  if (mode === "disabled") return themeColors.text.subtle;
  if (mode === "error") return themeColors.error;
  if (mode === "success") return themeColors.success;

  if (typeof color === "string") {
    switch (color) {
      case "primary":
        return themeColors.primary;
      case "brand":
        return themeColors.brand;
      case "secondary":
        return themeColors.secondary;
      case "success":
        return themeColors.success;
      case "warning":
        return themeColors.warning;
      case "error":
        return themeColors.error;
      case "neutral":
        return themeColors.neutral;
      case "muted":
        return themeColors.text.subtle;
      default:
        return color; // Direct color value
    }
  }

  return themeColors.primary; // Default color
};

const IconBase: React.FC<IconProps> = ({
  icon: IconComponent,
  name,
  style,
  size = "md",
  color = "primary",
  mode,
  isDark,
  theme,
}) => {
  // Use context theme directly - no runtime dependency!
  const iconColor = useMemo(
    () => getIconColor(color, mode, isDark),
    [color, mode, isDark]
  );

  const iconSize = useMemo(() => getIconSize(size, theme), [size, theme]);

  return (
    <View style={[{ alignItems: "center", justifyContent: "center" }, style]}>
      <IconComponent name={name} size={iconSize} color={iconColor} />
    </View>
  );
};

const Icon = withUnistyles(IconBase, (theme, rt) => ({
  // Anything that's not the explicit light theme should pick the dark
  // icon palette so icons stay legible on dark surfaces.
  isDark: rt.themeName !== "light",
  theme,
}));

export { Icon };
