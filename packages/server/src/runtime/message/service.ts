import { logger } from '@ottocode/sdk';
import { prepareBuiltinCommand } from '../commands/builtins.ts';
import { runSessionLoop } from '../agent/runner.ts';
import { enqueueAssistantRun } from '../session/queue.ts';
import { attachDirectImages } from './attachments.ts';
import { estimateTokens } from './compaction.ts';
import { createPendingAssistantMessage, createUserMessage } from './create.ts';
import { injectMessageContext, prepareMessageContext } from './context.ts';
import {
	compressFileImageAttachments,
	compressImageAttachments,
} from './image-compression.ts';
import { touchSessionLastActive } from './session-activity.ts';
import type { DispatchOptions } from './types.ts';

export { triggerDeferredTitleGeneration } from './title-generation.ts';
export async function dispatchAssistantMessage(
	options: DispatchOptions,
): Promise<{ assistantMessageId: string }> {
	const {
		cfg,
		db,
		session,
		agent,
		provider,
		model,
		content,
		oneShot,
		userContext,
		reasoningText,
		reasoningLevel,
		images,
		files,
		context,
	} = options;

	const sessionId = session.id;
	const now = Date.now();
	const compressedImages = await compressImageAttachments(images);
	const imagesWithAttachments = await attachDirectImages({
		projectRoot: cfg.projectRoot,
		sessionId,
		images: compressedImages,
	});
	const compressedFiles = await compressFileImageAttachments(files);
	const builtinCommand = await prepareBuiltinCommand({
		cfg,
		db,
		sessionId,
		provider,
		model,
		content,
	});
	const effectiveAgent = builtinCommand?.agent ?? agent;
	const effectiveProvider = builtinCommand?.provider ?? provider;
	const effectiveModel = builtinCommand?.model ?? model;
	const effectiveOneShot = builtinCommand?.oneShot ?? oneShot;
	const preparedContext = await prepareMessageContext(cfg.projectRoot, context);
	logger.debug('[agent] dispatching assistant message', {
		sessionId,
		agent: effectiveAgent,
		provider: effectiveProvider,
		model: effectiveModel,
		oneShot: Boolean(effectiveOneShot),
		hasUserContext: Boolean(userContext),
		builtinCommand: builtinCommand?.id,
	});

	await createUserMessage({
		db,
		sessionId,
		agent: effectiveAgent,
		provider: effectiveProvider,
		model: effectiveModel,
		content,
		createdAt: now,
		images: imagesWithAttachments,
		files: compressedFiles,
	});

	const { assistantMessageId } = await createPendingAssistantMessage({
		db,
		sessionId,
		agent: effectiveAgent,
		provider: effectiveProvider,
		model: effectiveModel,
	});
	const contextTokens = await injectMessageContext({
		db,
		sessionId,
		messageId: assistantMessageId,
		agent: effectiveAgent,
		provider: effectiveProvider,
		model: effectiveModel,
		prepared: preparedContext,
	});

	const commandPromptText =
		builtinCommand?.additionalPromptMessages
			?.map((message) => message.content)
			.join('\n\n') ?? content;
	const estimatedInputTokens =
		estimateTokens(commandPromptText) +
		estimateTokens(userContext ?? '') +
		(files?.reduce(
			(total, file) => total + estimateTokens(file.textContent ?? ''),
			0,
		) ?? 0);
	const toolApprovalMode = cfg.defaults.toolApproval ?? 'dangerous';

	enqueueAssistantRun(
		{
			sessionId,
			assistantMessageId,
			agent: effectiveAgent,
			provider: effectiveProvider,
			model: effectiveModel,
			projectRoot: cfg.projectRoot,
			oneShot: Boolean(effectiveOneShot),
			userContent: content,
			userContext,
			estimatedInputTokens: estimatedInputTokens + contextTokens,
			reasoningText,
			reasoningLevel,
			omitHistory: builtinCommand?.omitHistory,
			isCompactCommand: builtinCommand?.isCompactCommand,
			compactionContext: builtinCommand?.compactionContext,
			additionalPromptMessages: builtinCommand?.additionalPromptMessages,
			toolApprovalMode,
		},
		runSessionLoop,
	);
	logger.debug('[agent] assistant run enqueued', {
		sessionId,
		assistantMessageId,
		agent: effectiveAgent,
		provider: effectiveProvider,
		model: effectiveModel,
		builtinCommand: builtinCommand?.id,
		isCompactCommand: builtinCommand?.isCompactCommand,
	});

	void touchSessionLastActive({ db, sessionId });

	return { assistantMessageId };
}
