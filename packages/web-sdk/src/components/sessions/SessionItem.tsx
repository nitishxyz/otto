import { memo } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Session } from '../../types/api';
import { formatRelativeSessionTime } from './session-time';

interface SessionItemProps {
	session: Session;
	isActive: boolean;
	onClick: () => void;
}

function RunningSpinner() {
	return (
		<svg
			className="h-[17px] w-[17px] animate-spin text-sidebar-muted-foreground"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
		>
			<title>Running</title>
			<g stroke="currentColor" strokeLinecap="round" strokeWidth="1.8">
				<path d="M8 1.75v2" />
				<path d="M12.42 3.58 11 5" />
				<path d="M14.25 8h-2" />
				<path d="M12.42 12.42 11 11" />
				<path d="M8 14.25v-2" />
				<path d="M3.58 12.42 5 11" />
				<path d="M1.75 8h2" />
				<path d="M3.58 3.58 5 5" />
			</g>
		</svg>
	);
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
		<RunningSpinner />
	) : isReadyForReview ? (
		<CircleCheck className="h-4 w-4" />
	) : null;

	return (
		<button
			type="button"
			onClick={onClick}
			className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${
				isActive
					? 'bg-black/[0.08] text-sidebar-foreground dark:bg-white/[0.08]'
					: 'text-sidebar-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.055]'
			}`}
			title={`${title} — ${metadata}`}
		>
			{statusIcon && (
				<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sidebar-muted-foreground transition-colors group-hover:text-sidebar-foreground/80">
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
							<span className="inline-flex min-w-0 items-center gap-1.5">
								{fileStats.additions > 0 && (
									<span className="text-emerald-500">
										+{fileStats.additions}
									</span>
								)}
								{fileStats.deletions > 0 && (
									<span className="text-rose-500">-{fileStats.deletions}</span>
								)}
							</span>
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
