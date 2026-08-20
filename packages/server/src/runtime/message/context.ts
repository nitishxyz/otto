import { createHash } from 'node:crypto';
import { messageParts } from '@ottocode/database/schema';
import { executeReadTool } from '@ottocode/sdk/tools/builtin/fs';
import { APIError } from '../errors/api-error.ts';
import { estimateTokens } from './compaction.ts';
import { registerMessageContextMetrics } from './context-metrics.ts';
import type {
	ContextFileReference,
	DispatchOptions,
	MessageContext,
} from './types.ts';

export const MAX_CONTEXT_FILES = 20;
export const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const CONTEXT_ORIGIN = 'message_context';

export type PreparedContextRead = {
	input: ContextFileReference;
	callId: string;
	startedAt: number;
	completedAt: number;
	result: unknown;
	bytes: number;
	digest?: string;
};

export type PreparedMessageContext = {
	reads: PreparedContextRead[];
	requestedFileCount: number;
	deduplicatedFileCount: number;
	omittedFileCount: number;
	totalBytes: number;
	preloadDurationMs: number;
	completedAt: number;
	estimatedTokens: number;
};

function validateContextFile(input: ContextFileReference, index: number): void {
	if (!input.path.trim()) {
		throw new APIError(`Context file ${index + 1} requires a non-empty path.`, {
			status: 400,
			code: 'invalid_context_file',
		});
	}
	if (input.startLine === undefined) {
		if (input.endLine !== undefined || input.maxLines !== undefined) {
			throw new APIError(
				`Context file ${index + 1} requires startLine when endLine or maxLines is provided.`,
				{ status: 400, code: 'invalid_context_range' },
			);
		}
		return;
	}
	if (input.endLine !== undefined && input.endLine < input.startLine) {
		throw new APIError(
			`Context file ${index + 1} endLine must be greater than or equal to startLine.`,
			{ status: 400, code: 'invalid_context_range' },
		);
	}
}

function contextFileKey(input: ContextFileReference): string {
	return JSON.stringify({
		path: input.path,
		startLine: input.startLine,
		endLine: input.endLine,
		maxLines: input.maxLines,
	});
}

function readDigest(result: unknown): string | undefined {
	if (!result || typeof result !== 'object' || Array.isArray(result)) return;
	const content = (result as Record<string, unknown>).content;
	if (typeof content !== 'string') return;
	return createHash('sha256').update(content).digest('hex');
}

export async function prepareMessageContext(
	projectRoot: string,
	context?: MessageContext,
	options?: { optionalFiles?: ContextFileReference[] },
): Promise<PreparedMessageContext | undefined> {
	const requiredFiles = context?.files ?? [];
	const optionalFiles = (options?.optionalFiles ?? []).slice(
		0,
		Math.max(0, MAX_CONTEXT_FILES - requiredFiles.length),
	);
	const requestedFiles = [...requiredFiles, ...optionalFiles];
	if (requestedFiles.length === 0) return;
	if (requiredFiles.length > MAX_CONTEXT_FILES) {
		throw new APIError(
			`Message context accepts at most ${MAX_CONTEXT_FILES} files.`,
			{ status: 413, code: 'context_file_limit' },
		);
	}
	requestedFiles.forEach(validateContextFile);
	const requiredKeys = new Set(requiredFiles.map(contextFileKey));

	const uniqueFiles = [
		...new Map(
			requestedFiles.map((file) => [contextFileKey(file), file]),
		).values(),
	];
	const preloadStartedAt = Date.now();
	const allReads = await Promise.all(
		uniqueFiles.map(async (input): Promise<PreparedContextRead> => {
			const startedAt = Date.now();
			const result = await executeReadTool(projectRoot, input);
			const completedAt = Date.now();
			return {
				input,
				callId: crypto.randomUUID(),
				startedAt,
				completedAt,
				result,
				bytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
				digest: readDigest(result),
			};
		}),
	);
	const completedAt = Date.now();
	const requiredBytes = allReads.reduce(
		(total, read) =>
			requiredKeys.has(contextFileKey(read.input)) ? total + read.bytes : total,
		0,
	);
	if (requiredBytes > MAX_CONTEXT_BYTES) {
		throw new APIError(
			`Preloaded context is ${requiredBytes} bytes; the limit is ${MAX_CONTEXT_BYTES} bytes. Use line ranges or fewer files.`,
			{
				status: 413,
				code: 'context_size_limit',
				details: { totalBytes: requiredBytes, maxBytes: MAX_CONTEXT_BYTES },
			},
		);
	}
	const reads: PreparedContextRead[] = [];
	let totalBytes = 0;
	for (const read of allReads) {
		const required = requiredKeys.has(contextFileKey(read.input));
		if (!required && totalBytes + read.bytes > MAX_CONTEXT_BYTES) continue;
		reads.push(read);
		totalBytes += read.bytes;
	}

	return {
		reads,
		requestedFileCount: requestedFiles.length,
		deduplicatedFileCount: requestedFiles.length - uniqueFiles.length,
		omittedFileCount: uniqueFiles.length - reads.length,
		totalBytes,
		preloadDurationMs: Math.max(0, completedAt - preloadStartedAt),
		completedAt,
		estimatedTokens: reads.reduce(
			(total, read) => total + estimateTokens(JSON.stringify(read.result)),
			0,
		),
	};
}

