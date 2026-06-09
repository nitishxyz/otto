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

export type ToolResultModelOptions = {
	toolName?: string;
	compactedReason?: string;
};

const SHELL_STDOUT_MODEL_BYTES = 24_000;
const SHELL_STDERR_MODEL_BYTES = 24_000;
const READ_CONTENT_MODEL_BYTES = 48_000;
const SEARCH_MODEL_MATCHES = 80;
const TERMINAL_OUTPUT_MODEL_BYTES = 24_000;

function byteLength(text: string): number {
	return Buffer.byteLength(text, 'utf8');
}

function takeFirstBytes(text: string, bytes: number): string {
	if (byteLength(text) <= bytes) return text;
	return Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8');
}

function takeLastBytes(text: string, bytes: number): string {
	const buffer = Buffer.from(text, 'utf8');
	if (buffer.byteLength <= bytes) return text;
	return buffer.subarray(buffer.byteLength - bytes).toString('utf8');
}

function compactTextForModel(
	text: string,
	maxBytes: number,
	label: string,
): {
	text: string;
	truncated: boolean;
	originalBytes: number;
	shownBytes: number;
} {
	const originalBytes = byteLength(text);
	if (originalBytes <= maxBytes) {
		return { text, truncated: false, originalBytes, shownBytes: originalBytes };
	}

	const marker = `\n… omitted ${originalBytes - maxBytes} bytes from ${label} …\n`;
	const markerBytes = byteLength(marker);
	const contentBudget = Math.max(0, maxBytes - markerBytes);
	const headBytes = Math.floor(contentBudget / 2);
	const tailBytes = contentBudget - headBytes;
	const compacted = `${takeFirstBytes(text, headBytes)}${marker}${takeLastBytes(
		text,
		tailBytes,
	)}`;

	return {
		text: compacted,
		truncated: true,
		originalBytes,
		shownBytes: byteLength(compacted),
	};
}

function compactStringField(
	record: Record<string, unknown>,
	field: string,
	maxBytes: number,
	label: string,
): void {
	const value = record[field];
	if (typeof value !== 'string') return;
	const compacted = compactTextForModel(value, maxBytes, label);
	record[field] = compacted.text;
	if (!compacted.truncated) return;
	record[`${field}Truncated`] = true;
	record[`${field}OriginalBytes`] = compacted.originalBytes;
	record[`${field}ShownBytes`] = compacted.shownBytes;
}

function compactShellResultForModel(
	result: Record<string, unknown>,
): Record<string, unknown> {
	const compacted = { ...result };
	compactStringField(
		compacted,
		'stdout',
		SHELL_STDOUT_MODEL_BYTES,
		'shell stdout',
	);
	compactStringField(
		compacted,
		'stderr',
		SHELL_STDERR_MODEL_BYTES,
		'shell stderr',
	);

	if (compacted.details && typeof compacted.details === 'object') {
		const details = { ...(compacted.details as Record<string, unknown>) };
		compactStringField(
			details,
			'stdout',
			SHELL_STDOUT_MODEL_BYTES,
			'shell stdout',
		);
		compactStringField(
			details,
			'stderr',
			SHELL_STDERR_MODEL_BYTES,
			'shell stderr',
		);
		compacted.details = details;
	}

	return compacted;
}

function compactReadResultForModel(
	result: Record<string, unknown>,
	options: ToolResultModelOptions,
): Record<string, unknown> {
	if (options.compactedReason && result.ok !== false) {
		const compacted: Record<string, unknown> = {
			ok: result.ok ?? true,
			path: result.path,
			size: result.size,
			indentation: result.indentation,
			lineRange: result.lineRange,
			totalLines: result.totalLines,
			compacted: true,
			compactedReason: options.compactedReason,
		};
		for (const key of Object.keys(compacted)) {
			if (compacted[key] === undefined) delete compacted[key];
		}
		return compacted;
	}

	const compacted = { ...result };
	compactStringField(
		compacted,
		'content',
		READ_CONTENT_MODEL_BYTES,
		'read content',
	);
	return compacted;
}

function compactSearchResultForModel(
	result: Record<string, unknown>,
): Record<string, unknown> {
	const matches = Array.isArray(result.matches) ? result.matches : undefined;
	if (!matches) return result;

	const shownMatches = matches.slice(0, SEARCH_MODEL_MATCHES);
	return {
		...result,
		matches: shownMatches,
		...(matches.length > shownMatches.length
			? {
					truncated: true,
					shownMatches: shownMatches.length,
					originalMatches: matches.length,
					note: 'Search result truncated for model history. Narrow path/glob or increase maxResults if needed.',
				}
			: {}),
	};
}

function compactTerminalResultForModel(
	result: Record<string, unknown>,
): Record<string, unknown> {
	const compacted = { ...result };
	if (Array.isArray(compacted.output)) {
		const output = compacted.output.map(String).join('');
		const reduced = compactTextForModel(
			output,
			TERMINAL_OUTPUT_MODEL_BYTES,
			'terminal output',
		);
		if (reduced.truncated) {
			compacted.output = [reduced.text];
			compacted.outputTruncated = true;
			compacted.outputOriginalBytes = reduced.originalBytes;
			compacted.outputShownBytes = reduced.shownBytes;
		}
	}
	compactStringField(
		compacted,
		'text',
		TERMINAL_OUTPUT_MODEL_BYTES,
		'terminal text',
	);
	return compacted;
}

export function stripToolResultArtifactsForModel(
	result: unknown,
	options: ToolResultModelOptions = {},
): unknown {
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		return result;
	}
	const { artifact: _artifact, ...rest } = result as Record<string, unknown>;
	if (rest.operation === 'apply_patch' && 'changes' in rest) {
		const { changes: _changes, ...compact } = rest;
		return compact;
	}

	switch (options.toolName) {
		case 'shell':
			return compactShellResultForModel(rest);
		case 'read':
			return compactReadResultForModel(rest, options);
		case 'search':
			return compactSearchResultForModel(rest);
		case 'terminal':
			return compactTerminalResultForModel(rest);
		default:
			break;
	}

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
