import { useTerminalDimensions } from '@opentui/react';
import type { ReactNode } from 'react';
import { useTheme } from '../theme.ts';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

const SIZE_WIDTHS: Record<Exclude<ModalSize, 'full'>, number> = {
	sm: 44,
	md: 64,
	lg: 96,
};

interface ModalFrameProps {
	title: string;
	children: ReactNode;
	footer?: ReactNode;
	/** Width preset. Defaults to 'lg'. */
	size?: ModalSize;
	/** Grow to max height (for scrollable lists). Default fits content. */
	fill?: boolean;
	maxHeightRatio?: number;
	padding?: number;
	gap?: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Centered modal panel with a rounded border, embedded title, and a compact
 * footer hint row. Fits its content by default; pass `fill` for scroll lists.
 */
export function ModalFrame({
	title,
	children,
	footer,
	size = 'lg',
	fill = false,
	maxHeightRatio = 0.78,
	padding = 1,
	gap = 1,
}: ModalFrameProps) {
	const { colors } = useTheme();
	const { width: terminalWidth, height: terminalHeight } =
		useTerminalDimensions();
	const safeWidth = terminalWidth || (process.stdout.columns ?? 120);
	const safeHeight = terminalHeight || (process.stdout.rows ?? 40);
	const compact = safeWidth < 70;
	const horizontalMargin = compact ? 1 : 4;
	const availableWidth = Math.max(24, safeWidth - horizontalMargin * 2);
	const presetWidth = size === 'full' ? availableWidth : SIZE_WIDTHS[size];
	const width = clamp(presetWidth, 24, availableWidth);
	const maxHeight = Math.max(
		8,
		Math.floor(safeHeight * (safeHeight < 24 ? 0.9 : maxHeightRatio)),
	);

	return (
		<box
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: safeWidth,
				height: safeHeight,
				zIndex: 3000,
				backgroundColor: colors.bgDark,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<box
				title={` ${title} `}
				style={{
					width,
					maxHeight,
					height: fill ? maxHeight : undefined,
					backgroundColor: colors.bg,
					border: true,
					borderStyle: 'rounded',
					borderColor: colors.border,
					titleColor: colors.fgBright,
					flexDirection: 'column',
					paddingTop: padding,
					paddingBottom: footer ? 0 : padding,
					paddingLeft: padding + 1,
					paddingRight: padding + 1,
					gap,
				}}
			>
				<box
					style={{
						flexDirection: 'column',
						flexGrow: fill ? 1 : 0,
						flexShrink: 1,
						overflow: 'hidden',
					}}
				>
					{children}
				</box>
				{footer && (
					<box
						style={{
							height: 1,
							flexShrink: 0,
							flexDirection: 'row',
							justifyContent: 'flex-end',
						}}
					>
						<text fg={colors.fgDimmed}>{footer}</text>
					</box>
				)}
			</box>
		</box>
	);
}

export function SelectRow({
	active,
	current,
	title,
	description,
	footer,
	gutter,
}: {
	active: boolean;
	current?: boolean;
	title: ReactNode;
	description?: ReactNode;
	footer?: ReactNode;
	gutter?: ReactNode;
}) {
	const { colors } = useTheme();

	return (
		<box
			style={{
				flexDirection: 'row',
				height: 1,
				width: '100%',
				backgroundColor: active ? colors.bgHighlight : undefined,
			}}
		>
			<text fg={active ? colors.blue : colors.bg}>▌</text>
			<box
				style={{
					flexDirection: 'row',
					gap: 1,
					flexGrow: 1,
					flexShrink: 1,
					overflow: 'hidden',
					paddingLeft: 1,
				}}
			>
				{current && <text fg={colors.blue}>●</text>}
				{!current && gutter}
				<text fg={active ? colors.fgBright : current ? colors.blue : colors.fg}>
					{active ? <b>{title}</b> : title}
				</text>
				{description && (
					<text fg={active ? colors.fgMuted : colors.fgDark}>
						{description}
					</text>
				)}
			</box>
			{footer && (
				<box style={{ flexShrink: 0, paddingRight: 1 }}>
					{typeof footer === 'string' ? (
						<text fg={active ? colors.fgMuted : colors.fgDark}>{footer}</text>
					) : (
						footer
					)}
				</box>
			)}
		</box>
	);
}

export function getVisibleWindow(
	total: number,
	selectedIndex: number,
	maxVisible: number,
): { start: number; end: number } {
	if (total <= maxVisible) return { start: 0, end: total };
	const half = Math.floor(maxVisible / 2);
	const start = clamp(selectedIndex - half, 0, total - maxVisible);
	return { start, end: start + maxVisible };
}
