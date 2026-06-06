import { memo } from 'react';
import { CircleCheck, Pin } from 'lucide-react';
import type { Session } from '../../types/api';
import { StableSpinner } from '../ui/StableSpinner';
import { formatRelativeSessionTime } from './session-time';
import { InlineChangeCount } from '../workspace/ViewerStatusBar';

interface SessionItemProps {
	session: Session;
	isActive: boolean;
	onClick: () => void;
	onTogglePinned: () => void;
}

export const SessionItem = memo(function SessionItem({
	session,
	isActive,
	onClick,
	onTogglePinned,
}: SessionItemProps) {
	const title = session.title || `Session ${session.id.slice(0, 8)}`;
	const isRunning = session.isRunning ?? false;
	const isPinned = session.pinnedAt != null;
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
		<div
			className={`group relative flex w-full items-start gap-2 px-4 py-3 text-left transition-colors duration-150 ${
				isActive
					? 'bg-black/[0.08] text-sidebar-foreground dark:bg-white/[0.08]'
					: 'text-sidebar-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.055]'
			}`}
			title={`${title} — ${metadata}`}
		>
			<button
				type="button"
				onClick={onClick}
				className="absolute inset-0 z-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring/50"
				aria-label={`Open ${title}`}
			/>
			{statusIcon && (
				<span className="pointer-events-none relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sidebar-muted-foreground transition-colors group-hover:text-sidebar-foreground/80">
					{statusIcon}
				</span>
			)}
			<span className="pointer-events-none relative z-10 block min-w-0 flex-1">
				<span className="flex min-w-0 items-center">
					<span
						className={`block min-w-0 flex-1 truncate text-left text-[13px] leading-5 ${isActive ? 'font-medium' : 'font-normal'}`}
					>
						{title}
					</span>
					<button
						type="button"
						onClick={onTogglePinned}
						className={`pointer-events-auto relative z-20 flex h-5 shrink-0 items-center justify-center overflow-hidden rounded text-sidebar-muted-foreground transition-all duration-150 ease-out hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/50 ${
							isPinned
								? 'ml-1 w-5 translate-x-0 opacity-100 text-sidebar-foreground'
								: 'ml-0 w-0 translate-x-1 opacity-0 group-hover:ml-1 group-hover:w-5 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-5 group-focus-within:translate-x-0 group-focus-within:opacity-100'
						}`}
						aria-label={isPinned ? 'Unpin session' : 'Pin session'}
						title={isPinned ? 'Unpin session' : 'Pin session'}
					>
						<Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
					</button>
				</span>
				<span className="mt-0.5 flex w-full items-center justify-between gap-3 text-left text-[11px] leading-4 text-sidebar-muted-foreground">
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
		</div>
	);
});
