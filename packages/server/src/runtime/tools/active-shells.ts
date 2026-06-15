type ActiveShellProcess = {
	sessionId: string;
	messageId: string;
	callId?: string;
	abort: () => void;
};

const activeShells = new Map<string, ActiveShellProcess>();

function keyFor(entry: ActiveShellProcess): string {
	return [
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
): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (entry.sessionId !== sessionId || entry.messageId !== messageId)
			continue;
		count++;
		entry.abort();
	}
	return count;
}

export function abortActiveShellsForSession(sessionId: string): number {
	let count = 0;
	for (const entry of activeShells.values()) {
		if (entry.sessionId !== sessionId) continue;
		count++;
		entry.abort();
	}
	return count;
}
