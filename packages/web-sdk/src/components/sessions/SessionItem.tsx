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

	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors duration-150 ${
				isActive
					? 'bg-sidebar-accent text-sidebar-foreground'
					: 'text-sidebar-foreground hover:bg-sidebar-accent/50'
			}`}
			title={`${title} — ${metadata}`}
		>
			<span className="block min-w-0">
				<span className="flex min-w-0 items-center gap-2">
					<span
						className={`block min-w-0 flex-1 truncate text-[13px] leading-5 ${isActive ? 'font-medium' : 'font-normal'}`}
					>
						{title}
					</span>
					{!isRunning && (
						<span className="shrink-0 text-[11px] leading-4 text-sidebar-muted-foreground">
							{metadata}
						</span>
					)}
				</span>
				<span className="mt-0.5 flex items-center justify-between gap-3 text-[11px] leading-4 text-sidebar-muted-foreground">
					<span className="truncate">
						{hasFileStats ? (
							<span className="inline-flex min-w-0 items-center gap-1.5">
								{fileStats.additions > 0 && (
									<span className="text-emerald-500">
										+{fileStats.additions}
									</span>
								)}
								{fileStats.deletions > 0 && (
									<span className="text-rose-500">-{fileStats.deletions}</span>
								)}
								<span>
									{fileStats.additions > 0 || fileStats.deletions > 0
										? '· '
										: ''}
									{fileStats.changedFiles} file
									{fileStats.changedFiles === 1 ? '' : 's'} changed
								</span>
							</span>
						) : (
							session.agent
						)}
					</span>
					<span className="flex h-4 w-4 shrink-0 items-center justify-center text-sidebar-muted-foreground">
						{isRunning ? (
							<RunningSpinner />
						) : isReadyForReview ? (
							<CircleCheck className="h-3.5 w-3.5" />
						) : null}
					</span>
				</span>
			</span>
		</button>
	);
});
