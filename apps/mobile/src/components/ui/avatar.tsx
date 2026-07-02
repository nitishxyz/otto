import { Image } from "expo-image";
import type { ImageProps } from "expo-image";
import { Box } from "@/components/ui/primitives/box";
import { StyleSheet } from "react-native-unistyles";
import { useMemo } from "react";

interface AvatarProps extends ImageProps {
  size?: number;
  seed?: string;
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full";
  border?: "none" | "thin" | "thick";
}

export default function Avatar({
  source,
  seed,
  size = 42,
  style,
  rounded = "full",
  border = "thin",
  ...imageProps
}: AvatarProps) {
  const borderRadiusMap = {
    none: 0,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: size / 2,
  };

  const dynamicStyles = {
    imageContainer: {
      width: size,
      height: size,
      borderRadius: borderRadiusMap[rounded],
    },
  };

  const imgSource = useMemo(() => {
    if (source) return source;
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
  }, [source, seed]);

  return (
    <Box
      center
      style={[styles.imageContainer, dynamicStyles.imageContainer]}
    >
      <Image
        style={[styles.image, style]}
        source={imgSource}
        cachePolicy={"memory-disk"}
        contentFit="cover"
        {...imageProps}
      />
    </Box>
  );
}

const styles = StyleSheet.create((theme) => ({
  imageContainer: {
    overflow: "hidden",
  },
  // Scale image slightly larger to crop out any internal padding in source images
  image: {
    width: "115%",
    height: "115%",
  },
}));
