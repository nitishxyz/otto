import { memo, useMemo } from 'react';
import { getModelInfo, type ProviderId } from '@ottocode/sdk/browser';

interface ContextUsageIndicatorProps {
	provider: string;
	model: string;
	contextTokens: number;
	compact?: boolean;
	className?: string;
}

function formatCompactNumber(num: number): string {
	if (num >= 1_000_000) {
		const m = num / 1_000_000;
		return `${m >= 100 ? Math.round(m) : m.toFixed(1)}M`;
	}
	if (num >= 1000) {
		const k = num / 1000;
		return `${k >= 100 ? Math.round(k) : k.toFixed(1)}K`;
	}
	return num.toString();
}

function getUsagePercent(used: number, limit: number): number {
	return Math.min(100, (used / limit) * 100);
}

function getTextColorClass(usagePercent: number): string {
	if (usagePercent >= 90) return 'text-red-600 dark:text-red-400';
	if (usagePercent >= 70) return 'text-amber-600 dark:text-amber-400';
	return 'text-foreground';
}

export const ContextUsageIndicator = memo(function ContextUsageIndicator({
	provider,
	model,
	contextTokens,
	compact = false,
	className = '',
}: ContextUsageIndicatorProps) {
	const contextLimit = useMemo(() => {
		const info = getModelInfo(provider as ProviderId, model);
		return info?.limit?.context;
	}, [provider, model]);

	const usagePercent = contextLimit
		? getUsagePercent(contextTokens, contextLimit)
		: null;
	const displayPercent = contextLimit
		? Math.round((contextTokens / contextLimit) * 100)
		: null;
	const remaining =
		contextLimit != null ? Math.max(0, contextLimit - contextTokens) : null;

	const title = useMemo(() => {
		if (contextLimit == null) {
			return `Context: ${contextTokens.toLocaleString()} tokens (model limit unknown)`;
		}
		const pct = Math.round((contextTokens / contextLimit) * 100);
		let label = `Context: ${pct}% · ${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`;
		if (remaining != null && remaining > 0) {
			label += ` — ~${formatCompactNumber(remaining)} remaining`;
		}
		return label;
	}, [contextLimit, contextTokens, remaining]);

	const emphasizePercent =
		compact && displayPercent != null && displayPercent >= 70;
	const colorClass = getTextColorClass(usagePercent ?? 0);

	return (
		<div className={`flex items-center ${className}`.trim()} title={title}>
			<div className="flex items-center gap-1">
				<span className="text-xs opacity-70">ctx</span>
				{emphasizePercent ? (
					<span className={`font-medium tabular-nums ${colorClass}`}>
						{displayPercent}%
					</span>
				) : contextLimit != null && displayPercent != null ? (
					<>
						<span className="font-medium tabular-nums text-foreground">
							{formatCompactNumber(contextTokens)}
						</span>
						<span className="text-xs opacity-50">·</span>
						<span className={`font-medium tabular-nums ${colorClass}`}>
							{displayPercent}%
						</span>
					</>
				) : (
					<span className={`font-medium tabular-nums ${colorClass}`}>
						{formatCompactNumber(contextTokens)}
					</span>
				)}
			</div>
		</div>
	);
});
