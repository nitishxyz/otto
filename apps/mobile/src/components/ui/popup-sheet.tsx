/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated via `.value`. */
import { StyleSheet } from "react-native-unistyles";
import { Box } from "./primitives/box";
import { Button } from "./primitives/button";
import { BodySmall } from "./typography";
import { Icon } from "./primitives/icon";
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  runOnJS,
  withTiming,
} from "react-native-reanimated";
import { useEffect, createContext, useContext } from "react";
import {
  Pressable,
  Platform,
  Modal as RNModal,
} from "react-native";
import { useTheme } from "@/providers/theme-context";
import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { MaterialCommunityIcons } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { BlurView } from "expo-blur";
import { Text } from "./primitives";

type PopupSheetProps = {
  children?: React.ReactNode;
  title?: string;
  visible: boolean;
  onClose?: () => void;
  disableBackdrop?: boolean;
  disableCloseButton?: boolean;
};

type PopupSheetItemProps = {
  icon?: any;
  iconName?: string;
  title: string;
  description?: string;
  rightContent?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

type PopupSheetSectionProps = {
  title?: string;
  children: React.ReactNode;
};

type PopupSheetCustomContentProps = {
  children: React.ReactNode;
};

type PopupSheetContextType = {
  handleClose: () => void;
};

const PopupSheetContext = createContext<PopupSheetContextType | null>(null);

const PopupSheetItem = ({
  icon,
  iconName,
  title,
  description,
  rightContent,
  onPress,
  disabled,
}: PopupSheetItemProps) => {
  const context = useContext(PopupSheetContext);

  const handlePress = () => {
    if (onPress) {
      onPress();
    }
    // Use the smooth close animation instead of immediate close
    context?.handleClose();
  };

  return (
    <Button
      variant="ghost"
      size="auto"
      onPress={handlePress}
      disabled={disabled}
      style={styles.itemButton}
    >
      <Box
        direction="row"
        alignItems="center"
        rounded="xl"
        style={styles.itemContent}
      >
        {/* Left Icon Section */}
        {icon && iconName && (
          <Box
            rounded="lg"
            style={styles.iconContainer}
            center
            background="base"
          >
            <Icon icon={icon} name={iconName} size={22} />
          </Box>
        )}

        {/* Center Content Section */}
        <Box flex style={styles.textContent}>
          <Button.Text size="lg" weight="semibold">
            {title}
          </Button.Text>
          {description && (
            <BodySmall style={styles.description}>{description}</BodySmall>
          )}
        </Box>

        {/* Right Content Section */}
        {rightContent && (
          <Box alignItems="flex-end" style={styles.rightContent}>
            {rightContent}
          </Box>
        )}
      </Box>
    </Button>
  );
};

const PopupSheetSection = ({ title, children }: PopupSheetSectionProps) => {
  return (
    <Box gap="sm">
      {title && (
        <Box pl="md" pt="sm">
          <BodySmall style={styles.sectionTitle}>{title}</BodySmall>
        </Box>
      )}
      <Box gap="sm">{children}</Box>
    </Box>
  );
};

const PopupSheetCustomContent = ({
  children,
}: PopupSheetCustomContentProps) => {
  return <Box p="md">{children}</Box>;
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

const PopupSheet: React.FC<PopupSheetProps> & {
  Item: typeof PopupSheetItem;
  Section: typeof PopupSheetSection;
  CustomContent: typeof PopupSheetCustomContent;
} = ({
  children,
  title,
  visible,
  onClose,
  disableBackdrop,
}) => {
  const translateY = useSharedValue(1000);
  const scale = useSharedValue(0.98);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
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
    // Exit animation
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

  if (!visible) return null;

  return (
    <PopupSheetContext.Provider value={{ handleClose }}>
      <RNModal
        visible={visible}
        onRequestClose={handleClose}
        onDismiss={handleClose}
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
                  {title && (
                    <Text size="xl" mode="subtle" weight="bold">
                      {title}
                    </Text>
                  )}
                </Box>
                <CloseButton hidden disabled />
              </Box>

              {/* Content */}
              <Box gap="sm" mt="md">
                {children}
              </Box>
            </Box>
          </Animated.View>
        </KeyboardAvoidingView>
      </RNModal>
    </PopupSheetContext.Provider>
  );
};

PopupSheet.Item = PopupSheetItem;
PopupSheet.Section = PopupSheetSection;
PopupSheet.CustomContent = PopupSheetCustomContent;

export default PopupSheet;

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
    backgroundColor: theme.colors.background.darkest,
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
  itemButton: {
    borderRadius: theme.radius.xxl,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  itemContent: {
    minHeight: 48,
    padding: theme.spacing.sm + 4,
    backgroundColor: theme.colors.background.lightest,
  },
  iconContainer: {
    width: 45,
    height: 45,
    marginRight: 12,
  },
  textContent: {},
  description: {
    // marginTop: 2,
    opacity: 0.7,
  },
  rightContent: {
    minWidth: 60,
  },
  sectionTitle: {
    textTransform: "uppercase",
    opacity: 0.6,
    fontSize: 12,
    fontWeight: "600",
  },
}));
