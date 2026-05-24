import type { ToolResultContent } from './events.ts';

export type ToolFailureState = {
	active: boolean;
	toolName?: string;
};

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

export function createToolExceptionResult(error: unknown): unknown {
	if (error && typeof error === 'object' && 'ok' in error) return error;
	const errorMessage = error instanceof Error ? error.message : String(error);
	const errorStack = error instanceof Error ? error.stack : undefined;
	return {
		ok: false,
		error: errorMessage,
		stack: errorStack,
	};
}

export function stripToolResultArtifactsForModel(result: unknown): unknown {
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		return result;
	}
	if (!('artifact' in result)) return result;
	const { artifact: _artifact, ...rest } = result as Record<string, unknown>;
	return rest;
}

export function buildToolResultContent(args: {
	name: string;
	result: unknown;
	callId?: string;
	input?: unknown;
}): ToolResultContent {
	const content: ToolResultContent = {
		name: args.name,
		result: args.result,
		callId: args.callId,
	};

	if (args.input !== undefined) {
		content.args = args.input;
	}

	if (
		args.result &&
		typeof args.result === 'object' &&
		'artifact' in args.result
	) {
		try {
			const maybeArtifact = (args.result as { artifact?: unknown }).artifact;
			if (maybeArtifact !== undefined) {
				content.artifact = maybeArtifact;
			}
		} catch {}
	}

	return content;
}

export function markToolFailed(
	stepState: { failed: boolean; failedToolName?: string },
	failureState: ToolFailureState,
	name: string,
): void {
	stepState.failed = true;
	stepState.failedToolName = name;
	failureState.active = true;
	failureState.toolName = name;
}

export function markToolSucceeded(
	stepState: { failed: boolean; failedToolName?: string },
	failureState: ToolFailureState,
	name: string,
): void {
	stepState.failed = false;
	stepState.failedToolName = undefined;
	if (failureState.active && failureState.toolName === name) {
		failureState.active = false;
		failureState.toolName = undefined;
	}
}
