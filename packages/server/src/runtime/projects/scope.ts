export function projectScopeKey(projectKey: string | undefined | null): string {
	return projectKey || 'legacy';
}

export function scopedSessionKey(
	projectKey: string | undefined | null,
	sessionId: string,
): string {
	return `${projectScopeKey(projectKey)}:${sessionId}`;
}

export function scopedMessageKey(
	projectKey: string | undefined | null,
	messageId: string,
): string {
	return `${projectScopeKey(projectKey)}:${messageId}`;
}

export function scopedCallKey(
	projectKey: string | undefined | null,
	callId: string,
): string {
	return `${projectScopeKey(projectKey)}:${callId}`;
}
