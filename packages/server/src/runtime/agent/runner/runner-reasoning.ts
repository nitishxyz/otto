import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';

export type ReasoningState = {
	partId: string;
	text: string;
	providerMetadata?: unknown;
	persisted: boolean;
	opts: RunOpts;
	sharedCtx: ToolAdapterContext;
	getStepIndex: () => number;
};

export function serializeReasoningContent(state: ReasoningState): string {
	return JSON.stringify(
		state.providerMetadata != null
			? { text: state.text, providerMetadata: state.providerMetadata }
			: { text: state.text },
	);
}

export async function handleReasoningStart(
	reasoningId: string,
	providerMetadata: unknown,
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	sharedCtx: ToolAdapterContext,
	getStepIndex: () => number,
	reasoningStates: Map<string, ReasoningState>,
): Promise<void> {
	const reasoningPartId = crypto.randomUUID();
	const state: ReasoningState = {
		partId: reasoningPartId,
		text: '',
		providerMetadata,
		persisted: false,
		opts,
		sharedCtx,
		getStepIndex,
	};
	reasoningStates.set(reasoningId, state);

	if (hasAnthropicRedactedReasoning(providerMetadata)) {
		const delta = '[Reasoning redacted by Anthropic]\n';
		state.text = delta;
		await persistReasoningPart(state, db);
		publish({
			type: 'reasoning.delta',
			sessionId: opts.sessionId,
			payload: {
				messageId: opts.assistantMessageId,
				partId: state.partId,
				stepIndex: getStepIndex(),
				delta,
			},
		});
	}
}

async function persistReasoningPart(
	state: ReasoningState,
	db: Awaited<ReturnType<typeof getDb>>,
): Promise<void> {
	if (state.persisted) return;
	try {
		await db.insert(messageParts).values({
			id: state.partId,
			messageId: state.opts.assistantMessageId,
			index: await state.sharedCtx.nextIndex(),
			stepIndex: state.getStepIndex(),
			type: 'reasoning',
			content: serializeReasoningContent(state),
			agent: state.opts.agent,
			provider: state.opts.provider,
			model: state.opts.model,
			startedAt: Date.now(),
		});
		state.persisted = true;
	} catch {}
}

export async function handleReasoningDelta(
	reasoningId: string,
	text: string,
	providerMetadata: unknown,
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	sharedCtx: ToolAdapterContext,
	getStepIndex: () => number,
	reasoningStates: Map<string, ReasoningState>,
): Promise<void> {
	let state = reasoningStates.get(reasoningId);
	if (!state) {
		state = {
			partId: crypto.randomUUID(),
			text: '',
			providerMetadata,
			persisted: false,
			opts,
			sharedCtx,
			getStepIndex,
		};
		reasoningStates.set(reasoningId, state);
	}
	state.text += text;
	if (providerMetadata != null) {
		state.providerMetadata = providerMetadata;
	}

	// Skip empty-text updates (e.g. Anthropic signature_delta from adaptive
	// thinking emits reasoning-delta with `text: ""`). Publishing/persisting
	// these would create an empty reasoning placeholder shown as `{"text":""}`.
	if (!text) return;

	await persistReasoningPart(state, db);

	publish({
		type: 'reasoning.delta',
		sessionId: opts.sessionId,
		payload: {
			messageId: opts.assistantMessageId,
			partId: state.partId,
			stepIndex: getStepIndex(),
			delta: text,
		},
	});
	try {
		await db
			.update(messageParts)
			.set({ content: serializeReasoningContent(state) })
			.where(eq(messageParts.id, state.partId));
	} catch {}
}

function hasAnthropicRedactedReasoning(providerMetadata: unknown): boolean {
	if (!providerMetadata || typeof providerMetadata !== 'object') return false;
	const anthropic = (providerMetadata as Record<string, unknown>).anthropic;
	if (!anthropic || typeof anthropic !== 'object') return false;
	return 'redactedData' in anthropic;
}

export async function handleReasoningEnd(
	reasoningId: string,
	db: Awaited<ReturnType<typeof getDb>>,
	reasoningStates: Map<string, ReasoningState>,
): Promise<void> {
	const state = reasoningStates.get(reasoningId);
	if (!state) return;
	if (!state.text || state.text.trim() === '') {
		if (state.persisted) {
			try {
				await db.delete(messageParts).where(eq(messageParts.id, state.partId));
			} catch {}
		}
		reasoningStates.delete(reasoningId);
		return;
	}
	try {
		await db
			.update(messageParts)
			.set({ completedAt: Date.now() })
			.where(eq(messageParts.id, state.partId));
	} catch {}
	reasoningStates.delete(reasoningId);
}