export async function injectMessageContext(args: {
	db: DispatchOptions['db'];
	sessionId: string;
	messageId: string;
	agent: string;
	provider: string;
	model: string;
	prepared?: PreparedMessageContext;
}): Promise<number> {
	const prepared = args.prepared;
	if (!prepared || prepared.reads.length === 0) return 0;
	const summary = {
		fileCount: prepared.reads.length,
		requestedFileCount: prepared.requestedFileCount,
		deduplicatedFileCount: prepared.deduplicatedFileCount,
		omittedFileCount: prepared.omittedFileCount,
		totalBytes: prepared.totalBytes,
		preloadDurationMs: prepared.preloadDurationMs,
		completedAt: prepared.completedAt,
	};
	const rows = prepared.reads.flatMap((read, readIndex) => {
		const callIndex = readIndex * 2;
		return [
			{
				id: crypto.randomUUID(),
				messageId: args.messageId,
				index: callIndex,
				type: 'tool_call',
				content: JSON.stringify({
					name: 'read',
					args: read.input,
					callId: read.callId,
					synthetic: true,
					origin: CONTEXT_ORIGIN,
					context: { ...summary, digest: read.digest },
				}),
				agent: args.agent,
				provider: args.provider,
				model: args.model,
				startedAt: read.startedAt,
				toolName: 'read',
				toolCallId: read.callId,
			},
			{
				id: crypto.randomUUID(),
				messageId: args.messageId,
				index: callIndex + 1,
				type: 'tool_result',
				content: JSON.stringify({
					name: 'read',
					args: read.input,
					result: read.result,
					callId: read.callId,
					synthetic: true,
					origin: CONTEXT_ORIGIN,
					context: { ...summary, digest: read.digest },
				}),
				agent: args.agent,
				provider: args.provider,
				model: args.model,
				startedAt: read.startedAt,
				completedAt: read.completedAt,
				toolName: 'read',
				toolCallId: read.callId,
				toolDurationMs: Math.max(0, read.completedAt - read.startedAt),
			},
		];
	});

	await args.db.insert(messageParts).values(rows);
	registerMessageContextMetrics({
		messageId: args.messageId,
		sessionId: args.sessionId,
		completedAt: prepared.completedAt,
		fileCount: prepared.reads.length,
		totalBytes: prepared.totalBytes,
		preloadDurationMs: prepared.preloadDurationMs,
		files: prepared.reads.map((read) => read.input),
	});

	return prepared.estimatedTokens;
}
