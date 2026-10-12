import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import { stripToolResultArtifactsForModel } from '../../../tools/adapter/results.ts';
import type { ToolHistoryTracker } from '../tool-history-tracker.ts';
import type { MessagePartRow, ToolResultRecord } from './types.ts';

/** Shown when a tool result was hidden by compaction or pruning. */
export const COMPACTED_TOOL_RESULT_TEXT =
	'[Tool result omitted by context compaction. The call completed; its output is no longer shown. Re-run the tool only if the output is needed again.]';

/** Shown when a tool call has no stored result at all. */
export const MISSING_TOOL_RESULT_TEXT =
	'Error: The tool execution was interrupted or failed to return a result. You may need to retry this operation.';

function collectToolResultsById(parts: MessagePartRow[]): {
	results: Map<string, ToolResultRecord>;
	compactedCallIds: Set<string>;
} {
	const toolResultsById = new Map<string, ToolResultRecord>();
	const compactedCallIds = new Set<string>();
	for (const part of parts) {
		if (part.type !== 'tool_result') continue;

		try {
			const obj = JSON.parse(part.content ?? '{}') as {
				name?: string;
				callId?: string;
				result?: unknown;
			};
			const callId = obj.callId ?? part.toolCallId ?? undefined;
			if (!callId) continue;
			if (part.compactedAt) {
				compactedCallIds.add(callId);
				continue;
			}
			toolResultsById.set(callId, {
				name: obj.name ?? 'tool',
				callId,
				partId: part.id,
				result: obj.result,
			});
		} catch {
			if (part.compactedAt && part.toolCallId) {
				compactedCallIds.add(part.toolCallId);
			}
		}
	}
	return { results: toolResultsById, compactedCallIds };
}

export async function appendAssistantHistoryEntries(args: {
	history: ModelMessage[];
	parts: MessagePartRow[];
	toolHistory: ToolHistoryTracker;
}) {
	const assistantParts: UIMessage['parts'] = [];
	const flushAssistantParts = async () => {
		if (!assistantParts.length) return;
		args.history.push(
			...(await convertToModelMessages([
				{ role: 'assistant', parts: assistantParts },
			])),
		);
		assistantParts.length = 0;
	};
	const { results: toolResultsById, compactedCallIds } = collectToolResultsById(
		args.parts,
	);

	for (const part of args.parts) {
		if (part.type === 'reasoning') continue;

		if (part.type === 'text') {
			appendAssistantTextPart(assistantParts, part);
		} else if (part.type === 'tool_call') {
			await appendAssistantToolCallPart({
				assistantParts,
				part,
				toolResultsById,
				compactedCallIds,
				toolHistory: args.toolHistory,
				flushAssistantParts,
			});
		}
	}

	if (assistantParts.length) {
		await flushAssistantParts();
	}
}

function appendAssistantTextPart(
	assistantParts: UIMessage['parts'],
	part: MessagePartRow,
) {
	try {
		const obj = JSON.parse(part.content ?? '{}');
		const text = String(obj.text ?? '');
		if (text) assistantParts.push({ type: 'text', text });
	} catch {}
}

async function appendAssistantToolCallPart(args: {
	assistantParts: UIMessage['parts'];
	part: MessagePartRow;
	toolResultsById: Map<string, ToolResultRecord>;
	compactedCallIds: Set<string>;
	toolHistory: ToolHistoryTracker;
	flushAssistantParts: () => Promise<void>;
}) {
	if (args.part.compactedAt) return;

	try {
		const obj = JSON.parse(args.part.content ?? '{}') as {
			name?: string;
			callId?: string;
			args?: unknown;
		};
		if (!obj.callId || !obj.name) return;
		if (obj.name === 'finish') return;

		const toolType = `tool-${obj.name}` as `tool-${string}`;
		const result = args.toolResultsById.get(obj.callId);
		let modelResult: unknown;
		if (!result) {
			modelResult = args.compactedCallIds.has(obj.callId)
				? COMPACTED_TOOL_RESULT_TEXT
				: MISSING_TOOL_RESULT_TEXT;
		} else {
			const supersession = args.toolHistory.get(obj.callId);
			modelResult =
				supersession?.kind === 'summary'
					? supersession.summary
					: stripToolResultArtifactsForModel(result.result, {
							toolName: result.name,
							compactedReason:
								supersession?.kind === 'read'
									? supersession.compactedReason
									: undefined,
						});
		}
		const part = {
			type: toolType,
			state: 'output-available',
			toolCallId: obj.callId,
			input: obj.args,
			output: stringifyToolOutput(modelResult),
		};

		args.assistantParts.push(part as never);
		await args.flushAssistantParts();
	} catch {}
}

function stringifyToolOutput(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
