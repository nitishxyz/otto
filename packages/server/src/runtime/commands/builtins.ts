import type { DB } from '@ottocode/database';
import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import {
	buildCompactionContext,
	getModelLimits,
	isCompactCommand,
} from '../message/compaction.ts';
import { prepareRecipeCommand } from './recipes.ts';

export type BuiltinCommandPromptMessage = {
	role: 'system' | 'user';
	content: string;
};

export type BuiltinCommandSpec = {
	id: 'compact' | `recipe:${string}`;
	agent?: string;
	provider?: string;
	model?: string;
	oneShot?: boolean;
	/**
	 * Controls prompt construction only. The run still executes in the current
	 * session and persists messages/tool activity through the normal pipeline.
	 */
	omitHistory?: boolean;
	isCompactCommand?: boolean;
	compactionContext?: string;
	additionalPromptMessages?: BuiltinCommandPromptMessage[];
};

/**
 * Returns a prepared built-in slash command spec when the message matches one.
 *
 * These commands still run through the normal current-session agent pipeline;
 * this only customizes the prompt setup and agent selection.
 */
export async function prepareBuiltinCommand(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
	provider: ProviderId;
	model: string;
	content: string;
}): Promise<BuiltinCommandSpec | null> {
	if (isCompactCommand(args.content)) {
		const limits = getModelLimits(args.provider, args.model);
		const contextTokenLimit = limits
			? Math.max(Math.floor(limits.context * 0.5), 15000)
			: 15000;
		const compactionContext = await buildCompactionContext(
			args.db,
			args.sessionId,
			contextTokenLimit,
		);
		return {
			id: 'compact',
			isCompactCommand: true,
			omitHistory: true,
			compactionContext,
		};
	}

	const recipeCommand = await prepareRecipeCommand({
		projectRoot: args.cfg.projectRoot,
		content: args.content,
	});
	if (recipeCommand) {
		return {
			id: `recipe:${recipeCommand.name}`,
			agent: recipeCommand.agent,
			provider: recipeCommand.provider,
			model: recipeCommand.model,
			oneShot: recipeCommand.oneShot,
			omitHistory: !recipeCommand.includeInHistory,
			additionalPromptMessages: [
				{ role: 'user', content: recipeCommand.prompt },
			],
		};
	}

	return null;
}
