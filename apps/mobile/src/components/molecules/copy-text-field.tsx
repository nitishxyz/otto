import { useSonner } from "@/hooks/use-sonner";
import { Box, Button, Icon } from "@/primitives";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native-unistyles";

export type CopyTextFieldProps = {
  text: string;
  placeholder?: string;
  successMessage?: string;
  errorMessage?: string;
  showFullText?: boolean;
  size?: "sm" | "md" | "lg";
};

export const CopyTextField = ({
  text,
  placeholder = "Text to copy",
  successMessage = "Copied to clipboard",
  errorMessage = "Failed to copy",
  showFullText = false,
  size = "md",
}: CopyTextFieldProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const sonner = useSonner();

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setIsCopied(true);

      sonner.success(successMessage, {
        duration: 2000,
        icon: {
          component: Feather,
          name: "check",
          size: 16,
        },
      });
    } catch (error) {
      sonner.error(errorMessage);
    }
  };

  // Reset copied state after delay
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  return (
    <Box
      background="subtle"
      border="thin"
      mode={isCopied ? "success" : undefined}
      rounded="md"
    >
      <Button
        variant="ghost"
        size={size}
        rounded="md"
        onPress={handleCopy}
        haptics={{ in: "light", out: isCopied ? "success" : "none" }}
        style={{ justifyContent: "flex-start", paddingRight: 8 }}
      >
        <Button.Text
          style={isCopied ? styles.textSuccess : styles.text}
          color={isCopied ? "success" : undefined}
          numberOfLines={showFullText ? undefined : 1}
        >
          {text || placeholder}
        </Button.Text>

        <Button.Icon>
          {(props) => (
            <Icon
              {...props}
              icon={Feather}
              name={isCopied ? "check" : "copy"}
              color={isCopied ? "#22c55e" : props.color}
            />
          )}
        </Button.Icon>
      </Button>
    </Box>
  );
};

const styles = StyleSheet.create((theme) => ({
  text: {
    textAlign: "left",
    marginRight: 8,
    flex: 1,
  },
  textSuccess: {
    textAlign: "left",
    marginRight: 8,
    flex: 1,
    color: theme.colors.success[500] as string,
  },
}));
