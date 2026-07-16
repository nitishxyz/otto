const SSH_GIT_URL_PATTERN = /^[^@\s/:]+@[^\s/:]+:[^\s]+$/;

/** Return whether a Git reference uses a supported HTTP(S) or SSH remote URL. */
export function isSupportedGitReferenceUrl(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed || /\s/.test(trimmed)) return false;
	if (SSH_GIT_URL_PATTERN.test(trimmed)) return true;
	try {
		const url = new URL(trimmed);
		return (
			(url.protocol === 'http:' ||
				url.protocol === 'https:' ||
				url.protocol === 'ssh:') &&
			url.hostname !== ''
		);
	} catch {
		return false;
	}
}
