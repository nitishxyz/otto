import React, {
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { StyleSheet as UnistyleStyleSheet } from "react-native-unistyles";
import MeasuredBottomSheet, {
  type MeasuredBottomSheetRef,
} from "./measured-bottom-sheet";
import { Box } from "./primitives/box";
import { Button } from "./primitives/button";
import { Icon } from "./primitives/icon";
import { Text } from "./primitives";
import { Feather } from "@expo/vector-icons";

type GorhomPopupSheetProps = {
  children?: React.ReactNode;
  title?: string;
  disableCloseButton?: boolean;
  /** Pinned at the bottom of the sheet; never scrolls off screen. */
  footer?: React.ReactNode;
  onDismiss?: () => void;
};

type GorhomPopupSheetItemProps = {
  icon?: any;
  iconName?: string;
  title: string;
  description?: string;
  rightContent?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

type GorhomPopupSheetSectionProps = {
  title?: string;
  children: React.ReactNode;
};

export type GorhomPopupSheetRef = {
  present: () => void;
  dismiss: () => void;
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
          {(props) => <Icon color="muted" icon={Feather} name="x" size={20} />}
        </Button.Icon>
      </Button>
    </Box>
  );
};

// Sheet Item Component
const GorhomPopupSheetItem = ({
  icon,
  iconName,
  title,
  description,
  rightContent,
  onPress,
  disabled,
}: GorhomPopupSheetItemProps) => {
  return (
    <Button
      variant="ghost"
      size="auto"
      onPress={onPress}
      disabled={disabled}
      style={styles.itemButton}
    >
      <Box
        direction="row"
        alignItems="center"
        rounded="lg"
        style={styles.itemContent}
      >
        {icon && iconName && (
          <Box
            rounded="full"
            style={styles.iconContainer}
            center
            background="dim"
          >
            <Icon icon={icon} name={iconName} size={18} />
          </Box>
        )}

        <Box flex>
          <Button.Text size="md" weight="semibold">
            {title}
          </Button.Text>
          {description && (
            <Text size="sm" style={styles.description}>
              {description}
            </Text>
          )}
        </Box>

        {rightContent && (
          <Box alignItems="flex-end">
            {rightContent}
          </Box>
        )}
      </Box>
    </Button>
  );
};

// Sheet Section Component
const GorhomPopupSheetSection = ({
  title,
  children,
}: GorhomPopupSheetSectionProps) => {
  return (
    <Box gap="sm">
      {title && (
        <Box pl="md" pt="sm">
          <Text size="xs" style={styles.sectionTitle}>
            {title}
          </Text>
        </Box>
      )}
      <Box gap="sm">{children}</Box>
    </Box>
  );
};

// Main Sheet Component
const GorhomPopupSheet = forwardRef<GorhomPopupSheetRef, GorhomPopupSheetProps>(
  ({ children, title, footer, onDismiss }, ref) => {
    const bottomSheetModalRef = useRef<MeasuredBottomSheetRef>(null);

    // Present modal
    const present = useCallback(() => {
      bottomSheetModalRef.current?.present();
    }, []);

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

    return (
      <MeasuredBottomSheet
        ref={bottomSheetModalRef}
        onDismiss={onDismiss}
        header={
          <Box style={styles.headerContainer}>
            <Box direction="row" alignItems="center" style={styles.header}>
              <Box center flex>
                {title && (
                  <Text size="lg" mode="subtle" weight="bold">
                    {title}
                  </Text>
                )}
              </Box>
            </Box>
            <CloseButton hidden disabled />
          </Box>
        }
        footer={
          footer ? <Box style={styles.footer}>{footer}</Box> : undefined
        }
      >
        <Box style={styles.content}>
          {children}
        </Box>
      </MeasuredBottomSheet>
    );
  }
);

GorhomPopupSheet.displayName = "GorhomPopupSheet";

// Compound Component Pattern
const GorhomPopupSheetWithComponents = Object.assign(GorhomPopupSheet, {
  Item: GorhomPopupSheetItem,
  Section: GorhomPopupSheetSection,
});

export default GorhomPopupSheetWithComponents;

const styles = UnistyleStyleSheet.create((theme, rt) => ({
  headerContainer: {
    paddingTop: theme.spacing.md,
  },
  content: {
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  footer: {
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  header: {
    minHeight: 28,
    paddingHorizontal: theme.spacing.lg,
  },
  closeButtonContainer: {
    position: "absolute",
    top: theme.spacing.sm,
    right: theme.spacing.sm,
    zIndex: 1000,
  },
  closeButton: {
    height: 32,
    width: 32,
  },
  itemButton: {
    borderRadius: theme.radius.lg,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  itemContent: {
    minHeight: 52,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    marginRight: 12,
  },
  description: {
    opacity: 0.7,
  },
  sectionTitle: {
    textTransform: "uppercase",
    opacity: 0.6,
    fontSize: 12,
    fontWeight: "600",
  },
}));
