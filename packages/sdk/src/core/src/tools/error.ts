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

function hasErrorValue(value: unknown): boolean {
	if (value === undefined || value === null || value === false) return false;
	if (typeof value === 'string') return value.trim().length > 0;
	return true;
}

/**
 * True when a tool result represents a failure. An explicit `ok: true`
 * always wins, so `{ ok: true, error }` (e.g. a reported warning) is success.
 */
export function isToolError(result: unknown): result is ToolErrorResponse {
	if (!result || typeof result !== 'object' || Array.isArray(result))
		return false;
	const obj = result as Record<string, unknown>;
	if (obj.ok === true) return false;
	if (obj.ok === false || obj.success === false) return true;
	return hasErrorValue(obj.error);
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

export type ToolOutcomeStatus =
	| 'success'
	| 'error'
	| 'blocked'
	| 'rejected'
	| 'aborted';

/**
 * Terminal outcome of one tool call. `result` is the value returned to the
 * model and persisted; `status` is the authoritative classification.
 */
export type ToolOutcome =
	| { status: 'success'; result: unknown }
	| { status: 'error'; result: unknown; error: string }
	| { status: 'blocked'; result: unknown; reason: string }
	| { status: 'rejected'; result: unknown }
	| { status: 'aborted'; result: unknown };

/** Execution has finished, but its result is not durable. Never retry the tool mutation. */
export class ToolResultDurabilityError extends Error {
	readonly code = 'TOOL_RESULT_DURABILITY_FAILED';
	constructor(
		readonly toolCallId: string,
		readonly toolName: string,
		readonly outcome: ToolOutcome,
		cause: unknown,
	) {
		super(
			`Could not persist result for ${toolName} (${toolCallId}); execution must not be repeated`,
			{ cause },
		);
		this.name = 'ToolResultDurabilityError';
	}
}

const OUTCOME_REASONS: Record<string, ToolOutcomeStatus> = {
	safety_guard: 'blocked',
	user_rejected: 'rejected',
	aborted: 'aborted',
};

/** Classifies a raw tool result into a typed outcome. */
export function normalizeToolOutcome(result: unknown): ToolOutcome {
	if (!isToolError(result)) return { status: 'success', result };
	const obj = result as Record<string, unknown>;
	const details =
		obj.details && typeof obj.details === 'object'
			? (obj.details as Record<string, unknown>)
			: undefined;
	const reasonStatus =
		typeof details?.reason === 'string'
			? OUTCOME_REASONS[details.reason]
			: undefined;
	const error =
		extractToolError(result) ??
		(typeof obj.error === 'string' ? obj.error : 'Tool execution failed');
	if (reasonStatus === 'blocked') {
		return { status: 'blocked', result, reason: error };
	}
	if (reasonStatus === 'rejected') return { status: 'rejected', result };
	if (reasonStatus === 'aborted' || obj.errorType === 'abort') {
		return { status: 'aborted', result };
	}
	return { status: 'error', result, error };
}

export function isFailedToolOutcome(outcome: ToolOutcome): boolean {
	return outcome.status !== 'success';
}
