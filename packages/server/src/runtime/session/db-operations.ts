import type { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { catalog, isBuiltInProviderId, type ProviderId } from '@ottocode/sdk';
import type { RunOpts } from './queue.ts';

export type UsageData = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedInputTokens?: number;
	cacheCreationInputTokens?: number;
	reasoningTokens?: number;
};

export type ProviderMetadata = Record<string, unknown> & {
	openai?: {
		cachedPromptTokens?: number;
		[key: string]: unknown;
	};
	anthropic?: {
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
		[key: string]: unknown;
	};
};

export function normalizeUsage(
	usage: UsageData,
	providerOptions: ProviderMetadata | undefined,
	provider: ProviderId,
): UsageData {
	const rawInputTokens = Number(usage.inputTokens ?? 0);
	const outputTokens = Number(usage.outputTokens ?? 0);
	const reasoningTokens = Number(usage.reasoningTokens ?? 0);

	const cachedInputTokens =
		usage.cachedInputTokens != null
			? Number(usage.cachedInputTokens)
			: providerOptions?.openai?.cachedPromptTokens != null
				? Number(providerOptions.openai.cachedPromptTokens)
				: providerOptions?.anthropic?.cacheReadInputTokens != null
					? Number(providerOptions.anthropic.cacheReadInputTokens)
					: undefined;

	const cacheCreationInputTokens =
		usage.cacheCreationInputTokens != null
			? Number(usage.cacheCreationInputTokens)
			: providerOptions?.anthropic?.cacheCreationInputTokens != null
				? Number(providerOptions.anthropic.cacheCreationInputTokens)
				: undefined;

	const cachedValue = cachedInputTokens ?? 0;

	let inputTokens = rawInputTokens;
	if (provider === 'openai') {
		inputTokens = Math.max(0, rawInputTokens - cachedValue);
	}

	return {
		inputTokens,
		outputTokens,
		cachedInputTokens,
		cacheCreationInputTokens,
		reasoningTokens,
	};
}

export function resolveUsageProvider(
	provider: ProviderId,
	model: string,
): ProviderId {
	if (
		provider !== 'ottorouter' &&
		provider !== 'openrouter' &&
		provider !== 'opencode'
	) {
		return provider;
	}
	const entry = isBuiltInProviderId(provider) ? catalog[provider] : undefined;
	const normalizedModel = model.includes('/') ? model.split('/').at(-1) : model;
	const modelEntry = entry?.models.find(
		(m: { id?: string }) =>
			m.id?.toLowerCase() === normalizedModel?.toLowerCase(),
	);
	const npm = modelEntry?.provider?.npm ?? '';
	if (npm.includes('openai')) return 'openai';
	if (npm.includes('anthropic')) return 'anthropic';
	if (npm.includes('google')) return 'google';
	if (npm.includes('zai')) return 'zai';
	return provider;
}

/**
 * Updates session token counts after each step.
 * AI SDK v6: onStepFinish.usage is PER-STEP (each step = one API call).
 * We ADD each step's tokens directly to session totals.
 * We also track currentContextTokens = the latest step's full input context.
 */
export async function updateSessionTokensIncremental(
	usage: UsageData,
	providerOptions: ProviderMetadata | undefined,
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
) {
	if (!usage || !db) return;

	const currentContextTokens = Number(usage.inputTokens ?? 0);

	const usageProvider = resolveUsageProvider(opts.provider, opts.model);
	const normalizedUsage = normalizeUsage(usage, providerOptions, usageProvider);

	const stepInput = Number(normalizedUsage.inputTokens ?? 0);
	const stepOutput = Number(normalizedUsage.outputTokens ?? 0);
	const stepCached = Number(normalizedUsage.cachedInputTokens ?? 0);
	const stepCacheCreation = Number(
		normalizedUsage.cacheCreationInputTokens ?? 0,
	);
	const stepReasoning = Number(normalizedUsage.reasoningTokens ?? 0);

	const sessRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, opts.sessionId));

	if (sessRows.length === 0 || !sessRows[0]) return;

	const sess = sessRows[0];

	await db
		.update(sessions)
		.set({
			totalInputTokens: Number(sess.totalInputTokens ?? 0) + stepInput,
			totalOutputTokens: Number(sess.totalOutputTokens ?? 0) + stepOutput,
			totalCachedTokens: Number(sess.totalCachedTokens ?? 0) + stepCached,
			totalCacheCreationTokens:
				Number(sess.totalCacheCreationTokens ?? 0) + stepCacheCreation,
			totalReasoningTokens:
				Number(sess.totalReasoningTokens ?? 0) + stepReasoning,
			currentContextTokens,
		})
		.where(eq(sessions.id, opts.sessionId));
}

/**
 * Updates session token counts after a run completes.
 * @deprecated Use updateSessionTokensIncremental for per-step tracking
 */
