import React, { forwardRef, useCallback, useState } from "react";
import {
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  StyleSheet as UnistyleStyleSheet,
  useUnistyles,
} from "react-native-unistyles";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

type MeasuredBottomSheetProps = {
  /** Pinned content above the scroll area (e.g. title row + close button). */
  header?: React.ReactNode;
  /** Pinned content below the scroll area (e.g. action buttons). Never scrolls off screen. */
  footer?: React.ReactNode;
  /** Scrollable sheet content. Include your own horizontal padding. */
  children: React.ReactNode;
  /** Extra gap kept below the top inset when the sheet is at max height. */
  topOffset?: number;
  onDismiss?: () => void;
};

export type MeasuredBottomSheetRef = BottomSheetModal;

const FADE_HEIGHT = 56;

/**
 * Content-sized bottom sheet built on the native Expo UI sheet.
 * Stays in native dynamic sizing (fitToContents) and clamps the scroll
 * area to a measured height driven entirely on the UI thread (reanimated
 * shared values), so expanding/collapsing content animates without JS
 * re-render jitter. Content taller than the available screen height (under
 * the top inset, minus pinned header/footer) scrolls, with a fade hint at
 * the bottom edge.
 */
const MeasuredBottomSheet = forwardRef<BottomSheetModal, MeasuredBottomSheetProps>(
  ({ header, footer, children, topOffset = 0, onDismiss }, ref) => {
    const { theme, rt } = useUnistyles();

    // Full available height under the status bar / top inset.
    const maxSheetH = rt.screen.height - rt.insets.top - topOffset;

    // All measurements live in shared values — updates don't re-render React.
    const headerH = useSharedValue(0);
    const footerH = useSharedValue(0);
    const contentH = useSharedValue(0);
    const atEnd = useSharedValue(false);
    const atStart = useSharedValue(true);
    const fadeOpacity = useSharedValue(0);
    const topFadeOpacity = useSharedValue(0);

    // Only the rarely-changing scrollEnabled flag crosses back into React.
    const [scrollEnabled, setScrollEnabled] = useState(false);

    const handleHeaderLayout = useCallback(
      (e: { nativeEvent: { layout: { height: number } } }) => {
        headerH.value = Math.ceil(e.nativeEvent.layout.height);
      },
      [headerH]
    );

    const handleFooterLayout = useCallback(
      (e: { nativeEvent: { layout: { height: number } } }) => {
        footerH.value = Math.ceil(e.nativeEvent.layout.height);
      },
      [footerH]
    );

    const handleContentSizeChange = useCallback(
      (_w: number, h: number) => {
        // Fires continuously while content height animates (e.g. Collapsible
        // expanding). Writing to a shared value keeps the container height
        // tracking on the UI thread without per-frame React re-renders.
        contentH.value = Math.ceil(h);
      },
      [contentH]
    );

    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        atEnd.value =
          contentOffset.y + layoutMeasurement.height >= contentSize.height - 12;
        atStart.value = contentOffset.y <= 12;
      },
      [atEnd, atStart]
    );

    // Clamped scroll container height — fully on the UI thread.
    const scrollContainerStyle = useAnimatedStyle(() => {
      const available = Math.max(maxSheetH - headerH.value - footerH.value, 120);
      if (contentH.value <= 0) {
        return { maxHeight: available };
      }
      return { height: Math.min(contentH.value, available) };
    });

    // Fade visibility + scrollEnabled, derived on the UI thread; only
    // boolean flips cross to JS.
    useAnimatedReaction(
      () => {
        const available = Math.max(maxSheetH - headerH.value - footerH.value, 120);
        return contentH.value > available + 1;
      },
      (scrollable, prev) => {
        if (scrollable !== prev) {
          runOnJS(setScrollEnabled)(scrollable);
        }
        const fadeVisible = scrollable && !atEnd.value;
        fadeOpacity.value = withTiming(fadeVisible ? 1 : 0, {
          duration: 200,
          easing: Easing.inOut(Easing.ease),
        });
        const topFadeVisible = scrollable && !atStart.value;
        topFadeOpacity.value = withTiming(topFadeVisible ? 1 : 0, {
          duration: 200,
          easing: Easing.inOut(Easing.ease),
        });
      }
    );

    useAnimatedReaction(
      () => atEnd.value,
      (ended, prev) => {
        if (ended === prev) return;
        const available = Math.max(maxSheetH - headerH.value - footerH.value, 120);
        const scrollable = contentH.value > available + 1;
        fadeOpacity.value = withTiming(scrollable && !ended ? 1 : 0, {
          duration: 200,
          easing: Easing.inOut(Easing.ease),
        });
      }
    );

    useAnimatedReaction(
      () => atStart.value,
      (started, prev) => {
        if (started === prev) return;
        const available = Math.max(maxSheetH - headerH.value - footerH.value, 120);
        const scrollable = contentH.value > available + 1;
        topFadeOpacity.value = withTiming(scrollable && !started ? 1 : 0, {
          duration: 200,
          easing: Easing.inOut(Easing.ease),
        });
      }
    );

    const fadeStyle = useAnimatedStyle(() => ({
      opacity: fadeOpacity.value,
    }));

    const topFadeStyle = useAnimatedStyle(() => ({
      opacity: topFadeOpacity.value,
    }));

    const backgroundColor = theme.colors.background.default;
    const fadeStart =
      backgroundColor.startsWith("#") && backgroundColor.length === 7
        ? `${backgroundColor}00`
        : "transparent";

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing={true}
        backgroundStyle={{ backgroundColor }}
        handleComponent={null}
        enablePanDownToClose={true}
        onDismiss={onDismiss}
      >
        <BottomSheetView>
          {header ? <View onLayout={handleHeaderLayout}>{header}</View> : null}
          <Animated.View style={scrollContainerStyle}>
            <BottomSheetScrollView
              onContentSizeChange={handleContentSizeChange}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              scrollEnabled={scrollEnabled}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </BottomSheetScrollView>
            <Animated.View
              pointerEvents="none"
              style={[styles.topFade, topFadeStyle]}
            >
              <LinearGradient
                colors={[backgroundColor, fadeStart]}
                style={styles.fadeGradient}
              />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[styles.fade, fadeStyle]}
            >
              <LinearGradient
                colors={[fadeStart, backgroundColor]}
                style={styles.fadeGradient}
              />
            </Animated.View>
          </Animated.View>
          {footer ? <View onLayout={handleFooterLayout}>{footer}</View> : null}
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

MeasuredBottomSheet.displayName = "MeasuredBottomSheet";

export default MeasuredBottomSheet;

const styles = UnistyleStyleSheet.create(() => ({
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: FADE_HEIGHT,
  },
  topFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: FADE_HEIGHT,
  },
  fadeGradient: {
    flex: 1,
  },
}));
