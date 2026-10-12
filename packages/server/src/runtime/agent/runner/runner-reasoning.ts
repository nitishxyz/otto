import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { queuePartContentWrite } from '../../persistence/part-content-writer.ts';
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
			projectId: opts.projectId,
			projectRoot: opts.projectRoot,
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
	const metadataChanged = mergeReasoningMetadata(state, providerMetadata);

	// Empty-text updates (e.g. Anthropic signature_delta from adaptive thinking)
	// never create a placeholder part, but metadata for an existing part is
	// persisted so signatures survive.
	if (!text) {
		if (metadataChanged && state.persisted) {
			queuePartContentWrite(db, state.partId, serializeReasoningContent(state));
		}
		return;
	}

	await persistReasoningPart(state, db);

	publish({
		type: 'reasoning.delta',
		sessionId: opts.sessionId,
		projectId: opts.projectId,
		projectRoot: opts.projectRoot,
		payload: {
			messageId: opts.assistantMessageId,
			partId: state.partId,
			stepIndex: getStepIndex(),
			delta: text,
		},
	});
	queuePartContentWrite(db, state.partId, serializeReasoningContent(state));
}

function hasAnthropicRedactedReasoning(providerMetadata: unknown): boolean {
	if (!providerMetadata || typeof providerMetadata !== 'object') return false;
	const anthropic = (providerMetadata as Record<string, unknown>).anthropic;
	if (!anthropic || typeof anthropic !== 'object') return false;
	return 'redactedData' in anthropic;
}

function mergeReasoningMetadata(
	state: ReasoningState,
	providerMetadata: unknown,
): boolean {
	if (providerMetadata == null) return false;
	const previous = state.providerMetadata;
	if (
		previous &&
		typeof previous === 'object' &&
		typeof providerMetadata === 'object'
	) {
		const merged: Record<string, unknown> = {
			...(previous as Record<string, unknown>),
		};
		for (const [key, value] of Object.entries(
			providerMetadata as Record<string, unknown>,
		)) {
			const existing = merged[key];
			merged[key] =
				existing &&
				typeof existing === 'object' &&
				value &&
				typeof value === 'object'
					? {
							...(existing as Record<string, unknown>),
							...(value as Record<string, unknown>),
						}
					: value;
		}
		state.providerMetadata = merged;
	} else {
		state.providerMetadata = providerMetadata;
	}
	return JSON.stringify(previous) !== JSON.stringify(state.providerMetadata);
}

async function finalizeReasoningState(
	state: ReasoningState,
	db: Awaited<ReturnType<typeof getDb>>,
): Promise<void> {
	if (!state.text || state.text.trim() === '') {
		if (state.persisted) {
			await db.delete(messageParts).where(eq(messageParts.id, state.partId));
		}
		return;
	}
	if (!state.persisted) await persistReasoningPart(state, db);
	queuePartContentWrite(db, state.partId, serializeReasoningContent(state));
	await db
		.update(messageParts)
		.set({ completedAt: Date.now() })
		.where(eq(messageParts.id, state.partId));
}

export async function handleReasoningEnd(
	reasoningId: string,
	db: Awaited<ReturnType<typeof getDb>>,
	reasoningStates: Map<string, ReasoningState>,
	providerMetadata?: unknown,
): Promise<void> {
	const state = reasoningStates.get(reasoningId);
	if (!state) return;
	reasoningStates.delete(reasoningId);
	mergeReasoningMetadata(state, providerMetadata);
	await finalizeReasoningState(state, db);
}

/**
 * Finalizes reasoning parts left open by an error, abort, or a stream that
 * ended without `reasoning-end`.
 */
export async function finalizeOpenReasoningStates(
	db: Awaited<ReturnType<typeof getDb>>,
	reasoningStates: Map<string, ReasoningState>,
): Promise<void> {
	const open = Array.from(reasoningStates.values());
	reasoningStates.clear();
	for (const state of open) await finalizeReasoningState(state, db);
}