export async function updateSessionTokens(
	fin: { usage?: { inputTokens?: number; outputTokens?: number } },
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
) {
	if (!fin.usage || !db) return;

	const sessRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, opts.sessionId));

	if (sessRows.length > 0 && sessRows[0]) {
		const row = sessRows[0];
		const priorInput = Number(row.totalInputTokens ?? 0);
		const priorOutput = Number(row.totalOutputTokens ?? 0);
		const nextInput = priorInput + Number(fin.usage.inputTokens ?? 0);
		const nextOutput = priorOutput + Number(fin.usage.outputTokens ?? 0);

		await db
			.update(sessions)
			.set({
				totalInputTokens: nextInput,
				totalOutputTokens: nextOutput,
			})
			.where(eq(sessions.id, opts.sessionId));
	}
}

/**
 * Updates message token counts after each step.
 * AI SDK v6: onStepFinish.usage is PER-STEP. We ADD each step's tokens to message totals.
 */
export async function updateMessageTokensIncremental(
	usage: UsageData,
	providerOptions: ProviderMetadata | undefined,
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
) {
	if (!usage || !db) return;

	const usageProvider = resolveUsageProvider(opts.provider, opts.model);
	const normalizedUsage = normalizeUsage(usage, providerOptions, usageProvider);

	const stepInput = Number(normalizedUsage.inputTokens ?? 0);
	const stepOutput = Number(normalizedUsage.outputTokens ?? 0);
	const stepCached = Number(normalizedUsage.cachedInputTokens ?? 0);
	const stepCacheCreation = Number(
		normalizedUsage.cacheCreationInputTokens ?? 0,
	);
	const stepReasoning = Number(normalizedUsage.reasoningTokens ?? 0);

	const msgRows = await db
		.select()
		.from(messages)
		.where(eq(messages.id, opts.assistantMessageId));

	if (msgRows.length > 0 && msgRows[0]) {
		const msg = msgRows[0];
		const nextInput = Number(msg.inputTokens ?? 0) + stepInput;
		const nextOutput = Number(msg.outputTokens ?? 0) + stepOutput;
		const nextCached = Number(msg.cachedInputTokens ?? 0) + stepCached;
		const nextCacheCreation =
			Number(msg.cacheCreationInputTokens ?? 0) + stepCacheCreation;
		const nextReasoning = Number(msg.reasoningTokens ?? 0) + stepReasoning;

		await db
			.update(messages)
			.set({
				inputTokens: nextInput,
				outputTokens: nextOutput,
				totalTokens:
					nextInput +
					nextOutput +
					nextCached +
					nextCacheCreation +
					nextReasoning,
				cachedInputTokens: nextCached,
				cacheCreationInputTokens: nextCacheCreation,
				reasoningTokens: nextReasoning,
			})
			.where(eq(messages.id, opts.assistantMessageId));
	}
}

/**
 * Marks an assistant message as complete.
 * Token usage is tracked incrementally via updateMessageTokensIncremental().
 */
export async function completeAssistantMessage(
	fin: {
		usage?: {
			inputTokens?: number;
			outputTokens?: number;
			totalTokens?: number;
		};
		finishReason?: string;
		rawFinishReason?: string;
		providerMetadata?: ProviderMetadata;
		response?: unknown;
	},
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
) {
	if (!db) return;

	const finishDetails = buildFinishDetails({
		providerMetadata: fin.providerMetadata,
		response: fin.response,
	});

	// Only mark as complete - tokens are already tracked incrementally
	await db
		.update(messages)
		.set({
			status: 'complete',
			completedAt: Date.now(),
			finishReason: fin.finishReason,
			rawFinishReason: fin.rawFinishReason,
			finishDetails,
		})
		.where(eq(messages.id, opts.assistantMessageId));
}

function buildFinishDetails(input: {
	providerMetadata?: ProviderMetadata;
	response?: unknown;
}): string | undefined {
	const details: Record<string, unknown> = {};
	if (input.providerMetadata) details.providerMetadata = input.providerMetadata;
	if (input.response) details.response = input.response;
	if (Object.keys(details).length === 0) return undefined;
	try {
		return JSON.stringify(details);
	} catch {
		return JSON.stringify({ serializationError: true });
	}
}

/**
 * Removes empty text parts from an assistant message.
 */
export async function cleanupEmptyTextParts(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
) {
	if (!db) return;

	const parts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, opts.assistantMessageId));

	for (const p of parts) {
		if (p.type === 'text') {
			let t = '';
			try {
				t = JSON.parse(p.content || '{}')?.text || '';
			} catch {}
			if (!t || !t.trim()) {
				await db.delete(messageParts).where(eq(messageParts.id, p.id));
			}
		}
	}
}
