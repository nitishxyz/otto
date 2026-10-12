import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import { byteLength, compactText } from './byte-budget.ts';

export type ToolResultModelOptions = {
	toolName?: string;
	compactedReason?: string;
};

const SHELL_STDOUT_MODEL_BYTES = 24_000;
const SHELL_STDERR_MODEL_BYTES = 24_000;
const READ_CONTENT_MODEL_BYTES = 48_000;
const SEARCH_MODEL_MATCHES = 80;
const TERMINAL_OUTPUT_MODEL_BYTES = 24_000;
/** Upper bound for any single tool result rendered for the model. */
export const MODEL_OUTPUT_MAX_BYTES = 100_000;

const compactTextForModel = compactText;

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
	if (Array.isArray(compacted.rawOutput)) {
		const rawOutput = compacted.rawOutput.map(String).join('');
		const reduced = compactTextForModel(
			rawOutput,
			TERMINAL_OUTPUT_MODEL_BYTES,
			'terminal raw output',
		);
		if (reduced.truncated) {
			compacted.rawOutput = [reduced.text];
			compacted.rawOutputTruncated = true;
			compacted.rawOutputOriginalBytes = reduced.originalBytes;
			compacted.rawOutputShownBytes = reduced.shownBytes;
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

function isInlineImageRecord(record: Record<string, unknown>): boolean {
	const mediaType = record.mediaType;
	const type = record.type;
	const kind = record.kind;
	return (
		(typeof mediaType === 'string' && mediaType.startsWith('image/')) ||
		type === 'image' ||
		type === 'image-data' ||
		(typeof kind === 'string' && kind.endsWith('_screenshot'))
	);
}

function stripInlineImageData(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripInlineImageData);
	if (!value || typeof value !== 'object') return value;

	const record = value as Record<string, unknown>;
	const stripped: Record<string, unknown> = {};
	const omitData =
		typeof record.data === 'string' && isInlineImageRecord(record);
	for (const [key, fieldValue] of Object.entries(record)) {
		if (omitData && key === 'data') continue;
		stripped[key] = stripInlineImageData(fieldValue);
	}
	if (omitData) stripped.dataOmitted = true;
	return stripped;
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
		return stripInlineImageData(compact);
	}

	let compacted: Record<string, unknown>;
	switch (options.toolName) {
		case 'shell':
			compacted = compactShellResultForModel(rest);
			break;
		case 'read':
			compacted = compactReadResultForModel(rest, options);
			break;
		case 'search':
			compacted = compactSearchResultForModel(rest);
			break;
		case 'terminal':
			compacted = compactTerminalResultForModel(rest);
			break;
		default:
			compacted = rest;
			break;
	}

	return stripInlineImageData(compacted);
}

function boundText(text: string): string {
	return compactTextForModel(text, MODEL_OUTPUT_MAX_BYTES, 'tool result').text;
}

/**
 * Applies the shared byte budget to a rendered model output, including
 * outputs produced by custom `toModelOutput` callbacks. Image parts are
 * kept; text and JSON beyond the budget are compacted.
 */
export function boundModelOutput(output: ToolResultOutput): ToolResultOutput {
	switch (output.type) {
		case 'text':
		case 'error-text':
			return { ...output, value: boundText(output.value) };
		case 'json':
		case 'error-json': {
			let serialized: string;
			try {
				serialized = JSON.stringify(output.value) ?? 'null';
			} catch {
				return output;
			}
			if (byteLength(serialized) <= MODEL_OUTPUT_MAX_BYTES) return output;
			return {
				type: output.type === 'json' ? 'text' : 'error-text',
				value: boundText(serialized),
			};
		}
		case 'content':
			return {
				...output,
				value: output.value.map((part) =>
					part.type === 'text' ? { ...part, text: boundText(part.text) } : part,
				),
			};
		default:
			return output;
	}
}
