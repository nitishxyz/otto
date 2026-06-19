import { messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { RunOpts } from '../queue.ts';
import { normalizeUsage, resolveUsageProvider } from './usage.ts';
import type { ProviderMetadata, RuntimeDb, UsageData } from './types.ts';

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
	db: RuntimeDb,
): Promise<void> {
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
	db: RuntimeDb,
): Promise<void> {
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
	db: RuntimeDb,
): Promise<void> {
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
