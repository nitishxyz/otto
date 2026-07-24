import { getBaseUrl } from '../api.ts';

/** Copies text to the system clipboard via the platform utility. */
export async function copyToClipboard(text: string): Promise<void> {
	const cmd =
		process.platform === 'darwin'
			? 'pbcopy'
			: process.platform === 'win32'
				? 'clip'
				: 'xclip -selection clipboard';
	const proc = Bun.spawn(['sh', '-c', cmd], {
		stdin: 'pipe',
	});
	proc.stdin.write(text);
	proc.stdin.end();
	await proc.exited;
}

/**
 * Builds the web UI URL for a session. Falls back to the API base URL with
 * the port bumped by one (the web server convention) when no web URL is set.
 */
export function buildWebSessionUrl(
	webUrl: string | undefined,
	sessionId?: string,
): string {
	const url = new URL(webUrl ?? getBaseUrl());
	if (!webUrl) {
		const apiPort = Number(url.port);
		if (apiPort) url.port = String(apiPort + 1);
	}
	url.pathname = sessionId
		? `/sessions/${encodeURIComponent(sessionId)}`
		: '/sessions';
	url.search = '';
	url.hash = '';
	return url.toString();
}
