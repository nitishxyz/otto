import type { Tool } from 'ai';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { getCwd, joinRelative, setCwd } from '../../runtime/utils/cwd.ts';
import { publishToolDelta } from './events.ts';

type ToolExecuteSignature = Tool['execute'] extends (
	input: infer Input,
	options: infer Options,
) => infer Result
	? { input: Input; options: Options; result: Result }
	: { input: unknown; options: unknown; result: unknown };

type ToolExecuteInput = ToolExecuteSignature['input'];
type ToolExecuteOptions = ToolExecuteSignature['options'] extends never
	? undefined
	: ToolExecuteSignature['options'];
type ToolExecuteReturn = ToolExecuteSignature['result'];

export function executeBaseTool(
	ctx: ToolAdapterContext,
	args: {
		base: Tool;
		name: string;
		input: ToolExecuteInput;
		options: ToolExecuteOptions;
	},
): ToolExecuteReturn | { cwd: string } | null | undefined {
	const cwd = getCwd(ctx.sessionId);
	const { base, name, input, options } = args;

	if (name === 'pwd') {
		return { cwd };
	}

	if (name === 'cd') {
		const next = joinRelative(
			cwd,
			String((input as Record<string, unknown>)?.path ?? '.'),
		);
		setCwd(ctx.sessionId, next);
		return { cwd: next };
	}

	if (
		['read', 'write', 'ls', 'tree'].includes(name) &&
		typeof (input as Record<string, unknown>)?.path === 'string'
	) {
		const rel = joinRelative(
			cwd,
			String((input as Record<string, unknown>).path),
		);
		const nextInput = {
			...(input as Record<string, unknown>),
			path: rel,
		} as ToolExecuteInput;
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
		return base.execute?.(nextInput, options as any);
	}

	if (name === 'shell' || name === 'bash') {
		const needsCwd =
			!input || typeof (input as Record<string, unknown>).cwd !== 'string';
		const nextInput = needsCwd
			? ({
					...(input as Record<string, unknown>),
					cwd,
				} as ToolExecuteInput)
			: input;
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
		return base.execute?.(nextInput, options as any);
	}

	// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
	return base.execute?.(input, options as any);
}

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

function getTerminalId(chunk: unknown): string | null {
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
	const chunks: unknown[] = [];
	let streamedResult: unknown = null;

	for await (const chunk of args.stream) {
		chunks.push(chunk);
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

	return (
		streamedResult ?? (chunks.length > 0 ? chunks[chunks.length - 1] : null)
	);
}
