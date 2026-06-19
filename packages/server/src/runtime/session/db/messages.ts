import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { RunOpts } from '../queue.ts';
import type { ProviderMetadata, RuntimeDb } from './types.ts';

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
	db: RuntimeDb,
): Promise<void> {
	if (!db) return;

	const finishDetails = buildFinishDetails({
		providerMetadata: fin.providerMetadata,
		response: fin.response,
	});

	// Only mark as complete - tokens are already tracked incrementally.
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
