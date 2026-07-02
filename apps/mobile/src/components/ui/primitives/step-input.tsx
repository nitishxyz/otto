import {
  TextInput,
  View,
  InputAccessoryView,
  Platform,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { forwardRef, useCallback } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Feather } from "@expo/vector-icons";
import { Text } from "./text";
import { Button } from "./button";
import * as Clipboard from "expo-clipboard";

export type StepInputProps = Omit<TextInputProps, "style"> & {
  /** Label displayed at top left inside the input container */
  label: string;
  /** Whether to show the paste button (default: true) */
  showPaste?: boolean;
  /** Helper text or error message displayed below the input */
  helperText?: string;
  /** Validation state of the input */
  state?: "default" | "error" | "success" | "focused";
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Container style override */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * @deprecated No-op. Sheets now use the native Expo UI bottom sheet, which
   * handles keyboard avoidance natively. Kept for API compatibility.
   */
  bottomSheet?: boolean;
};

export const StepInput = forwardRef<TextInput, StepInputProps>(
  (
    {
      label,
      showPaste = true,
      helperText,
      state = "default",
      disabled = false,
      containerStyle,
      onFocus,
      onBlur,
      onChangeText,
      value,
      bottomSheet = false,
      ...props
    },
    ref
  ) => {
    const { theme } = useUnistyles();

    const placeholderTextColor = theme.colors.text.subtle;

    const handlePaste = useCallback(async () => {
      const text = await Clipboard.getStringAsync();
      if (text && onChangeText) {
        onChangeText(text);
      }
    }, [onChangeText]);

    // Get border color based on state
    const getBorderColor = () => {
      if (disabled) return theme.colors.border.subtle;
      switch (state) {
        case "error":
          return theme.colors.error.base;
        case "success":
          return theme.colors.success.base;
        default:
          return theme.colors.border.default;
      }
    };

    // Get label color based on state
    const getLabelColor = () => {
      if (disabled) return theme.colors.text.subtle;
      switch (state) {
        case "error":
          return theme.colors.error.base;
        case "success":
          return theme.colors.success.base;
        default:
          return theme.colors.text.subtle;
      }
    };

    // Get helper text color
    const getHelperColor = () => {
      switch (state) {
        case "error":
          return theme.colors.error.base;
        case "success":
          return theme.colors.success.base;
        default:
          return theme.colors.text.subtle;
      }
    };

    return (
      <View style={containerStyle}>
        <View
          style={[
            styles.container,
            {
              borderColor: getBorderColor(),
              backgroundColor: disabled
                ? theme.colors.background.subtle
                : theme.colors.background.default,
            },
          ]}
        >
          {/* Label */}
          <Text
            size="xs"
            weight="medium"
            style={[styles.label, { color: getLabelColor() }]}
          >
            {label}
          </Text>

          {/* Input Row */}
          <View style={styles.inputRow}>
            <TextInput
              ref={ref}
              style={[
                styles.input,
                {
                  color: disabled
                    ? theme.colors.text.subtle
                    : theme.colors.text.default,
                  fontFamily: theme.typography.family.mono,
                },
              ]}
              placeholderTextColor={placeholderTextColor}
              editable={!disabled}
              onFocus={onFocus}
              onBlur={onBlur}
              onChangeText={onChangeText}
              value={value}
              inputAccessoryViewID="step-input-no-accessory"
              {...props}
            />
            {showPaste && !value && !disabled && (
              <Button
                size="sm"
                mode="subtle"
                onPress={handlePaste}
                gap="sm"
              >
                <Button.Icon>
                  {(props) => <Feather name="clipboard" {...props} size={14} />}
                </Button.Icon>
                <Button.Text size="xs">paste</Button.Text>
              </Button>
            )}
          </View>
        </View>

        {/* Helper Text */}
        {helperText && (
          <Text
            size="xs"
            style={[styles.helperText, { color: getHelperColor() }]}
          >
            {helperText}
          </Text>
        )}

        {/* Empty InputAccessoryView to hide iOS keyboard toolbar */}
        {Platform.OS === "ios" && (
          <InputAccessoryView nativeID="step-input-no-accessory">
            <View />
          </InputAccessoryView>
        )}
      </View>
    );
  }
);

StepInput.displayName = "StepInput";

const styles = StyleSheet.create((theme) => ({
  container: {
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  label: {
    marginBottom: 2,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 32,
  },
  input: {
    flex: 1,
    fontSize: theme.typography.size.lg,
    fontWeight: "500",
    padding: 0,
    margin: 0,
    minHeight: 28,
  },
  helperText: {
    marginTop: theme.spacing.xs,
    marginLeft: theme.spacing.sm,
  },
}));
