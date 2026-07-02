import React, { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useUnistyles } from "react-native-unistyles";
import Svg, { G, Path } from "react-native-svg";

const SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 32,
} as const;

const SPOKES = [
  "M8 1.75v2",
  "M12.42 3.58 11 5",
  "M14.25 8h-2",
  "M12.42 12.42 11 11",
  "M8 14.25v-2",
  "M3.58 12.42 5 11",
  "M1.75 8h2",
  "M3.58 3.58 5 5",
];

export interface SpinnerProps {
  size?: keyof typeof SIZES | number;
  color?: string;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = "md",
  color,
  duration = 1000,
  style,
}) => {
  const { theme } = useUnistyles();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration, easing: Easing.linear }),
      -1,
    );
    return () => {
      cancelAnimation(rotation);
    };
  }, [duration, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const dimension = typeof size === "number" ? size : SIZES[size];
  const strokeColor = color ?? theme.colors.text.default;

  return (
    <Animated.View
      style={[{ width: dimension, height: dimension }, animatedStyle, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Svg width={dimension} height={dimension} viewBox="0 0 16 16" fill="none">
        <G stroke={strokeColor} strokeWidth={1.8} strokeLinecap="round">
          {SPOKES.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
      </Svg>
    </Animated.View>
  );
};
