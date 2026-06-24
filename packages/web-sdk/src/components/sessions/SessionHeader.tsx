import { useMemo, useRef } from 'react';
import { estimateModelCostUsd, type ProviderId } from '@ottocode/sdk/browser';
import type { Session } from '../../types/api';
import {
	Clock,
	DollarSign,
	GitBranch,
	ArrowUpRight,
	Share2,
	ExternalLink,
	RefreshCw,
} from 'lucide-react';
import { useParentSession } from '../../hooks/useBranch';
import { usePreferences } from '../../hooks/usePreferences';
import { useShareStatus } from '../../hooks/useShareStatus';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { ProviderLogo } from '../common/ProviderLogo';
import { openUrl } from '../../lib/open-url';
import { ToolActivityToggle } from '../workspace/ToolActivityToggle';
import { StopButton } from '../chat/StopButton';
import { EditableTitle } from './EditableTitle';
import { UsageRing } from '../common/UsageRing';
import { ContextUsageIndicator } from '../common/ContextUsageIndicator';
import { UsageModal } from '../common/UsageModal';

interface SessionHeaderProps {
	session: Session;
	isGenerating?: boolean;
	onNavigateToSession?: (sessionId: string) => void;
}

export function SessionHeader({
	session,
	isGenerating,
	onNavigateToSession,
}: SessionHeaderProps) {
	const { data: parentData } = useParentSession(
		session.sessionType === 'branch' ? session.id : undefined,
	);
	const { preferences } = usePreferences();
	const { data: shareStatus } = useShareStatus(session.id);
	const rootRef = useRef<HTMLDivElement>(null);
	const width = useContainerWidth(rootRef);
	const isCompact = width > 0 && width < 640;

	const estimatedCost = useMemo(() => {
		if (typeof session.totalCostUsd === 'number') return session.totalCostUsd;
		const inputTokens = session.totalInputTokens || 0;
		const outputTokens = session.totalOutputTokens || 0;
		const cachedInputTokens = session.totalCachedTokens || 0;
		const cacheCreationInputTokens = session.totalCacheCreationTokens || 0;
		return (
			estimateModelCostUsd(session.provider as ProviderId, session.model, {
				inputTokens,
				outputTokens,
				cachedInputTokens,
				cacheCreationInputTokens,
			}) ?? 0
		);
	}, [
		session.provider,
		session.model,
		session.totalInputTokens,
		session.totalOutputTokens,
		session.totalCachedTokens,
		session.totalCacheCreationTokens,
		session.totalCostUsd,
	]);
	const subagentCost = session.subagentCostUsd ?? 0;

	const formatDuration = (ms: number | null) => {
		if (!ms) return '0s';
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	};

	const formatNumber = (num: number) => num.toLocaleString('en-US');

	const formatCompactNumber = (num: number) => {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
		return num.toString();
	};

	const outputTokens = session.totalOutputTokens || 0;

	const isBranch = session.sessionType === 'branch';
	const parentSession = parentData?.parent;

	const headerWidthClass = preferences.fullWidthContent
		? 'w-full px-6 py-6'
		: 'max-w-3xl mx-auto px-6 py-6';

	return (
		<>
			<div
				ref={rootRef}
				className="border-b border-border bg-background/95 backdrop-blur-sm"
			>
				<div className={headerWidthClass}>
					{isBranch && (
						<div className="flex items-center gap-2 mb-3 text-sm">
							<GitBranch className="h-4 w-4 text-violet-500" />
							<span className="text-violet-600 dark:text-violet-400 font-medium">
								Branch
							</span>
							{parentSession && (
								<>
									<span className="text-muted-foreground">from</span>
									<button
										type="button"
										onClick={() => onNavigateToSession?.(parentSession.id)}
										className="text-primary hover:underline flex items-center gap-1"
									>
										{parentSession.title ||
											`Session ${parentSession.id.slice(0, 8)}`}
										<ArrowUpRight className="h-3 w-3" />
									</button>
								</>
							)}
							{!parentSession && session.parentSessionId && (
								<span className="text-muted-foreground italic text-xs">
									(parent deleted)
								</span>
							)}
						</div>
					)}

					<div className="flex items-center gap-3">
						<EditableTitle
							sessionId={session.id}
							title={session.title}
							className="text-2xl font-semibold text-foreground leading-tight"
						/>

						{shareStatus?.shared && (
							<button
								type="button"
								onClick={() => openUrl(shareStatus.url)}
								className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs font-medium flex-shrink-0"
							>
								<Share2 className="h-3 w-3" />
								<span>Shared</span>
								{shareStatus.pendingMessages &&
								shareStatus.pendingMessages > 0 ? (
									<span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
										<RefreshCw className="h-2.5 w-2.5" />
										{shareStatus.pendingMessages}
									</span>
								) : (
									<ExternalLink className="h-2.5 w-2.5 opacity-60" />
								)}
							</button>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-foreground">
						<div className="flex items-center gap-3">
							<ContextUsageIndicator
								provider={session.provider}
								model={session.model}
								contextTokens={session.currentContextTokens || 0}
								compact={isCompact}
							/>
							{!isCompact && (
								<div
									className="flex items-center gap-1.5"
									title={`Total output: ${formatNumber(outputTokens)} tokens`}
								>
									<span className="text-xs opacity-70">out</span>
									<span className="font-medium text-foreground">
										{formatCompactNumber(outputTokens)}
									</span>
								</div>
							)}
						</div>

						{!isCompact && (
							<div className="flex items-center gap-2">
								<Clock className="w-4 h-4" />
								<span className="font-medium text-foreground">
									{formatDuration(session.totalToolTimeMs)}
								</span>
							</div>
						)}

						{estimatedCost > 0 && !isCompact && (
							<div
								className="flex items-center gap-1.5"
								title={
									subagentCost > 0
										? `Total cost includes $${subagentCost.toFixed(4)} from sub-agents`
										: 'Estimated session cost'
								}
							>
								<DollarSign className="w-4 h-4" />
								<span className="font-medium text-foreground">
									{estimatedCost.toFixed(4)}
								</span>
							</div>
						)}

						<div className="flex items-center gap-2 ml-auto">
							{isGenerating && <StopButton sessionId={session.id} />}
							<ToolActivityToggle compact={isCompact} />
							<UsageRing provider={session.provider} />
							<ProviderLogo provider={session.provider} size={18} />
							{!isCompact && (
								<span className="font-medium text-foreground">
									{session.model}
								</span>
							)}
						</div>
					</div>
				</div>
			</div>
			<UsageModal />
		</>
	);
}
