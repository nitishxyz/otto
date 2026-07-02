export type ToolErrorType =
	| 'validation'
	| 'not_found'
	| 'permission'
	| 'execution'
	| 'timeout'
	| 'unsupported'
	| 'abort';

export type ToolErrorResponse = {
	ok: false;
	error: string;
	errorType?: ToolErrorType;
	details?: {
		parameter?: string;
		value?: unknown;
		constraint?: string;
		suggestion?: string;
		[key: string]: unknown;
	};
	stack?: string;
};

export type ToolSuccessResponse<T = unknown> = {
	ok: true;
} & T;

export type ToolResponse<T = unknown> =
	| ToolSuccessResponse<T>
	| ToolErrorResponse;

export function isToolError(result: unknown): result is ToolErrorResponse {
	if (!result || typeof result !== 'object') return false;
	const obj = result as Record<string, unknown>;
	return obj.ok === false || 'error' in obj || obj.success === false;
}

export function extractToolError(
	result: unknown,
	topLevelError?: string,
): string | undefined {
	if (topLevelError?.trim()) return topLevelError.trim();
	if (!result || typeof result !== 'object') return undefined;

	const obj = result as Record<string, unknown>;
	const keys = ['error', 'stderr', 'message', 'detail', 'details', 'reason'];
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed.length) return trimmed;
		}
	}
	return undefined;
}

export function createToolError(
	error: string,
	errorType?: ToolErrorType,
	details?: ToolErrorResponse['details'],
): ToolErrorResponse {
	return {
		ok: false,
		error,
		errorType,
		details,
	};
}

export function createToolAbortError(operation: string): ToolErrorResponse {
	return createToolError(`${operation} aborted by user`, 'abort', {
		reason: 'aborted',
	});
}
