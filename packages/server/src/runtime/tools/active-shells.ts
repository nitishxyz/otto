type ActiveShellProcess = {
	projectRoot?: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	abort: () => void;
};

const activeShells = new Map<string, ActiveShellProcess>();

function keyFor(entry: ActiveShellProcess): string {
	return [
		entry.projectRoot ?? 'legacy',
		entry.sessionId,
		entry.messageId,
		entry.callId ?? crypto.randomUUID(),
	].join(':');
}

export function registerActiveShellProcess(
	entry: ActiveShellProcess,
): () => void {
	const key = keyFor(entry);
	activeShells.set(key, entry);
	return () => {
		activeShells.delete(key);
	};
}

export function abortActiveShellsForMessage(
	sessionId: string,
	messageId: string,
	projectRoot?: string,
): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (
			entry.sessionId !== sessionId ||
			entry.messageId !== messageId ||
			entry.projectRoot !== projectRoot
		)
			continue;
		count++;
		entry.abort();
	}
	return count;
}

export function abortActiveShellsForSession(
	sessionId: string,
	projectRoot?: string,
): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (entry.sessionId !== sessionId || entry.projectRoot !== projectRoot)
			continue;
		count++;
		entry.abort();
	}
	return count;
}
