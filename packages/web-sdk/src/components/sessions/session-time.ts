const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_IN_MS = 60 * 60 * 1000;

/**
 * Formats a timestamp into a compact relative label for session metadata.
 */
export function formatRelativeSessionTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minutes = Math.floor(diff / 60000);

	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;

	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;

	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;

	const years = Math.floor(days / 365);
	return `${years}y ago`;
}

/**
 * Returns a date bucket label for grouping recent sessions in the sidebar.
 */
export function getSessionGroupLabel(timestamp: number): string {
	const now = new Date();
	const diff = now.getTime() - timestamp;
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfYesterday = startOfToday - DAY_IN_MS;
	const startOfLastWeek = startOfToday - DAY_IN_MS * 7;

	if (diff <= RECENT_WINDOW_IN_MS) return 'Recent';
	if (timestamp >= startOfToday) return 'Earlier Today';
	if (timestamp >= startOfYesterday) return 'Yesterday';
	if (timestamp >= startOfLastWeek) return 'Earlier';
	return 'Older';
}
