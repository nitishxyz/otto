import { memo } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Session } from '../../types/api';
import { StableSpinner } from '../ui/StableSpinner';
import { formatRelativeSessionTime } from './session-time';
import { InlineChangeCount } from '../workspace/ViewerStatusBar';

interface SessionItemProps {
	session: Session;
	isActive: boolean;
	onClick: () => void;
}

export const SessionItem = memo(function SessionItem({
	session,
	isActive,
	onClick,
}: SessionItemProps) {
	const title = session.title || `Session ${session.id.slice(0, 8)}`;
	const isRunning = session.isRunning ?? false;
	const lastUpdatedAt = session.lastActiveAt ?? session.createdAt;
	const isReadyForReview =
		!isRunning && lastUpdatedAt > (session.lastViewedAt ?? 0);
	const metadata = formatRelativeSessionTime(lastUpdatedAt);
	const fileStats = session.fileStats;
	const hasFileStats = fileStats && fileStats.changedFiles > 0;
	const showStats =
		hasFileStats && (fileStats.additions > 0 || fileStats.deletions > 0);
	const statusIcon = isRunning ? (
		<StableSpinner className="text-sidebar-muted-foreground" title="Running" />
	) : isReadyForReview ? (
		<CircleCheck className="h-4 w-4" />
	) : null;

	return (
		<button
			type="button"
			onClick={onClick}
			className={`group flex w-full items-start gap-2 px-4 py-3 text-left transition-colors duration-150 ${
				isActive
					? 'bg-black/[0.08] text-sidebar-foreground dark:bg-white/[0.08]'
					: 'text-sidebar-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.055]'
			}`}
			title={`${title} — ${metadata}`}
		>
			{statusIcon && (
				<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sidebar-muted-foreground transition-colors group-hover:text-sidebar-foreground/80">
					{statusIcon}
				</span>
			)}
			<span className="block min-w-0 flex-1">
				<span
					className={`block min-w-0 truncate text-[13px] leading-5 ${isActive ? 'font-medium' : 'font-normal'}`}
				>
					{title}
				</span>
				<span className="mt-0.5 flex items-center justify-between gap-3 text-[11px] leading-4 text-sidebar-muted-foreground">
					<span className="min-w-0 flex-1 truncate">
						{showStats ? (
							<InlineChangeCount
								count={{
									additions: fileStats.additions,
									removals: fileStats.deletions,
								}}
								className="text-[11px]"
								weight={isActive || isReadyForReview ? 'bold' : 'normal'}
							/>
						) : (
							session.agent
						)}
					</span>
					{!isRunning && (
						<span className="shrink-0 text-sidebar-muted-foreground">
							{metadata}
						</span>
					)}
				</span>
			</span>
		</button>
	);
});
