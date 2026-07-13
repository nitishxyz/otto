import Svg, { Circle, G, Path, SvgProps } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

type AppIconProps = {
  width?: number;
  height?: number;
} & SvgProps;

function AppIcon(props: AppIconProps) {
  const { width = 50, height = 50, ...rest } = props;
  const { theme } = useUnistyles();
  const strokeColor = theme.colors.brand[500];

  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      {...rest}
    >
      <G
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Circle cx={12} cy={12} r={8} />
        <Path d="M12 2v7.5" />
        <Path d="m19 5-5.23 5.23" />
        <Path d="M22 12h-7.5" />
        <Path d="m19 19-5.23-5.23" />
        <Path d="M12 14.5V22" />
        <Path d="M10.23 13.77 5 19" />
        <Path d="M9.5 12H2" />
        <Path d="M10.23 10.23 5 5" />
        <Circle cx={12} cy={12} r={2.5} />
      </G>
    </Svg>
  );
}

export default AppIcon;