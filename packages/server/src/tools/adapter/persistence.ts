import { messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { publishToolResult, type ToolResultContent } from './events.ts';

export type ToolTiming = {
	endTs: number;
	durationMs: number | null;
};

export function computeToolTiming(startTs?: number): ToolTiming {
	const endTs = Date.now();
	return {
		endTs,
		durationMs:
			typeof startTs === 'number' ? Math.max(0, endTs - startTs) : null,
	};
}

export async function persistToolCall(
	ctx: ToolAdapterContext,
	args: {
		partId: string;
		name: string;
		input: unknown;
		callId: string;
		startTs?: number;
		stepIndex?: number;
	},
): Promise<number> {
	const index = await ctx.nextIndex();
	await ctx.db.insert(messageParts).values({
		id: args.partId,
		messageId: ctx.messageId,
		index,
		stepIndex: args.stepIndex,
		type: 'tool_call',
		content: JSON.stringify({
			name: args.name,
			args: args.input,
			callId: args.callId,
		}),
		agent: ctx.agent,
		provider: ctx.provider,
		model: ctx.model,
		startedAt: args.startTs,
		toolName: args.name,
		toolCallId: args.callId,
	});
	return index;
}

export async function persistToolResultWithIndex(
	ctx: ToolAdapterContext,
	args: {
		partId: string;
		index: number;
		name: string;
		content: ToolResultContent;
		startTs?: number;
		callId?: string;
		stepIndex?: number;
		endTs: number;
		durationMs: number | null;
	},
): Promise<void> {
	await ctx.db.insert(messageParts).values({
		id: args.partId,
		messageId: ctx.messageId,
		index: args.index,
		stepIndex: args.stepIndex,
		type: 'tool_result',
		content: JSON.stringify(args.content),
		agent: ctx.agent,
		provider: ctx.provider,
		model: ctx.model,
		startedAt: args.startTs,
		completedAt: args.endTs,
		toolName: args.name,
		toolCallId: args.callId,
		toolDurationMs: args.durationMs ?? undefined,
	});
}

export async function persistToolResult(
	ctx: ToolAdapterContext,
	args: {
		partId: string;
		name: string;
		content: ToolResultContent;
		startTs?: number;
		callId?: string;
		stepIndex?: number;
		endTs: number;
		durationMs: number | null;
	},
): Promise<void> {
	const index = await ctx.nextIndex();
	await persistToolResultWithIndex(ctx, { ...args, index });
}

export async function persistToolErrorResult(
	ctx: ToolAdapterContext,
	args: {
		name: string;
		errorResult: unknown;
		callId?: string;
		startTs?: number;
		stepIndexForEvent?: number;
		input?: unknown;
	},
): Promise<void> {
	const resultPartId = crypto.randomUUID();
	const { endTs, durationMs } = computeToolTiming(args.startTs);
	const effectiveStepIndex = args.stepIndexForEvent ?? ctx.stepIndex;
	const content: ToolResultContent = {
		name: args.name,
		result: args.errorResult,
		callId: args.callId,
	};

	if (args.input !== undefined) {
		content.args = args.input;
	}

	await persistToolResult(ctx, {
		partId: resultPartId,
		name: args.name,
		content,
		startTs: args.startTs,
		callId: args.callId,
		stepIndex: effectiveStepIndex,
		endTs,
		durationMs,
	});
	publishToolResult(ctx, content, effectiveStepIndex);
}

export async function updateToolSessionStats(
	ctx: ToolAdapterContext,
	args: { name: string; durationMs: number | null; endTs: number },
): Promise<void> {
	try {
		const sessRows = await ctx.db
			.select()
			.from(sessions)
			.where(eq(sessions.id, ctx.sessionId));
		if (sessRows.length) {
			const row = sessRows[0] as typeof sessions.$inferSelect;
			const totalToolTimeMs =
				Number(row.totalToolTimeMs || 0) + (args.durationMs ?? 0);
			let counts: Record<string, number> = {};
			try {
				counts = row.toolCountsJson ? JSON.parse(row.toolCountsJson) : {};
			} catch {}
			counts[args.name] = (counts[args.name] || 0) + 1;
			await ctx.db
				.update(sessions)
				.set({
					totalToolTimeMs,
					toolCountsJson: JSON.stringify(counts),
					lastActiveAt: args.endTs,
				})
				.where(eq(sessions.id, ctx.sessionId));
		}
	} catch {}
}
