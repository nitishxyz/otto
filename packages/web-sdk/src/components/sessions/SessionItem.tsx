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
		<span className="relative block h-5 w-5 animate-spin text-sidebar-muted-foreground">
			{Array.from({ length: 8 }, (_, index) => {
				const angle = index * 45;
				return (
					<span
						key={angle}
						className="absolute left-1/2 top-1/2 h-[3px] w-[7px] rounded-full bg-current"
						style={{
							opacity: 1 - index * 0.08,
							transform: `rotate(${angle}deg) translateX(7px)`,
							transformOrigin: '0 50%',
						}}
					/>
				);
			})}
		</span>
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
					<span className="truncate">
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
								{!isRunning && <span>· {metadata}</span>}
							</span>
						) : (
							<span>
								{session.agent}
								{!isRunning && ` · ${metadata}`}
							</span>
						)}
					</span>
				</span>
			</span>
		</button>
	);
});
