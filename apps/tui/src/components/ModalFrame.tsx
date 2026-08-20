import { RGBA } from '@opentui/core';
import { useMemo, type ReactNode } from 'react';
import { useTheme } from '../theme.ts';
import { getListModalWindow } from '../lib/list-navigation.ts';
import { useTerminalDimensions } from '../terminal-dimensions.tsx';

export { getVisibleWindow } from '../lib/list-navigation.ts';

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
	maxHeightRatio?: number;
	padding?: number;
	gap?: number;
}

/** Shared terminal-aware window for naturally sized selectable list modals. */
export function useListModalWindow(
	total: number,
	selectedIndex: number,
	reservedRows = 0,
) {
	const { height } = useTerminalDimensions();
	return getListModalWindow(
		total,
		selectedIndex,
		height || (process.stdout.rows ?? 40),
		reservedRows,
	);
}

/** Reserves the exact physical height of a windowed modal list body. */
export function ModalListViewport({
	rowCount,
	children,
}: {
	rowCount: number;
	children: ReactNode;
}) {
	return (
		<box
			style={{
				width: '100%',
				height: Math.max(1, rowCount),
				flexDirection: 'column',
				flexShrink: 0,
				overflow: 'hidden',
			}}
		>
			{children}
		</box>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Centered modal panel with a fixed title and compact footer hint row. */
export function ModalFrame({
	title,
	children,
	footer,
	size = 'lg',
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
	const backdropColor = useMemo(() => {
		const color = RGBA.fromHex(colors.bgDark);
		color.a = 0.72;
		return color;
	}, [colors.bgDark]);

	return (
		<box
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: safeWidth,
				height: safeHeight,
				zIndex: 3000,
				backgroundColor: backdropColor,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<box
				style={{
					width,
					maxHeight,
					backgroundColor: colors.bg,
					flexDirection: 'column',
					paddingTop: padding,
					paddingBottom: padding,
					paddingLeft: padding + 1,
					paddingRight: padding + 1,
					gap,
				}}
			>
				<text fg={colors.fgBright}>
					<b>{title}</b>
				</text>
				<box
					style={{
						flexDirection: 'column',
						flexGrow: 0,
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
				{gutter}
				<text
					style={{
						flexShrink: 1,
						overflow: 'hidden',
					}}
					fg={active ? colors.fgBright : current ? colors.blue : colors.fg}
					wrapMode="none"
					truncate
				>
					{active ? <b>{title}</b> : title}
				</text>
				{current && (
					<text fg={active ? colors.fgMuted : colors.blue}>(current)</text>
				)}
				{description && (
					<text
						style={{ flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}
						fg={active ? colors.fgMuted : colors.fgDark}
						wrapMode="none"
						truncate
					>
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
