import { useTheme } from '../theme.ts';

interface StatusBarProps {
	sessionTitle: string | null;
	projectRoot?: string | null;
	queueSize?: number;
	contextTokens?: number;
	estimatedCost?: number;
	contextUsagePercent?: number;
}

function formatCompact(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
	return num.toString();
}

const METER_WIDTH = 5;

/** Renders a compact block meter like ▰▰▱▱▱ for context usage. */
function contextMeter(percent: number): string {
	const filled = Math.min(
		METER_WIDTH,
		Math.max(0, Math.round((percent / 100) * METER_WIDTH)),
	);
	return '▰'.repeat(filled) + '▱'.repeat(METER_WIDTH - filled);
}

export function StatusBar({
	sessionTitle,
	projectRoot,
	queueSize = 0,
	contextTokens = 0,
	estimatedCost = 0,
	contextUsagePercent = 0,
}: StatusBarProps) {
	const { colors } = useTheme();
	const title = sessionTitle || 'new session';

	const contextColor =
		contextUsagePercent >= 90
			? colors.red
			: contextUsagePercent >= 70
				? colors.yellow
				: colors.fgDark;

	const projectName = projectRoot
		? (projectRoot.split('/').filter(Boolean).at(-1) ?? projectRoot)
		: null;

	return (
		<box
			style={{
				width: '100%',
				height: 1,
				flexShrink: 0,
				backgroundColor: colors.bgDark,
				flexDirection: 'row',
				paddingLeft: 1,
				paddingRight: 1,
				overflow: 'hidden',
			}}
		>
			<box style={{ flexShrink: 0, flexDirection: 'row' }}>
				<text fg={colors.blue}>
					<b> otto </b>
				</text>
				<text fg={colors.fgDimmed}>│ </text>
			</box>

			<box style={{ flexShrink: 1, flexGrow: 1, overflow: 'hidden' }}>
				<text
					fg={sessionTitle ? colors.fg : colors.fgDark}
					wrapMode="none"
					truncate
				>
					{title}
				</text>
			</box>

			<box style={{ flexShrink: 0, flexDirection: 'row' }}>
				{projectName && (
					<box style={{ flexDirection: 'row', flexShrink: 0 }}>
						<text fg={colors.fgDimmed}> </text>
						<text fg={colors.blue}>{projectName}</text>
					</box>
				)}
				{queueSize > 0 && (
					<box style={{ flexDirection: 'row', flexShrink: 0 }}>
						<text fg={colors.fgDimmed}> │ </text>
						<text fg={colors.yellow}>{queueSize} queued</text>
					</box>
				)}
				{contextTokens > 0 && (
					<box style={{ flexDirection: 'row', flexShrink: 0 }}>
						<text fg={colors.fgDimmed}> │ </text>
						{contextUsagePercent > 0 && (
							<text fg={contextColor}>
								{contextMeter(contextUsagePercent)}{' '}
							</text>
						)}
						<text fg={contextColor}>
							{contextUsagePercent > 0
								? `${Math.round(contextUsagePercent)}%`
								: `ctx ${formatCompact(contextTokens)}`}
						</text>
					</box>
				)}
				{estimatedCost > 0 && (
					<box style={{ flexDirection: 'row', flexShrink: 0 }}>
						<text fg={colors.fgDimmed}> │ </text>
						<text fg={colors.fg}>${estimatedCost.toFixed(2)}</text>
					</box>
				)}
			</box>
		</box>
	);
}
