import React, { useEffect } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";

type CollapsibleProps = {
  expanded: boolean;
  children: React.ReactNode;
  duration?: number;
};

/**
 * Smoothly animates its children open/closed by animating height + opacity.
 * Content is rendered absolutely inside a clipped container so its natural
 * height can be measured while the container height animates. Inside the
 * native Expo UI bottom sheet, the sheet height follows the content height
 * frame-by-frame, so the sheet resize animates too.
 */
export function Collapsible({
  expanded,
  children,
  duration = 250,
}: CollapsibleProps) {
  const contentH = useSharedValue(0);
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration,
      easing: Easing.inOut(Easing.ease),
    });
  }, [expanded, duration, progress]);

  const handleLayout = (e: LayoutChangeEvent) => {
    contentH.value = e.nativeEvent.layout.height;
  };

  const containerStyle = useAnimatedStyle(() => ({
    height: contentH.value * progress.value,
    opacity: progress.value,
    overflow: "hidden" as const,
  }));

  return (
    <Animated.View style={containerStyle}>
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
        onLayout={handleLayout}
      >
        {children}
      </View>
    </Animated.View>
  );
}

export default Collapsible;
