import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Box, Button, Icon } from "@/primitives";
import { StyleProp, ViewStyle } from "react-native";
import { IconProps } from "@expo/vector-icons/build/createIconSet";
import React from "react";

type RoundButtonProps = {
  title: string;
  icon: {
    name: string;
    group: React.ComponentType<IconProps<any>>;
    size?: number;
  };
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  variant?: "primary" | "secondary";
};

export const RoundButton = ({
  title,
  icon,
  onPress,
  style,
  variant = "primary",
}: RoundButtonProps) => {
  const { theme } = useUnistyles();

  return (
    <Button
      style={[styles.actionBtn, style]}
      contentStyle={styles.btnContentStyle}
      rounded="full"
      key={title}
      size="auto"
      variant="ghost"
      onPress={onPress}
      hitSlop={10}
    >
      <Box
        style={styles.buttonBox}
        background={variant === "primary" ? "inverse" : "light"}
        center
        rounded="full"
      >
        <Icon
          icon={icon.group}
          name={icon.name}
          size={icon.size || 22}
          color={
            variant === "primary"
              ? theme.colors.background.base
              : theme.colors.background.inverse
          }
        />
      </Box>

      <Button.Text weight="bold" style={{ fontSize: 11, marginTop: -4 }}>
        {title}
      </Button.Text>
    </Button>
  );
};

const styles = StyleSheet.create((theme) => ({
  actionBtn: {},
  btnContentStyle: {
    flexDirection: "column",
    paddingTop: 4,
  },
  buttonBox: {
    width: 35,
    height: 35,
  },
}));
