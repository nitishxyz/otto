import { selection } from "../../utils/haptics";
import { Box, Icon } from "../../ui/primitives";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import React from "react";
import { Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Color from "color";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const routes = [
  {
    name: "home",
    icon: MaterialCommunityIcons,
    iconName: "circle-multiple-outline",
    iconNameFocused: "circle-multiple",
    label: "Home",
    size: 25,
  },
  {
    name: "spend",
    icon: Ionicons,
    iconName: "card-outline",
    iconNameFocused: "card",
    label: "Spend",
    size: 24,
  },
  {
    name: "history",
    icon: Ionicons,
    iconName: "time-outline",
    iconNameFocused: "time",
    label: "History",
    size: 24,
  },
];

const TabItem = React.memo(
  ({
    route,
    isFocused,
    onPress,
    onLongPress,
  }: {
    route: (typeof routes)[0];
    isFocused: boolean;
    onPress: () => void;
    onLongPress: () => void;
  }) => {
    const animatedValue = useSharedValue(isFocused ? 1 : 0);

    React.useEffect(() => {
      animatedValue.value = withTiming(isFocused ? 1 : 0, { duration: 200 });
    }, [isFocused, animatedValue]);

    const iconStyle = useAnimatedStyle(() => {
      return {
        transform: [
          {
            rotate: `${interpolate(
              animatedValue.value,
              [0, 1],
              [0, 360],
              Extrapolation.CLAMP,
            )}deg`,
          },
          {
            scale: interpolate(
              animatedValue.value,
              [0, 1],
              [1, 1.1],
              Extrapolation.CLAMP,
            ),
          },
        ],
      };
    });

    const handlePress = React.useCallback(() => {
      selection();
      onPress();
    }, [onPress]);

    return (
      <Pressable
        onPress={handlePress}
        onLongPress={onLongPress}
        accessibilityRole="tab"
        accessibilityLabel={route.label}
        accessibilityState={{ selected: isFocused }}
        style={styles.tab}
      >
        <Animated.View style={[styles.iconContainer, iconStyle]}>
          <Icon
            icon={route.icon}
            name={isFocused ? route.iconNameFocused : route.iconName}
            size={route.size}
          />
        </Animated.View>
      </Pressable>
    );
  },
);
TabItem.displayName = "TabItem";

const BottomTabs = React.memo(({ ...props }: BottomTabBarProps) => {
  const { state, navigation } = props;
  const focusedRoute = state.routes[state.index];
  const index = routes.findIndex((route) => route.name === focusedRoute?.name);
  const thumbPosition = useSharedValue(index);
  const { theme } = useUnistyles();

  React.useEffect(() => {
    thumbPosition.value = withTiming(index, { duration: 200 });
  }, [index, thumbPosition]);

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
      Extrapolation.CLAMP,
    );

    return {
      left: `${leftPosition}%`,
      width: `${thumbWidth}%`,
    };
  });

  const navigateToRoute = (name: string) => {
    const route = state.routes.find((item) => item.name === name);
    if (!route) return;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (route.key !== focusedRoute?.key && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return (
    <Box style={styles.bottomContainer}>
      <LinearGradient
        pointerEvents="none"
        colors={(() => {
          const base = theme.colors.background.plain;
          try {
            const c = (a: number) => Color(base).alpha(a).rgb().string();
            return [c(0.6), c(0.3), c(0.1), "transparent"];
          } catch (_e) {
            return [
              "rgba(0,0,0,0.6)",
              "rgba(0,0,0,0.3)",
              "rgba(0,0,0,0.1)",
              "rgba(0,0,0,0.05)",
              "rgba(0,0,0,0.025)",
              "transparent",
            ];
          }
        })()}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={styles.gradient}
      />

      <Box style={[styles.container]} background="plain" shadow="sm">
        <Animated.View style={[styles.thumb, thumbStyle]} />
        {routes.map((route, idx) => (
          <TabItem
            key={route.name}
            route={route}
            isFocused={index === idx}
            onPress={() => navigateToRoute(route.name)}
            onLongPress={() => {
              const target = state.routes.find((item) => item.name === route.name)?.key;
              if (target) navigation.emit({ type: "tabLongPress", target });
            }}
          />
        ))}
      </Box>
    </Box>
  );
});
BottomTabs.displayName = "BottomTabs";

export default BottomTabs;

const styles = StyleSheet.create((theme, rt) => ({
  bottomContainer: {
    paddingBottom: rt.insets.bottom,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 10,
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 82 + rt.insets.bottom,
    zIndex: 0,
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 50,
    zIndex: 1000,
    marginLeft: 15,
    marginRight: 15,
  },
  tab: {
    width: 60,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    backfaceVisibility: "hidden",
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
