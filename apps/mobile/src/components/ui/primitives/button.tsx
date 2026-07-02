/* eslint-disable react-hooks/refs -- React Native Animated values are stored in refs for stable native animations. */
import {
  triggerHaptic,
  type HapticConfig,
  type HapticFeedbackType,
} from "@/components/utils/haptics";
import { getContrastColor, getIconSize } from "@/utils/theme";
import { createContext, useContext, useMemo, useRef } from "react";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { Animated, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTheme } from "@/providers/theme-context";
import { ButtonText, type ButtonTextProps } from "./button-text";
import { Spinner } from "@/components/ui/primitives/spinner";

type ButtonContextType = {
  size: "sm" | "md" | "lg" | "auto";
  variant?: "outline" | "ghost";
  mode?:
    | "subtle"
    | "brand"
    | "secondary"
    | "warning"
    | "error"
    | "success"
    | "disabled";
  margin?: "sm" | "md" | "lg";
  disabled?: boolean;
};

const ButtonContext = createContext<ButtonContextType>({
  size: "md",
  variant: undefined,
});

export type ButtonProps = PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  size?: "sm" | "md" | "lg" | "auto";
  variant?: "outline" | "ghost";
  mode?:
    | "subtle"
    | "brand"
    | "secondary"
    | "warning"
    | "error"
    | "success"
    | "disabled";
  m?: "sm" | "md" | "lg";
  mt?: "sm" | "md" | "lg";
  mb?: "sm" | "md" | "lg";
  gap?: "none" | "sm" | "md" | "lg";
  rounded?: "none" | "sm" | "md" | "lg" | "full";
  loading?: boolean;
  haptics?: HapticFeedbackType | HapticConfig;
  shadow?: "none" | "sm" | "md" | "lg";
  border?: "none" | "subtle" | "thin" | "thick";
};

// ButtonTextProps is now imported from "./button-text"

type IconRenderProps = {
  color?: string;
  size?: number;
};

type ButtonIconProps = {
  children: React.ReactNode | ((props: IconRenderProps) => React.ReactNode);
  style?: StyleProp<ViewStyle>;
};

