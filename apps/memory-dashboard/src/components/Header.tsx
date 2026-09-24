import type { ConnectionStatus } from '../lib/activity.ts';
import { describeCounts, type MemoryCounts } from '../lib/memories.ts';
import { timeAgo } from '../lib/text.ts';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
	live: 'Live',
	polling: 'Reconnecting',
	disconnected: 'Offline',
	connecting: 'Connecting',
};

const STATUS_HINT: Record<ConnectionStatus, string> = {
	live: 'Updates appear as soon as Otto remembers or uses something.',
	polling:
		'Live connection dropped. Still checking for updates every few seconds.',
	disconnected: "Can't reach Otto's memory right now. Retrying.",
	connecting: 'Connecting to Otto\u2026',
};

export function Header({
	counts,
	status,
	lastEventAt,
	now,
}: {
	counts: MemoryCounts;
	status: ConnectionStatus;
	lastEventAt: string | null;
	now: number;
}) {
	const last = lastEventAt
		? ` Last activity ${timeAgo(lastEventAt, now)}.`
		: '';
	return (
		<header className="header">
			<span className="header-mark" aria-hidden="true" />
			<div className="header-text">
				<h1 className="header-title">What Otto remembers</h1>
				<div className="header-sub">{describeCounts(counts)}</div>
			</div>
			<div
				className={`conn conn-${status}`}
				title={`${STATUS_HINT[status]}${last}`}
			>
				<span className="conn-dot" />
				<span className="conn-text">{STATUS_TEXT[status]}</span>
			</div>
		</header>
	);
}
