/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated via `.value`. */
import { StyleSheet } from "react-native-unistyles";
import { Box } from "../primitives/box";
import { Button } from "../primitives/button";
import { Icon } from "../primitives/icon";
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import {
  Pressable,
  Platform,
  Modal as RNModal,
  useColorScheme,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { BlurView } from "expo-blur";
import { Text } from "../primitives";
import { useSheetNavigation } from "./hooks/use-sheet-navigation";
import type { SheetNavigatorProps } from "./types";

const ProgressIndicator = ({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) => {
  return (
    <Box direction="row" center gap="xs" mb="sm">
      {Array.from({ length: totalSteps }, (_, index) => (
        <Box
          key={index}
          style={[
            styles.progressDot,
            index <= currentStep
              ? styles.progressDotActive
              : styles.progressDotInactive,
          ]}
        />
      ))}
    </Box>
  );
};

const CloseButton = ({
  onPress,
  disabled,
  hidden,
}: {
  onPress?: () => void;
  disabled?: boolean;
  hidden?: boolean;
}) => {
  return (
    <Box
      style={[
        styles.closeButtonContainer,
        {
          opacity: hidden ? 0 : 1,
        },
      ]}
    >
      <Button
        style={styles.closeButton}
        rounded="full"
        size="auto"
        variant="ghost"
        mode="subtle"
        onPress={onPress}
        disabled={disabled}
      >
        <Button.Icon>
          {(props) => <Icon {...props} icon={Feather} name="x" size={20} />}
        </Button.Icon>
      </Button>
    </Box>
  );
};

const SheetNavigator: React.FC<SheetNavigatorProps> = ({
  visible,
  onClose,
  steps,
  onComplete,
  initialData,
  disableBackdrop,
  showProgress = true,
  title,
}) => {
  const translateY = useSharedValue(1000);
  const scale = useSharedValue(0.98);
  const backdropOpacity = useSharedValue(0);
  const contentTranslateX = useSharedValue(0);
  const contentOpacity = useSharedValue(1);

  const navigation = useSheetNavigation({
    steps,
    initialData,
    onComplete,
  });

  // Track previous step for slide direction
  const prevStepIndex = useSharedValue(navigation.currentStepIndex);

  // Animate content when step changes with slide effect
  useEffect(() => {
    const currentIndex = navigation.currentStepIndex;
    const prevIndex = prevStepIndex.value;

    if (currentIndex !== prevIndex) {
      // Determine slide direction: next = left to right, back = right to left
      const isNext = currentIndex > prevIndex;
      const slideDirection = isNext ? -300 : 300; // negative = slide from right

      // Slide out current content
      contentTranslateX.value = withTiming(
        slideDirection,
        { duration: 200 },
        () => {
          // Reset position and slide in new content
          contentTranslateX.value = -slideDirection;
          contentTranslateX.value = withTiming(0, { duration: 200 });
        }
      );

      // Update previous step index
      prevStepIndex.value = currentIndex;
    }
  }, [navigation.currentStepIndex]);

  // Reset navigation when modal closes
  useEffect(() => {
    if (!visible) {
      // Reset animation values
      contentTranslateX.value = 0;
      contentOpacity.value = 1;
      prevStepIndex.value = 0;
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      // Entrance animation - exactly like PopupSheet
      backdropOpacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, {
        damping: 30,
        stiffness: 400,
        mass: 1,
      });
      scale.value = withSpring(1, {
        damping: 35,
        stiffness: 500,
        mass: 1,
      });
    }
  }, [visible, backdropOpacity, translateY, scale]);

  const handleClose = () => {
    // Exit animation - exactly like PopupSheet
    const exitDuration = 300;

    backdropOpacity.value = withTiming(0, { duration: exitDuration });
    scale.value = withTiming(0.98, { duration: 200 });
    translateY.value = withTiming(
      1000,
      { duration: exitDuration },
      (finished) => {
        "worklet";
        if (finished) {
          // Use setTimeout to bridge back to JS thread
          setTimeout(() => {
            navigation.reset();
            onClose();
          }, 0);
        }
      }
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: contentTranslateX.value }],
  }));

  const colorScheme = useColorScheme();

  if (!visible) return null;

  const currentStepTitle = navigation.currentStep?.title || title;
  const StepComponent = navigation.currentStep?.component;

  return (
    <RNModal
      visible={visible}
      onRequestClose={handleClose}
      animationType="slide"
      transparent={true}
      presentationStyle="overFullScreen"
    >
      {/* BlurView Backdrop */}
      {!disableBackdrop && (
        <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
          <BlurView
            intensity={50}
            tint={colorScheme === "dark" ? "dark" : "light"}
            style={StyleSheet.absoluteFillObject}
          >
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={handleClose}
            />
          </BlurView>
        </Animated.View>
      )}

      {/* Sheet Container */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
      >
        <Animated.View style={[animatedStyle, styles.sheetContainer]}>
          <Box
            m="md"
            // p="lg"
            shadow="lg"
            style={styles.container}
            border="thin"
          >
            {/* Header */}
            <Box direction="row" alignItems="center" style={styles.header}>
              <CloseButton hidden disabled />
              <Box center flex>
                {currentStepTitle && (
                  <Text size="xl" mode="subtle" weight="bold">
                    {currentStepTitle}
                  </Text>
                )}
              </Box>
              <CloseButton hidden disabled />
            </Box>

            {/* Progress Indicator */}
            {showProgress && (
              <ProgressIndicator
                currentStep={navigation.currentStepIndex}
                totalSteps={steps.length}
              />
            )}

            {/* Step Content */}
            <Animated.View
              style={[{ flex: 1, marginTop: 16 }, contentAnimatedStyle]}
            >
              {StepComponent && (
                <StepComponent
                  data={navigation.data}
                  updateData={navigation.updateData}
                  goNext={navigation.goNext}
                  goBack={navigation.goBack}
                  isLoading={navigation.isLoading}
                  errors={navigation.errors}
                  stepIndex={navigation.currentStepIndex}
                  totalSteps={steps.length}
                />
              )}
            </Animated.View>
          </Box>
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
};

export default SheetNavigator;

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardAvoidingView: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheetContainer: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
  },
  container: {
    alignSelf: "stretch",
    borderRadius: theme.radius.tera,
    // paddingTop: theme.spacing.lg,
    backgroundColor: theme.colors.background.base,
  },
  header: {
    minHeight: 35,
  },
  closeButtonContainer: {
    zIndex: 1000,
  },
  closeButton: {
    height: 35,
    width: 35,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressDotActive: {
    backgroundColor: theme.colors.primary[500],
  },
  progressDotInactive: {
    backgroundColor: theme.colors.background.lighter,
  },
}));
