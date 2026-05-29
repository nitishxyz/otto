import { useMemo, useRef } from 'react';
import {
	estimateModelCostUsd,
	type ProviderId,
	getModelInfo,
} from '@ottocode/sdk/browser';
import type { Session } from '../../types/api';
import {
	DollarSign,
	GitBranch,
	ArrowUpRight,
	Share2,
	ExternalLink,
	RefreshCw,
} from 'lucide-react';
import { StopButton } from '../chat/StopButton';
import { useParentSession } from '../../hooks/useBranch';
import { useShareStatus } from '../../hooks/useShareStatus';
import { ProviderLogo } from '../common/ProviderLogo';
import { openUrl } from '../../lib/open-url';
import { UsageRing } from '../common/UsageRing';
import { UsageModal } from '../common/UsageModal';
import { useProviderUsage } from '../../hooks/useProviderUsage';
import { useAllModels } from '../../hooks/useConfig';
import { useOttoRouterBalance } from '../../hooks/useOttoRouterBalance';
import { useUsageStore } from '../../stores/usageStore';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { ToolActivityToggle } from '../workspace/ToolActivityToggle';
import { EditableTitle } from './EditableTitle';

interface LeanHeaderProps {
	session: Session;
	isVisible: boolean;
	isGenerating?: boolean;
	onNavigateToSession?: (sessionId: string) => void;
}

export function LeanHeader({
	session,
	isVisible,
	isGenerating,
	onNavigateToSession,
}: LeanHeaderProps) {
	const { data: parentData } = useParentSession(
		session.sessionType === 'branch' ? session.id : undefined,
	);
	const { data: shareStatus } = useShareStatus(session.id);

	const estimatedCost = useMemo(() => {
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
	]);

	const formatCompactNumber = (num: number) => {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
		return num.toString();
	};

	const contextTokens = session.currentContextTokens || 0;

	const isBranch = session.sessionType === 'branch';
	const parentSession = parentData?.parent;

	// Calculate context usage for color indication
	const contextLimit = useMemo(() => {
		const info = getModelInfo(session.provider as ProviderId, session.model);
		return info?.limit?.context;
	}, [session.provider, session.model]);

	const contextUsagePercent = contextLimit
		? (contextTokens / contextLimit) * 100
		: 0;

	const getContextColorClass = () => {
		if (contextUsagePercent >= 90) return 'text-red-600 dark:text-red-400';
		if (contextUsagePercent >= 70) return 'text-amber-600 dark:text-amber-400';
		return 'text-foreground';
	};

	const { data: allModels } = useAllModels();
	const providerAuthType = allModels?.[session.provider]?.authType;
	const { usage, isOAuthProvider } = useProviderUsage(
		session.provider,
		providerAuthType,
	);
	const isOttoRouter = session.provider === 'ottorouter';
	useOttoRouterBalance(isOttoRouter ? 'ottorouter' : undefined);
	const ottorouterUsage = useUsageStore((s) => s.usage.ottorouter);

	const rootRef = useRef<HTMLDivElement>(null);
	const width = useContainerWidth(rootRef);
	const isCompact = width > 0 && width < 640;

	return (
		<>
			<div
				ref={rootRef}
				className={`absolute top-0 left-0 right-0 h-12 border-b border-border bg-background/40 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 z-10 transition-transform duration-200 ${
					isVisible ? 'translate-y-0' : '-translate-y-full'
				}`}
			>
				<div className="h-full px-2.5 flex items-center justify-between gap-3 text-sm">
					<div className="flex-1 min-w-0 flex items-center gap-1.5 text-muted-foreground">
						{isBranch && (
							<GitBranch className="size-4 flex-shrink-0 text-violet-500" />
						)}
						<EditableTitle
							sessionId={session.id}
							title={session.title}
							className="text-foreground font-medium text-sm"
						/>
						{shareStatus?.shared && (
							<button
								type="button"
								onClick={() => openUrl(shareStatus.url)}
								className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs font-medium flex-shrink-0"
							>
								<Share2 className="h-3 w-3" />
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
						{isBranch && parentSession && (
							<>
								{!isCompact && (
									<span className="text-muted-foreground">from</span>
								)}
								<button
									type="button"
									onClick={() => onNavigateToSession?.(parentSession.id)}
									className="text-primary hover:underline flex items-center gap-0.5 truncate max-w-32"
									title={
										parentSession.title ||
										`Session ${parentSession.id.slice(0, 8)}`
									}
								>
									<span className="truncate">
										{parentSession.title ||
											`Session ${parentSession.id.slice(0, 8)}`}
									</span>
									<ArrowUpRight className="h-3 w-3 flex-shrink-0" />
								</button>
							</>
						)}
					</div>

					<div className="flex-shrink-0 flex items-center gap-3 text-muted-foreground">
						{isGenerating && <StopButton sessionId={session.id} />}
						<ToolActivityToggle compact />

						{isOAuthProvider && usage && (
							<UsageRing usage={usage} provider={session.provider} />
						)}

						{isOttoRouter && ottorouterUsage && (
							<UsageRing usage={ottorouterUsage} provider="ottorouter" />
						)}

						<div className="flex items-center gap-2">
							<div
								className="flex items-center gap-1"
								title={`Current context window: ${contextTokens.toLocaleString()} tokens`}
							>
								<span className="text-xs opacity-70">ctx</span>
								<span className={`font-medium ${getContextColorClass()}`}>
									{formatCompactNumber(contextTokens)}
								</span>
							</div>
						</div>

						{estimatedCost > 0 && !isCompact && (
							<div className="flex items-center gap-1">
								<DollarSign className="size-3.5" />
								<span className="text-foreground font-medium">
									{estimatedCost.toFixed(4)}
								</span>
							</div>
						)}

						<div className="flex items-center gap-1.5">
							<ProviderLogo provider={session.provider} size={14} />
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