const Button: React.FC<ButtonProps> & {
  Text: typeof InternalButtonText;
  Icon: typeof ButtonIcon;
} = ({
  children,
  style,
  contentStyle,
  size = "md",
  variant,
  mode,
  m,
  mt,
  mb,
  gap,
  disabled,
  rounded,
  loading,
  haptics = "selection",
  shadow,
  border = "none",
  ...props
}) => {
  const { theme } = useUnistyles();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const scale = useRef(new Animated.Value(1)).current;
  let shadowNow = shadow;
  let borderNow = border;
  if (isDark && shadow) {
    shadowNow = "none";
    borderNow = "thin";
  }

  const isDisabled = disabled || mode === "disabled";

  const onPressIn = () => {
    // Handle both string and object configurations
    if (typeof haptics === "string") {
      triggerHaptic(haptics, isDisabled);
    } else if (haptics.in) {
      triggerHaptic(haptics.in, isDisabled);
    }

    Animated.spring(scale, {
      toValue: 0.93,
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    // Only trigger out haptic if it's configured
    if (typeof haptics !== "string" && haptics.out) {
      triggerHaptic(haptics.out, isDisabled);
    }

    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const contextValue = useMemo(
    () => ({
      size,
      variant,
      mode,
      margin: m,
      disabled: isDisabled,
    }),
    [size, variant, mode, m, isDisabled]
  );

 // Use variants to get styled container
 stylesheet.useVariants({
   size,
   variant,
   mode,
   m,
   mt,
   mb,
   gap,
   rounded,
   shadow: shadowNow,
   border: borderNow,
 });

  return (
    <ButtonContext.Provider value={contextValue}>
      <Animated.View style={{ transform: [{ scale }] }}>
       <Pressable
         disabled={contextValue.disabled}
         onPressIn={onPressIn}
         onPressOut={onPressOut}
         style={[stylesheet.container, style]}
         {...props}
       >
          {isDisabled && <View style={stylesheet.disabledOverlay} />}
         <View style={[stylesheet.content, contentStyle]}>
           {loading ? (
              <Spinner
                size="sm"
                color={
                  mode === "subtle" || variant === "outline" || variant === "ghost"
                    ? theme.colors.text.default
                    : theme.colors.background.default
                }
              />
            ) : (
              children
            )}
          </View>
        </Pressable>
      </Animated.View>
    </ButtonContext.Provider>
  );
};

const InternalButtonText = ({
 style,
 color,
 weight,
 ...props
}: ButtonTextProps) => {
  const { size, variant, mode } = useContext(ButtonContext);
 const { theme } = useUnistyles();

 const textColor = useMemo(() => {
   if (color) return color;

   // Handle outline and ghost variants
   if (variant === "outline" || variant === "ghost") {
     if (mode === "subtle") {
       return theme.colors.text.default;
     }
     return theme.colors[mode || "primary"][500];
   }

   // Handle filled variant (default behavior)
   if (mode === "subtle") {
     return theme.colors.text.default;
   }

   const buttonColor =
     mode !== "disabled"
       ? theme.colors[mode || "primary"][500]
       : theme.colors.primary[500];

   return getContrastColor(buttonColor);
  }, [color, variant, mode, theme]);

 return (
    <ButtonText
      size={size}
      weight={weight}
      color={textColor}
      style={style}
      {...props}
    />
  );
};

const ButtonIcon = ({ children, style }: ButtonIconProps) => {
  const { size, variant, mode } = useContext(ButtonContext);
 const { theme } = useUnistyles();

 const iconProps = useMemo(() => {
   const iconColor =
     variant === "outline" || variant === "ghost"
       ? (() => {
            if (mode === "subtle") {
              return theme.colors.text.default;
            }
            return theme.colors[mode || "primary"][500];
          })()
        : (() => {
            if (mode === "subtle") {
              return theme.colors.text.default;
            }
            const buttonColor =
              mode !== "disabled"
                ? theme.colors[mode || "primary"][500]
                : theme.colors.primary[500];
            return getContrastColor(buttonColor);
          })();

   return {
     size: getIconSize(size),
     color: iconColor,
   };
  }, [size, variant, mode, theme]);

 return (
    <View style={[stylesheet.icon, style]}>
      {typeof children === "function" ? children(iconProps) : children}
    </View>
  );
};

Button.Text = InternalButtonText;
Button.Icon = ButtonIcon;

export { Button };

const stylesheet = StyleSheet.create((theme) => ({
 container: {
   flexDirection: "row",
   alignItems: "center",
   justifyContent: "center",
    overflow: "hidden",
   borderWidth: 1,
   borderCurve: "continuous",
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
    borderRadius: theme.radius.md,
    transform: [{ scale: 1 }],
    shadowColor: theme.colors.contrast.base,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    variants: {
      rounded: {
        none: {
          borderRadius: 0,
        },
        sm: {
          borderRadius: theme.radius.sm,
        },
        md: {
          borderRadius: theme.radius.md,
        },
        lg: {
          borderRadius: theme.radius.lg,
        },
        full: {
          borderRadius: theme.radius.full,
        },
      },
      size: {
        sm: {
          height: 32,
          paddingHorizontal: theme.spacing.sm,
        },
        md: {
          height: 38,
          paddingHorizontal: theme.spacing.md,
        },
        lg: {
          height: 46,
          paddingHorizontal: theme.spacing.lg,
        },
        auto: {
          height: "auto",
        },
      },
      mode: {
        subtle: {
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
        },
        brand: {
          backgroundColor: theme.colors.brand[500],
          borderColor: theme.colors.brand[500],
        },
        secondary: {
          backgroundColor: theme.colors.secondary[500],
          borderColor: theme.colors.secondary[500],
        },
        warning: {
          backgroundColor: theme.colors.warning[500],
          borderColor: theme.colors.warning[500],
        },
        error: {
          backgroundColor: theme.colors.error[500],
          borderColor: theme.colors.error[500],
        },
        success: {
          backgroundColor: theme.colors.success[500],
          borderColor: theme.colors.success[500],
        },
        disabled: {
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
        },
      },
      variant: {
        outline: {
          backgroundColor: "transparent",
          borderWidth: 2,
        },
        ghost: {
          backgroundColor: "transparent",
          borderWidth: 0,
        },
      },
      m: {
        sm: { margin: theme.spacing.sm },
        md: { margin: theme.spacing.md },
        lg: { margin: theme.spacing.lg },
      },
      mt: {
        sm: { marginTop: theme.spacing.sm },
        md: { marginTop: theme.spacing.md },
        lg: { marginTop: theme.spacing.lg },
      },
      mb: {
        sm: { marginBottom: theme.spacing.sm },
        md: { marginBottom: theme.spacing.md },
        lg: { marginBottom: theme.spacing.lg },
      },
      gap: {
        none: { gap: 0 },
        sm: { gap: theme.spacing.sm },
        md: { gap: theme.spacing.md },
       lg: { gap: theme.spacing.lg },
     },
     border: {
       default: {
          borderWidth: 1,
          borderColor: "transparent",
        },
        none: {

          borderWidth: 1,
          borderColor: "transparent",
        },
        subtle: {
          borderWidth: 0.5,
          borderColor: theme.colors.border.subtle,
        },
        thin: {
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        },
        thick: {
          borderWidth: 2,
          borderColor: theme.colors.border.default,
        },
      },
      shadow: {
        none: {
          shadowOpacity: 0,
          shadowRadius: 0,
          elevation: 0,
        },
        sm: {
          shadowOpacity: 0.2,
          shadowRadius: 6,
          elevation: 2,
        },
        md: {
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 4,
        },
        lg: {
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 8,
        },
      },
    },
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  icon: {
    display: "flex",
   alignItems: "center",
   justifyContent: "center",
 },
disabledOverlay: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: theme.colors.background.default,
  opacity: 0.5,
   borderRadius: theme.radius.full,
   borderCurve: "continuous",
},
}));
