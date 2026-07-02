import React, {
  useCallback,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { StyleSheet as UnistyleStyleSheet } from "react-native-unistyles";
import MeasuredBottomSheet, {
  type MeasuredBottomSheetRef,
} from "./measured-bottom-sheet";
import { Box, Text, Button, Icon } from "@/primitives";
import { Feather } from "@expo/vector-icons";

export type ConfirmationAction = {
  label: string;
  onPress?: () => void | Promise<void>;
  style?: "default" | "cancel" | "destructive";
  loading?: boolean;
};

type ConfirmationSheetProps = {
  title: string;
  message?: string;
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: "default" | "warning" | "error" | "success";
  actions?: ConfirmationAction[];
  onDismiss?: () => void;
};

export type ConfirmationSheetRef = {
  present: () => void;
  dismiss: () => void;
};

const iconColors = {
  default: "#9CA3AF",
  warning: "#F59E0B",
  error: "#EF4444",
  success: "#22C55E",
};

const ConfirmationSheet = forwardRef<ConfirmationSheetRef, ConfirmationSheetProps>(
  ({ title, message, icon, iconColor = "default", actions = [], onDismiss }, ref) => {
    const bottomSheetModalRef = useRef<MeasuredBottomSheetRef>(null);

    const present = useCallback(() => {
      bottomSheetModalRef.current?.present();
    }, []);

    const dismiss = useCallback(() => {
      bottomSheetModalRef.current?.dismiss();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        present,
        dismiss,
      }),
      [present, dismiss]
    );

    const [pendingIndex, setPendingIndex] = useState<number | null>(null);

    const handleActionPress = useCallback(
      async (action: ConfirmationAction, index: number) => {
        if (!action.onPress) {
          dismiss();
          return;
        }
        setPendingIndex(index);
        try {
          await action.onPress();
          dismiss();
        } finally {
          setPendingIndex(null);
        }
      },
      [dismiss]
    );

    // Default actions if none provided
    const resolvedActions = actions.length > 0 ? actions : [
      { label: "Cancel", style: "cancel" as const },
      { label: "Confirm", style: "default" as const },
    ];

    // Sort actions: cancel first, then others
    const sortedActions = [...resolvedActions].sort((a, b) => {
      if (a.style === "cancel") return -1;
      if (b.style === "cancel") return 1;
      return 0;
    });

    const getButtonMode = (style?: string) => {
      switch (style) {
        case "destructive":
          return "error";
        case "cancel":
          return "subtle";
        default:
          return undefined;
      }
    };

    const getButtonVariant = (style?: string) => {
      switch (style) {
        case "cancel":
          return "outline";
        default:
          return undefined;
      }
    };

    return (
      <MeasuredBottomSheet
        ref={bottomSheetModalRef}
        onDismiss={onDismiss}
        footer={
          <Box gap="sm" style={styles.footer}>
            {sortedActions.length === 2 ? (
              // Two buttons side by side
              <Box direction="row" gap="sm">
                {sortedActions.map((action, index) => (
                  <Box key={index} flex>
                    <Button
                      size="lg"
                      rounded="full"
                      variant={getButtonVariant(action.style)}
                      mode={getButtonMode(action.style)}
                      onPress={() => handleActionPress(action, index)}
                      loading={action.loading || pendingIndex === index}
                      disabled={pendingIndex !== null}
                      style={styles.rowButton}
                    >
                      <Button.Text weight="semibold" numberOfLines={1}>
                        {action.label}
                      </Button.Text>
                    </Button>
                  </Box>
                ))}
              </Box>
            ) : (
              // Stack buttons vertically
              sortedActions.map((action, index) => (
                <Button
                  key={index}
                  size="lg"
                  rounded="full"
                  variant={getButtonVariant(action.style)}
                  mode={getButtonMode(action.style)}
                  onPress={() => handleActionPress(action, index)}
                  loading={action.loading || pendingIndex === index}
                  disabled={pendingIndex !== null}
                >
                  <Button.Text weight="semibold">{action.label}</Button.Text>
                </Button>
              ))
            )}
          </Box>
        }
      >
        <Box style={styles.content}>
          {/* Icon */}
          {icon && (
            <Box center mb="md">
              <Box
                center
                style={[
                  styles.iconContainer,
                  { backgroundColor: `${iconColors[iconColor]}20` },
                ]}
              >
                <Icon
                  icon={Feather}
                  name={icon}
                  size={28}
                  color={iconColors[iconColor]}
                />
              </Box>
            </Box>
          )}

          {/* Title */}
          <Box center mb="sm">
            <Text size="xl" weight="bold" style={styles.title}>
              {title}
            </Text>
          </Box>

          {/* Message */}
          {message && (
            <Box center mb="lg" px="sm">
              <Text size="md" mode="subtle" style={styles.message}>
                {message}
              </Text>
            </Box>
          )}
        </Box>
      </MeasuredBottomSheet>
    );
  }
);

ConfirmationSheet.displayName = "ConfirmationSheet";

export default ConfirmationSheet;

const styles = UnistyleStyleSheet.create((theme) => ({
  content: {
    paddingTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
  },
  footer: {
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  rowButton: {
    width: "100%",
    paddingHorizontal: theme.spacing.sm,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  title: {
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
  },
}));
