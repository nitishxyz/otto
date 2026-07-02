import BlurView from "@/components/ui/primitives/blur-view";
import haptics from "@/components/utils/haptics";
import { Icon, Text } from "@/primitives";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { router } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

const routes = [
  {
    name: "home",
    icon: MaterialCommunityIcons,
    iconName: "circle-multiple-outline",
    iconNameFocused: "circle-multiple",
    label: "Home",
    path: "(app)/tabs/home",
    size: 25,
  },
  {
    name: "stocks",
    icon: Ionicons,
    iconName: "bar-chart-outline",
    iconNameFocused: "bar-chart",
    label: "Stocks",
    path: "(app)/tabs/stocks",
    size: 21,
  },
  {
    name: "settings",
    icon: Ionicons,
    iconName: "settings-outline",
    iconNameFocused: "settings",
    label: "Settings",
    path: "(app)/tabs/settings",
    size: 23,
  },
];

const TabItem = React.memo(
  ({
    route,
    isFocused,
    onPress,
  }: {
    route: (typeof routes)[0];
    isFocused: boolean;
    onPress: () => void;
  }) => {
    const animatedValue = useSharedValue(isFocused ? 1 : 0);

    // Update animation when focus changes
    React.useEffect(() => {
      animatedValue.value = withTiming(isFocused ? 1 : 0, { duration: 200 });
    }, [isFocused, animatedValue]);

    // Animated style for the icon container
    const iconStyle = useAnimatedStyle(() => {
      return {
        transform: [
          {
            rotate: `${interpolate(
              animatedValue.value,
              [0, 1],
              [0, 360],
              Extrapolation.CLAMP
            )}deg`,
          },
          {
            scale: interpolate(
              animatedValue.value,
              [0, 1],
              [1, 1.1],
              Extrapolation.CLAMP
            ),
          },
        ],
      };
    });

    const handlePress = React.useCallback(() => {
      haptics.selection();
      onPress();
    }, [onPress]);

    return (
      <Pressable onPress={handlePress} style={styles.tab}>
        <Animated.View style={[styles.iconContainer, iconStyle]}>
          <Icon
            icon={route.icon}
            name={isFocused ? route.iconNameFocused : route.iconName}
            size={route.size}
          />
        </Animated.View>
        <Text style={styles.label}>{route.label}</Text>
      </Pressable>
    );
  }
);
TabItem.displayName = "TabItem";

const BottomTabs = React.memo(({ ...props }: BottomTabBarProps) => {
  const { state } = props;
  const { index } = state;
  const thumbPosition = useSharedValue(index);
  const insets = useSafeAreaInsets();

  // Update thumb position when active tab changes
  React.useEffect(() => {
    thumbPosition.value = withTiming(index, { duration: 200 });
  }, [index, thumbPosition]);

  // Animated style for the thumb indicator
  const thumbStyle = useAnimatedStyle(() => {
    const tabWidth = 100 / routes.length;
    const thumbWidth = tabWidth * 0.3;
    const leftPosition = interpolate(
      thumbPosition.value,
      [0, routes.length - 1],
      [
        (tabWidth - thumbWidth) / 2,
        tabWidth * (routes.length - 1) + (tabWidth - thumbWidth) / 2,
      ],
      Extrapolation.CLAMP
    );

    return {
      left: `${leftPosition}%`,
      width: `${thumbWidth}%`,
    };
  });

  const navigateToRoute = React.useCallback((path: string) => {
    router.navigate(path as any);
  }, []);

  return (
    <BlurView
      style={[styles.container, { paddingBottom: insets.bottom }]}
      intensity={70}
    >
      <Animated.View style={[styles.thumb, thumbStyle]} />
      {routes.map((route, idx) => (
        <TabItem
          key={route.name}
          route={route}
          isFocused={index === idx}
          onPress={() => navigateToRoute(route.path)}
        />
      ))}
    </BlurView>
  );
});
BottomTabs.displayName = "BottomTabs";

export default BottomTabs;

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 1,
  },
  iconContainer: {
    marginBottom: 4,
    backfaceVisibility: "hidden",
  },
  label: {
    height: 16,
  },
  thumb: {
    position: "absolute",
    height: 4,
    top: 0,
    borderRadius: 2,
    zIndex: 0,
    backgroundColor: theme.colors.text.default,
  },
}));
