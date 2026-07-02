import React, { useEffect, type PropsWithChildren } from "react";
import { useIsFocused } from "expo-router/react-navigation";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export default function TabSceneTransition({ children }: PropsWithChildren) {
  const isFocused = useIsFocused();
  const progress = useSharedValue(isFocused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isFocused ? 1 : 0, {
      duration: isFocused ? 220 : 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [isFocused, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: interpolate(progress.value, [0, 1], [0.985, 1]),
    transform: [
      { scale: interpolate(progress.value, [0, 1], [0.992, 1]) },
      { translateY: interpolate(progress.value, [0, 1], [6, 0]) },
    ],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
