import type { DB } from '@ottocode/database';
import { getAuth, type OttoConfig, type ProviderId } from '@ottocode/sdk';
import { streamText } from 'ai';
import {
	buildCompactionContext,
	getModelLimits,
} from '../../message/compaction.ts';
import { resolveModel } from '../../provider/index.ts';
import { adaptSimpleCall, detectOAuth } from '../../provider/oauth-adapter.ts';
import {
	buildHandoffUserPrompt,
	getHandoffSystemPrompt,
	normalizeHandoffSummary,
} from './prompts.ts';
import type { SessionRow } from './types.ts';

const HANDOFF_INPUT_TOKEN_LIMIT = 50_000;
const HANDOFF_OUTPUT_TOKEN_LIMIT = 4_000;

export async function prepareHandoffSummary(args: {
	cfg: OttoConfig;
	db: DB;
	sourceSession: SessionRow;
}): Promise<string> {
	const { cfg, db, sourceSession } = args;
	const provider = sourceSession.provider as ProviderId;
	const modelId = sourceSession.model;
	const limits = getModelLimits(provider, modelId);
	const contextTokenLimit = limits
		? Math.min(
				Math.max(Math.floor(limits.context * 0.5), 15000),
				HANDOFF_INPUT_TOKEN_LIMIT,
			)
		: HANDOFF_INPUT_TOKEN_LIMIT;
	const rawContext = await buildCompactionContext(
		db,
		sourceSession.id,
		contextTokenLimit,
	);

	const auth = await getAuth(provider, cfg.projectRoot);
	const oauth = detectOAuth(provider, auth);
	const model = await resolveModel(provider, modelId, cfg);
	const adapted = adaptSimpleCall(oauth, {
		instructions: getHandoffSystemPrompt(),
		userContent: buildHandoffUserPrompt({ sourceSession, rawContext }),
		maxOutputTokens: HANDOFF_OUTPUT_TOKEN_LIMIT,
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
	}

	const normalized = normalizeHandoffSummary(summary);
	if (normalized.length < 50) {
		throw new Error('Failed to generate handoff summary');
	}
	return normalized;
}
