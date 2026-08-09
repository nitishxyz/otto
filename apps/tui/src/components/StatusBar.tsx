import { useTheme } from '../theme.ts';

interface StatusBarProps {
	sessionTitle: string | null;
	projectRoot?: string | null;
	contextTokens?: number;
	estimatedCost?: number;
	contextUsagePercent?: number;
}

function formatCompact(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
	return num.toString();
}

export function formatContextUsage(
	contextTokens: number,
	contextUsagePercent: number,
): string {
	const tokens = `ctx ${formatCompact(contextTokens)}`;
	return contextUsagePercent > 0
		? `${tokens} · ${Math.round(contextUsagePercent)}%`
		: tokens;
}

export function StatusBar({
	sessionTitle,
	projectRoot,
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
				{contextTokens > 0 && (
					<box style={{ flexDirection: 'row', flexShrink: 0 }}>
						<text fg={colors.fgDimmed}> │ </text>
						<text fg={contextColor}>
							{formatContextUsage(contextTokens, contextUsagePercent)}
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
