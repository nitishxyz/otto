import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { streamText } from 'ai';
import { resolveModel } from '../provider/index.ts';
import { getAuth } from '@ottocode/sdk';
import { loadConfig } from '@ottocode/sdk';
import { getModelLimits } from './compaction-limits.ts';
import { buildCompactionContext } from './compaction-context.ts';
import { getCompactionSystemPrompt } from './compaction-detect.ts';
import { planSessionCompaction } from './compaction-mark.ts';
import { installCompactionCheckpoint } from './compaction-checkpoint.ts';
import { validateSummary } from './summary-validation.ts';
import { detectOAuth, adaptSimpleCall } from '../provider/oauth-adapter.ts';
import { toErrorMessage } from '../errors/handling.ts';

export async function performAutoCompaction(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	assistantMessageId: string,
	publishFn: (event: {
		type: string;
		sessionId: string;
		payload: Record<string, unknown>;
	}) => void,
	provider: string,
	modelId: string,
	projectRoot: string,
	throughMessageId?: string,
): Promise<{
	success: boolean;
	summary?: string;
	error?: string;
	compactMessageId?: string;
}> {
	try {
		const limits = getModelLimits(provider, modelId);
		const contextTokenLimit = limits
			? Math.max(Math.floor(limits.context * 0.5), 15000)
			: 15000;

		const context = await buildCompactionContext(
			db,
			sessionId,
			contextTokenLimit,
			throughMessageId,
		);
		if (!context || context.length < 100) {
			return { success: false, error: 'Not enough context to compact' };
		}

		const cfg = await loadConfig(projectRoot);

		const auth = await getAuth(
			provider as Parameters<typeof getAuth>[0],
			cfg.projectRoot,
		);
		const oauth = detectOAuth(provider, auth);

		const model = await resolveModel(
			provider as Parameters<typeof resolveModel>[0],
			modelId,
			cfg,
		);

		const compactionPrompt = getCompactionSystemPrompt();
		const userContent = `IMPORTANT: Generate a comprehensive summary. This will replace the detailed conversation history.\n\nPlease summarize this conversation:\n\n<conversation-to-summarize>\n${context}\n</conversation-to-summarize>`;

		const adapted = adaptSimpleCall(oauth, {
			instructions: compactionPrompt,
			userContent,
			maxOutputTokens: 2400,
		});

		const compactPartId = crypto.randomUUID();
		const now = Date.now();

		await db.insert(messageParts).values({
			id: compactPartId,
			messageId: assistantMessageId,
			index: 0,
			stepIndex: 0,
			type: 'text',
			content: JSON.stringify({ text: '' }),
			agent: 'system',
			provider: provider,
			model: modelId,
			startedAt: now,
		});

		const result = streamText({
			model,
			system: adapted.system,
			messages: adapted.messages,
			maxOutputTokens: adapted.maxOutputTokens,
			providerOptions: adapted.providerOptions,
		});

		let summary = '';
		for await (const chunk of result.textStream) {
			summary += chunk;

			publishFn({
				type: 'message.part.delta',
				sessionId,
				payload: {
					messageId: assistantMessageId,
					partId: compactPartId,
					stepIndex: 0,
					type: 'text',
					delta: chunk,
				},
			});
		}

		const validation = validateSummary({
			text: summary,
			finishReason: await result.finishReason,
		});
		if (!validation.ok) {
			return { success: false, error: validation.reason };
		}

		// The summary covers evidence through `throughMessageId`; anything
		// queued after that boundary stays in model history.
		const summarizedThroughMessageId = throughMessageId ?? assistantMessageId;
		const plan = await planSessionCompaction(
			db,
			sessionId,
			summarizedThroughMessageId,
		);
		installCompactionCheckpoint({
			db,
			sessionId,
			summaryMessageId: assistantMessageId,
			summarizedThroughMessageId,
			summary,
			compactPartIds: plan.partIds,
			summaryPart: {
				partId: compactPartId,
				content: JSON.stringify({ text: summary }),
			},
		});

		return { success: true, summary, compactMessageId: assistantMessageId };
	} catch (err) {
		const errorMsg = toErrorMessage(err);
		return { success: false, error: errorMsg };
	}
}
