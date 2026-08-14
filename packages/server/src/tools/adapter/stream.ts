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

export async function consumeToolStream(
	ctx: ToolAdapterContext,
	args: {
		stream: AsyncIterable<unknown>;
		name: string;
		stepIndex?: number;
		callId?: string;
	},
): Promise<unknown> {
	let lastChunk: unknown = null;
	let streamedResult: unknown = null;

	for await (const chunk of args.stream) {
		lastChunk = chunk;
		if (chunk && typeof chunk === 'object' && 'result' in chunk) {
			streamedResult = (chunk as { result: unknown }).result;
			continue;
		}

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

	return streamedResult ?? lastChunk;
}
