function stringifyUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object') {
		try {
			return JSON.stringify(error);
		} catch {
			return Object.prototype.toString.call(error);
		}
	}
	return String(error);
}

export function createBlockedToolResult(reason: string | undefined): {
	ok: false;
	error: string;
	details: { reason: 'safety_guard' };
} {
	return {
		ok: false,
		error: `Blocked: ${reason}`,
		details: { reason: 'safety_guard' },
	};
}

export function createRejectedToolResult(): {
	ok: false;
	error: string;
	details: { reason: 'user_rejected' };
} {
	return {
		ok: false,
		error: 'Tool execution rejected by user',
		details: { reason: 'user_rejected' },
	};
}

export function createAbortedToolResult(): {
	ok: false;
	error: string;
	details: { reason: 'aborted' };
} {
	return {
		ok: false,
		error: 'Tool execution aborted by user',
		details: { reason: 'aborted' },
	};
}

export function createToolExceptionResult(error: unknown): unknown {
	if (error && typeof error === 'object' && 'ok' in error) return error;
	const errorMessage = stringifyUnknownError(error);
	const errorStack = error instanceof Error ? error.stack : undefined;
	return {
		ok: false,
		error: errorMessage,
		stack: errorStack,
	};
}
