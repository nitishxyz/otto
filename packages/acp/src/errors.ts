export function isConnectionClosedError(err: unknown): boolean {
	if (!err) return false;
	const message = err instanceof Error ? err.message : String(err);
	return message.includes('ACP connection closed');
}
