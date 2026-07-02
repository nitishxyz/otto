/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated via `.value`. */
import { StyleSheet } from "react-native-unistyles";
import { Box } from "./primitives/box";
import { Button } from "./primitives/button";
import { Icon } from "./primitives/icon";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  runOnJS,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import { Pressable, Platform, Modal as RNModal } from "react-native";
import { Text } from "./primitives/text";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useTheme } from "@/providers/theme-context";

type PopupModalProps = {
  children?: React.ReactNode;
  title?: string;
  onClose?: () => void;
  disableBackdrop?: boolean;
  disableCloseButton?: boolean;
};

const CloseButton = ({
  onPress,
  hidden,
}: {
  onPress?: () => void;
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
        hitSlop={10}
      >
        <Button.Icon>
          {(props) => <Icon {...props} icon={Feather} name={"x"} size={20} />}
        </Button.Icon>
      </Button>
    </Box>
  );
};

const PopupModal = ({
  children,
  title,
  onClose,
  disableBackdrop,
}: PopupModalProps) => {
  const translateY = useSharedValue(1000);
  const scale = useSharedValue(0.98);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
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
  }, []);

  const handleClose = () => {
    const exitDuration = 300;

    backdropOpacity.value = withTiming(0, { duration: exitDuration });
    scale.value = withTiming(0.98, { duration: 200 });

    translateY.value = withTiming(
      1000,
      { duration: exitDuration },
      (finished) => {
        if (finished && onClose) {
          runOnJS(onClose)();
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

  const { currentTheme } = useTheme();
  const colorScheme = currentTheme;

  return (
    <RNModal
      visible={true}
      onRequestClose={handleClose}
      animationType="none"
      transparent={true}
    >
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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
      >
        <Animated.View style={[animatedStyle, styles.sheetContainer]}>
          <Box m="md" p="lg" shadow="lg" style={styles.container} border="thin">
            <Box direction="row" alignItems="center" style={styles.header}>
              <CloseButton hidden />
              <Box center flex>
                {title && (
                  <Text size="xl" mode="subtle" weight="bold">
                    {title}
                  </Text>
                )}
              </Box>
              <CloseButton hidden />
            </Box>

            <Box gap="sm" mt="md">
              {children}
            </Box>
          </Box>
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
};

export default PopupModal;

const styles = StyleSheet.create((theme, rt) => ({
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
    backgroundColor: theme.colors.background.default,
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
}));
