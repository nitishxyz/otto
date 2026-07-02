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
import { useEffect, createContext } from "react";
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

type SheetNavigatorContextType = {
  handleClose: () => void;
};

const SheetNavigatorContext = createContext<SheetNavigatorContextType | null>(null);

const ProgressIndicator = ({ 
  currentStep, 
  totalSteps 
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
            index <= currentStep ? styles.progressDotActive : styles.progressDotInactive,
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

const SimpleSheetNavigator: React.FC<SheetNavigatorProps> = ({
  visible,
  onClose,
  steps,
  onComplete,
  initialData,
  disableBackdrop,
  showProgress = true,
  title,
}) => {
  // Modal animations - exactly like PopupSheet
  const translateY = useSharedValue(1000);
  const scale = useSharedValue(0.98);
  const backdropOpacity = useSharedValue(0);
  
  // Content step animations
  const currentContentOpacity = useSharedValue(1);
  const currentContentTranslateX = useSharedValue(0);
  

  


  const navigation = useSheetNavigation({
    steps,
    initialData,
    onComplete,
  });

  // Modal entrance/exit animations - exactly like PopupSheet
  useEffect(() => {
    if (visible) {
      // Reset all values first to prevent conflicts from previous modal
      backdropOpacity.value = 0;
      translateY.value = 1000;
      scale.value = 0.98;
      currentContentOpacity.value = 1;
      currentContentTranslateX.value = 0;
      
      // Entrance animation
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
    // Simplified close without runOnJS to prevent crashes
    try {
      navigation.reset();
    } catch (error) {
      console.log("Navigation reset error:", error);
    }
    
    // Just call onClose immediately - let React handle the unmounting
    onClose();
  };

  // Track previous step for slide direction
  const prevStepIndex = useSharedValue(navigation.currentStepIndex);

  // Step transition animations - slower, smoother like PopupSheet
  useEffect(() => {
    const currentIndex = navigation.currentStepIndex;
    const prevIndex = prevStepIndex.value;
    
    if (currentIndex !== prevIndex) {
      // Determine slide direction
      const isNext = currentIndex > prevIndex;
      const slideDistance = 150; // Reduced distance for smoother feel
      
      // Phase 1: Slide out and fade out current content (slower)
      currentContentOpacity.value = withTiming(0, { duration: 250 });
      currentContentTranslateX.value = withTiming(
        isNext ? -slideDistance : slideDistance, 
        { duration: 250 },
        () => {
          // Phase 2: Reset positions and slide in new content
          currentContentTranslateX.value = isNext ? slideDistance : -slideDistance;
          currentContentOpacity.value = 0;
          
          // Slide in and fade in new content (slower)
          currentContentOpacity.value = withTiming(1, { duration: 250 });
          currentContentTranslateX.value = withTiming(0, { duration: 250 });
        }
      );
      
      prevStepIndex.value = currentIndex;
    }
  }, [navigation.currentStepIndex]);



  // Animated styles
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: currentContentOpacity.value,
    transform: [{ translateX: currentContentTranslateX.value }],
  }));





  const colorScheme = useColorScheme();

  if (!visible) return null;

  const currentStepTitle = navigation.currentStep?.title || title;
  const StepComponent = navigation.currentStep?.component;

  return (
    <SheetNavigatorContext.Provider value={{ handleClose }}>
      <RNModal
        visible={visible}
        onRequestClose={handleClose}
        animationType="none"
        transparent={true}
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
            p="lg"
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

            {/* Step Content Container - with overflow hidden */}
            <Box style={styles.contentContainer}>
              <Animated.View style={[styles.stepContent, contentAnimatedStyle]}>
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
          </Box>
        </Animated.View>
      </KeyboardAvoidingView>
      </RNModal>
    </SheetNavigatorContext.Provider>
  );
};

export { SimpleSheetNavigator };
export default SimpleSheetNavigator;

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
    paddingTop: theme.spacing.lg,
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
  contentContainer: {
    flex: 1,
    marginTop: theme.spacing.md,
    overflow: "hidden", // Prevent content from going outside the sheet
  },
  stepContent: {
    flex: 1,
  },
}));
