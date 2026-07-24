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
				: colors.fgDimmed;

	const rightParts: string[] = [];
	if (projectRoot) {
		rightParts.push(
			`proj ${projectRoot.split('/').filter(Boolean).at(-1) ?? projectRoot}`,
		);
	}
	if (queueSize > 0) rightParts.push(`${queueSize} queued`);
	if (contextTokens > 0) rightParts.push(`ctx ${formatCompact(contextTokens)}`);
	if (estimatedCost > 0) rightParts.push(`$${estimatedCost.toFixed(2)}`);

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
				{rightParts.map((part, i) => {
					const isCtx = part.startsWith('ctx ');
					const isCost = part.startsWith('$');
					const isQueued = part.includes('queued');
					const isProject = part.startsWith('proj ');
					let color = colors.fgDimmed;
					if (isCtx) color = contextColor;
					if (isCost) color = colors.fg;
					if (isQueued) color = colors.yellow;
					if (isProject) color = colors.blue;
					return (
						<box key={part} style={{ flexDirection: 'row', flexShrink: 0 }}>
							{i > 0 ? (
								<text fg={colors.fgDimmed}> │ </text>
							) : (
								<text fg={colors.fgDimmed}> </text>
							)}
							<text fg={color}>{part}</text>
						</box>
					);
				})}
			</box>
		</box>
	);
}
