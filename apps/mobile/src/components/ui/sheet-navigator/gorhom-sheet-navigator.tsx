/* eslint-disable react-hooks/set-state-in-effect -- Sheet step state intentionally resets after navigation changes. */
import React, {
  useCallback,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
} from "react";
import { useColorScheme } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import {
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import { Box } from "../primitives/box";
import { Button } from "../primitives/button";
import { Icon } from "../primitives/icon";
import { Text } from "../primitives/text";
import { Feather } from "@expo/vector-icons";
import { StyleSheet as UnistyleStyleSheet } from "react-native-unistyles";
import { useSheetNavigation } from "./hooks/use-sheet-navigation";
import type { SheetNavigatorProps } from "./types";
import { SimpleProgressHeader } from "./simple-progress-header";

export type GorhomSheetNavigatorRef = {
  present: () => void;
  dismiss: () => void;
};

// Custom Blur Backdrop Component
const CustomBackdrop = ({ animatedIndex, style }: BottomSheetBackdropProps) => {
  const colorScheme = useColorScheme();

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const containerStyle = useMemo(
    () => [style, containerAnimatedStyle],
    [style, containerAnimatedStyle]
  );

  return (
    <Animated.View style={containerStyle}>
      <BlurView
        intensity={50}
        tint={colorScheme === "dark" ? "dark" : "light"}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
};

// Close Button Component
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

// Main GorhomSheetNavigator Component
const GorhomSheetNavigator = forwardRef<
  GorhomSheetNavigatorRef,
  SheetNavigatorProps
>(
  (
    {
      visible,
      onClose,
      steps,
      onComplete,
      initialData,
      disableBackdrop,

      title,
    },
    ref
  ) => {
    const bottomSheetModalRef = useRef<BottomSheetModal>(null);

    // Memoize onComplete to prevent navigation hook recreation
    const handleComplete = useCallback(
      async (data: any) => {
        if (onComplete) {
          try {
            await Promise.resolve(onComplete(data));
          } catch (error) {
            // Handle any completion errors
            console.error("Sheet navigation completion error:", error);
          }
        }
        // Close the sheet after completion
        bottomSheetModalRef.current?.dismiss();
      },
      [onComplete]
    );

    // Navigation logic using existing hook
    const navigation = useSheetNavigation({
      steps,
      initialData,
      onComplete: handleComplete,
    });



    // Track step completion status
    const [isCurrentStepComplete, setIsCurrentStepComplete] = useState(false);
    
    // Reset step completion when step changes
    useEffect(() => {
      setIsCurrentStepComplete(false);
    }, [navigation.currentStepIndex]);
    
    // Callback for steps to mark themselves as complete
    const handleSetStepComplete = useCallback((complete: boolean) => {
      setIsCurrentStepComplete(complete);
    }, []);
    
    // Dynamic animation configs - fast for initial open, slow for page changes
    const [isInitialOpen, setIsInitialOpen] = useState(true);
    
    const fastAnimationConfigs = useBottomSheetSpringConfigs({
      damping: 30,
      overshootClamping: false,
      stiffness: 400,
      mass: 1,
    });
    
    const slowAnimationConfigs = useBottomSheetSpringConfigs({
      damping: 50,
      overshootClamping: true,
      stiffness: 180,
      mass: 1.2,
    });
    
    const currentAnimationConfigs = isInitialOpen ? fastAnimationConfigs : slowAnimationConfigs;





    // Present modal - use refs to avoid dependencies
    const present = useCallback(() => {
      setIsInitialOpen(true); // Start with fast animation
      navigation.reset(); // Reset navigation state
      bottomSheetModalRef.current?.present();
    }, [navigation, setIsInitialOpen]);

    // Dismiss modal
    const dismiss = useCallback(() => {
      bottomSheetModalRef.current?.dismiss();
    }, []);

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        present,
        dismiss,
      }),
      [present, dismiss]
    );

    // Note: We don't handle the visible prop automatically.
    // Parent components should use the ref to control the sheet:
    // - Call sheetRef.current?.present() to show
    // - Call sheetRef.current?.dismiss() to hide



    // Switch to slow animations after initial open
    useEffect(() => {
      if (isInitialOpen) {
        // Set a small delay to switch to slow animations after initial open
        const timer = setTimeout(() => {
          setIsInitialOpen(false);
        }, 500); // Give time for initial animation to complete
        
        return () => clearTimeout(timer);
      }
    }, [isInitialOpen, setIsInitialOpen]);

    // Switch to slow animations when navigating between steps
    useEffect(() => {
      if (navigation.currentStepIndex > 0 && isInitialOpen) {
        setIsInitialOpen(false);
      }
    }, [navigation.currentStepIndex, isInitialOpen, setIsInitialOpen]);

    // Handle sheet changes
    const handleSheetChanges = useCallback(
      (index: number) => {
        // Sheet was dismissed
        if (index === -1) {
          onClose();
          navigation.reset();
          setIsInitialOpen(true); // Reset for next time
        }
      },
      [onClose, navigation, setIsInitialOpen]
    );



    // Get current step info
    const currentStepTitle = navigation.currentStep?.title || title;
    const StepComponent = navigation.currentStep?.component;

    return (
      <BottomSheetModal
        ref={bottomSheetModalRef}
        onChange={handleSheetChanges}
        enableDynamicSizing={true}
        backdropComponent={
          !disableBackdrop
            ? (props) => <CustomBackdrop {...props} />
            : undefined
        }
        backgroundStyle={styles.backgroundStyle}
        style={styles.sheetStyle}
        handleStyle={styles.handleStyle}
        handleIndicatorStyle={styles.handleIndicatorStyle}
        enablePanDownToClose={true}
        enableDismissOnClose={true}
        animationConfigs={currentAnimationConfigs}
        animateOnMount={true}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustPan"
        enableBlurKeyboardOnGesture
      >
        <BottomSheetView
          style={[styles.contentContainer, { backgroundColor: "transparent" }]}
        >
          <Box m="sm" shadow="lg" style={styles.container} border="thin">
            {/* Header with Title and Progress */}
            <Box style={styles.header}>
              {/* Title Row with Close Button */}
              <Box direction="row" alignItems="center" pl="md" pr="md">
                <CloseButton hidden disabled />
                <Box flex center>
                  {currentStepTitle && (
                    <Text size="xl" weight="bold">
                      {currentStepTitle}
                    </Text>
                  )}
                </Box>
                <CloseButton hidden disabled />
              </Box>

              {/* Progress Row - Centered Below Title */}
              <Box center mt="sm">
                <SimpleProgressHeader
                  currentStep={navigation.currentStepIndex}
                  totalSteps={steps.length}
                  isCurrentStepComplete={isCurrentStepComplete}
                />
              </Box>
            </Box>

            {/* Step Content */}
            <Box flex>
              {StepComponent && (
                <StepComponent
                  data={navigation.data}
                  updateData={navigation.updateData}
                  goNext={navigation.goNext}
                  goBack={navigation.goBack}
                  dismiss={dismiss}
                  isLoading={navigation.isLoading}
                  errors={navigation.errors}
                  stepIndex={navigation.currentStepIndex}
                  totalSteps={steps.length}
                  setStepComplete={handleSetStepComplete}
                />
              )}
            </Box>
          </Box>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

GorhomSheetNavigator.displayName = "GorhomSheetNavigator";

export default GorhomSheetNavigator;

const styles = UnistyleStyleSheet.create((theme, rt) => ({
  // Bottom Sheet Modal Styles - Make completely transparent
  sheetStyle: {
    backgroundColor: "rgba(0, 0, 0, 0)",
    shadowColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  backgroundStyle: {
    backgroundColor: "rgba(0, 0, 0, 0)",
  },
  handleStyle: {
    backgroundColor: "rgba(0, 0, 0, 0)",
    height: 0, // Hide handle completely
    opacity: 0,
  },
  handleIndicatorStyle: {
    backgroundColor: "rgba(0, 0, 0, 0)",
    width: 0,
    height: 0, // Hide handle indicator completely
    opacity: 0,
  },

  // Content Container
  contentContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0)",
    paddingTop: theme.spacing.lg,
    paddingBottom: rt.insets.bottom,
  },

  // Popup Container (our actual popup)
  container: {
    alignSelf: "stretch",
    borderRadius: theme.radius.tera,
    paddingTop: theme.spacing.lg,
    backgroundColor: theme.colors.background.base,
  },

  // Header
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

  // Progress Indicator
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
