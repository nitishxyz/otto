/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated via `.value`. */
import React, { useEffect } from "react";
import { Pressable, ActivityIndicator } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/primitives/text";
import type { SonnerConfig } from "@/types/sonner";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import haptics from "@/components/utils/haptics";
import BlurView from "./primitives/blur-view";

interface SonnerItemProps {
  sonner: SonnerConfig;
  onRemove: (id: string) => void;
  index: number;
}

const getDefaultIconForType = (type: SonnerConfig["type"]) => {
  switch (type) {
    case "success":
      return { component: Ionicons, name: "checkmark-circle", size: 24 };
    case "error":
      return { component: Ionicons, name: "close-circle", size: 24 };
    case "warning":
      return { component: Ionicons, name: "warning", size: 22 };
    case "info":
      return { component: Ionicons, name: "information-circle", size: 24 };
    case "loading":
      return { component: Ionicons, name: "refresh", size: 24 };
    default:
      return { component: Ionicons, name: "information-circle", size: 24 };
  }
};

const getColorForType = (type: SonnerConfig["type"], theme: any) => {
  switch (type) {
    case "success":
      return theme.colors.success[500];
    case "error":
      return theme.colors.error[500];
    case "warning":
      return theme.colors.warning[500];
    case "info":
      return theme.colors.brand[500];
    case "loading":
      return theme.colors.neutral[500];
    default:
      return theme.colors.neutral[500];
  }
};

export const SonnerItem: React.FC<SonnerItemProps> = ({
  sonner,
  onRemove,
  index,
}) => {
  const { theme } = useUnistyles();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const contentScale = useSharedValue(1);
  const { rt } = useUnistyles();
  const animatedTop = useSharedValue(rt.insets.top + index * 48);

  useEffect(() => {
    // Animate in with improved spring settings for Reanimated 4
    translateY.value = withSpring(0, {
      damping: 20,
      stiffness: 200,
      mass: 0.8,
      overshootClamping: false,
    });
    opacity.value = withTiming(1, { duration: 250 });
    scale.value = withSpring(1, {
      damping: 18,
      stiffness: 180,
      mass: 0.7,
      overshootClamping: false,
    });

    // Trigger haptic feedback for initial mount (only loading gets haptic on mount)
    const triggerInitialHaptic = async () => {
      try {
        console.log("Initial mount haptic for type:", sonner.type);
        if (sonner.type === "loading") {
          await haptics.selection();
        }
      } catch (error) {
        console.error("Initial haptic error:", error);
      }
    };

    triggerInitialHaptic();

    // Auto dismiss for non-loading and non-persistent sonners
    if (sonner.type !== "loading" && !sonner.persistent) {
      const duration = sonner.duration || 3000;
      const timer = setTimeout(() => {
        handleRemove();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, []);

  // Remove excessive content scaling that causes blur - only scale on type changes
  useEffect(() => {
    if (sonner.type !== "loading") {
      contentScale.value = withTiming(0.99, { duration: 80 }, () => {
        contentScale.value = withTiming(1, { duration: 80 });
      });
    }
  }, [sonner.type]);

  // Trigger haptic feedback when sonner type changes (for state updates)
  useEffect(() => {
    const triggerHapticOnChange = async () => {
      try {
        console.log("Sonner type changed, triggering haptic for:", sonner.type);
        switch (sonner.type) {
          case "success":
            await haptics.successNotification();
            break;
          case "error":
            await haptics.errorNotification();
            break;
          case "warning":
            await haptics.warningNotification();
            break;
          case "info":
            await haptics.lightImpact();
            break;
          // Don't trigger haptic for loading state changes
          case "loading":
            break;
        }
      } catch (error) {
        console.error("Haptic error on type change:", error);
      }
    };

    // Only trigger if it's not the initial load (skip loading state)
    if (sonner.type !== "loading") {
      triggerHapticOnChange();
    }
  }, [sonner.type]);

  // Auto dismiss when sonner updates (for state changes)
  useEffect(() => {
    if (sonner.type !== "loading" && !sonner.persistent && sonner.duration) {
      console.log(`Setting auto-dismiss timer for ${sonner.duration}ms`);
      const timer = setTimeout(() => {
        handleRemove();
      }, sonner.duration);

      return () => clearTimeout(timer);
    }
  }, [sonner.type, sonner.persistent, sonner.duration]);

  // Animate position changes when index changes (smooth repositioning)
  useEffect(() => {
    animatedTop.value = withSpring(rt.insets.top + index * 48, {
      damping: 20,
      stiffness: 200,
      mass: 0.8,
    });
  }, [index]);

  const handleRemove = () => {
    translateY.value = withTiming(-100, { duration: 250 });
    opacity.value = withTiming(0, { duration: 250 }, (finished) => {
      "worklet";
      if (finished) {
        runOnJS(onRemove)(sonner.id);
      }
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  const positionStyle = useAnimatedStyle(() => ({
    top: animatedTop.value,
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: contentScale.value }],
  }));

  const iconColor = getColorForType(sonner.type, theme);
  const iconData = sonner.icon || getDefaultIconForType(sonner.type);
  const IconComponent = iconData.component;
  const hasText = sonner.title && sonner.title.trim();

  return (
    <Animated.View style={[styles.container, animatedStyle, positionStyle]}>
      <Animated.View style={styles.centeredContainer}>
        <Animated.View style={contentAnimatedStyle}>
          <BlurView intensity={60} style={styles.blurView}>
            <Pressable
              style={[styles.pressable, !hasText && styles.pressableNoText]}
              onPress={() => {
                if (sonner.onPress) {
                  sonner.onPress();
                }
                if (!sonner.persistent) {
                  handleRemove();
                }
              }}
            >
              <Animated.View style={styles.iconContainer}>
                {sonner.type === "loading" ? (
                  <ActivityIndicator size="small" color={iconColor} />
                ) : (
                  <IconComponent
                    name={iconData.name as any}
                    size={iconData.size || 20}
                    color={iconColor}
                  />
                )}
              </Animated.View>
              {sonner.title && sonner.title.trim() && (
                <Text style={styles.title} numberOfLines={1}>
                  {sonner.title}
                </Text>
              )}
            </Pressable>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  centeredContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  blurView: {
    borderRadius: 9999,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: theme.colors.border.default,
    alignSelf: "center",
    maxWidth: "85%",
  },
  pressable: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing.md,
    paddingVertical: 2,
  },
  pressableNoText: {
    paddingRight: 0,
    paddingVertical: 0,
  },
  iconContainer: {
    backgroundColor: theme.colors.background.subtle,
    borderRadius: 9999,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    margin: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text.default,
    marginLeft: theme.spacing.xs,
    textAlign: "left",
    includeFontPadding: false,
  },
}));
