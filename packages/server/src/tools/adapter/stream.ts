import { createToolError } from '@ottocode/sdk/tools/error';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { publishToolDelta } from './events.ts';

function getStringDelta(chunk: unknown): string | null {
	if (typeof chunk === 'string') return chunk;
	if (
		chunk &&
		typeof chunk === 'object' &&
		'delta' in chunk &&
		typeof (chunk as { delta?: unknown }).delta === 'string'
	) {
		return (chunk as { delta: string }).delta ?? '';
	}
	return null;
}

function getStringChannel(chunk: unknown): string {
	if (
		chunk &&
		typeof chunk === 'object' &&
		'channel' in chunk &&
		typeof (chunk as { channel?: unknown }).channel === 'string'
	) {
		return (chunk as { channel: string }).channel ?? 'output';
	}
	return 'output';
}

export function getTerminalId(chunk: unknown): string | null {
	if (
		chunk &&
		typeof chunk === 'object' &&
		'terminalId' in chunk &&
		typeof (chunk as { terminalId?: unknown }).terminalId === 'string'
	) {
		return (chunk as { terminalId: string }).terminalId;
	}
	return null;
}

function isTerminalChunk(chunk: unknown): chunk is { result: unknown } {
	return Boolean(chunk && typeof chunk === 'object' && 'result' in chunk);
}

/**
 * Drains a streaming tool. The first `{ result }` chunk is the single
 * terminal outcome; deltas are published as they arrive. A stream that
 * ends without a terminal chunk is a failure, never an implicit success.
 */
export async function consumeToolStream(
	ctx: ToolAdapterContext,
	args: {
		stream: AsyncIterable<unknown>;
		name: string;
		stepIndex?: number;
		callId?: string;
		suppressDeltas?: boolean;
	},
): Promise<unknown> {
	let terminal: { result: unknown } | undefined;

	for await (const chunk of args.stream) {
		if (isTerminalChunk(chunk)) {
			if (terminal) {
				return createToolError(
					'Tool stream emitted multiple results',
					'execution',
					{
						reason: 'multiple_terminal_results',
					},
				);
			} else {
				terminal = { result: chunk.result };
			}
			continue;
		}
		if (terminal || args.suppressDeltas) continue;

		const terminalId = getTerminalId(chunk);
		if (terminalId) {
			publishToolDelta(ctx, {
				name: args.name,
				channel: 'terminal',
				delta: terminalId,
				stepIndex: args.stepIndex,
				callId: args.callId,
			});
			continue;
		}

		const delta = getStringDelta(chunk);
		if (!delta) continue;

		publishToolDelta(ctx, {
			name: args.name,
			channel: getStringChannel(chunk),
			delta,
			stepIndex: args.stepIndex,
			callId: args.callId,
		});
	}

	if (!terminal) {
		return createToolError('Tool stream ended without a result', 'execution', {
			reason: 'missing_terminal_result',
		});
	}
	return terminal.result;
}
