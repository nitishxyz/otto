import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Animated, Easing } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Button } from "@/components/ui/primitives/button";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Icon } from "@/primitives";

interface CopyButtonProps {
  textToCopy: string;
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  onCopy?: () => void;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  textToCopy,
  size = "sm",
  style,
  onCopy,
}) => {
  const [copied, setCopied] = useState(false);
  const rotateAnim = useMemo(() => new Animated.Value(0), []);
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const animateBack = useCallback(() => {
    Animated.timing(rotateAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => setCopied(false));
  }, [rotateAnim]);

  const animateToCopied = useCallback(() => {
    Animated.parallel([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 150,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [rotateAnim, scaleAnim]);

  // Reset copied state after delay
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (copied) {
      timeout = setTimeout(() => {
        animateBack();
      }, 1500);
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [copied, animateBack]);

  const copyToClipboard = async () => {
    try {
      await Clipboard.setStringAsync(textToCopy);
      setCopied(true);
      animateToCopied();
      if (onCopy) onCopy();
    } catch (error) {
      console.error("Failed to copy text: ", error);
    }
  };

  // Interpolate rotation for flip animation
  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <Animated.View
      style={{
        transform: [{ rotateY: spin }, { scale: scaleAnim }],
      }}
    >
      <Button
        variant="ghost"
        size={size}
        style={style}
        onPress={copyToClipboard}
        haptics={{ in: "light", out: copied ? "success" : "none" }}
      >
        <Button.Icon>
          {copied ? (
            <Icon icon={Feather} name="check" size="lg" color="#22c55e" />
          ) : (
            <Icon icon={Feather} name="copy" size="lg" />
          )}
        </Button.Icon>
      </Button>
    </Animated.View>
  );
};
