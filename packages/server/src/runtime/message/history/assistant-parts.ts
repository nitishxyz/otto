import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import { stripToolResultArtifactsForModel } from '../../../tools/adapter/results.ts';
import type { ToolHistoryTracker } from '../tool-history-tracker.ts';
import { getReadCompactedReason } from './read-compaction.ts';
import type { MessagePartRow, ToolResultRecord } from './types.ts';

function collectToolResultsById(
	parts: MessagePartRow[],
): Map<string, ToolResultRecord> {
	const toolResultsById = new Map<string, ToolResultRecord>();
	for (const part of parts) {
		if (part.type !== 'tool_result' || part.compactedAt) continue;

		try {
			const obj = JSON.parse(part.content ?? '{}') as {
				name?: string;
				callId?: string;
				result?: unknown;
			};
			if (obj.callId) {
				toolResultsById.set(obj.callId, {
					name: obj.name ?? 'tool',
					callId: obj.callId,
					partId: part.id,
					result: obj.result,
				});
			}
		} catch {}
	}
	return toolResultsById;
}

export async function appendAssistantHistoryEntries(args: {
	history: ModelMessage[];
	parts: MessagePartRow[];
	supersededReadPartIds: Set<string>;
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
	const toolResultsById = collectToolResultsById(args.parts);

	for (const part of args.parts) {
		if (part.type === 'reasoning') continue;

		if (part.type === 'text') {
			appendAssistantTextPart(assistantParts, part);
		} else if (part.type === 'tool_call') {
			await appendAssistantToolCallPart({
				assistantParts,
				part,
				toolResultsById,
				supersededReadPartIds: args.supersededReadPartIds,
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
	supersededReadPartIds: Set<string>;
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
		let result = args.toolResultsById.get(obj.callId);

		if (!result) {
			result = {
				name: obj.name,
				callId: obj.callId,
				result:
					'Error: The tool execution was interrupted or failed to return a result. You may need to retry this operation.',
			};
		}

		const compactedReason = getReadCompactedReason({
			name: result.name,
			partId: result.partId,
			supersededReadPartIds: args.supersededReadPartIds,
		});
		const modelResult = stripToolResultArtifactsForModel(result.result, {
			toolName: result.name,
			compactedReason,
		});
		const part = {
			type: toolType,
			state: 'output-available',
			toolCallId: obj.callId,
			input: obj.args,
			output: stringifyToolOutput(modelResult),
		};

		args.toolHistory.register(part, {
			toolName: obj.name,
			callId: obj.callId,
			args: obj.args,
			result: modelResult,
		});

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
