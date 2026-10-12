import type { DB } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import { publish } from '../../../events/bus.ts';
import { prepareSessionRow } from '../manager.ts';
import { getLatestMessageId, prepareTextMessage } from './messages.ts';
import { buildHandoffContext, buildHandoffVisibleMessage } from './prompts.ts';
import { prepareHandoffSummary } from './summary.ts';
import type { HandoffResult, SessionRow } from './types.ts';

/**
 * Creates a handoff session. The summary is generated and validated first;
 * the source-session marker messages, the new session, and its visible
 * system message are then written in one transaction, and events are
 * published only after commit. An invalid summary leaves all state untouched.
 */
export async function createHandoffSession(args: {
	cfg: OttoConfig;
	db: DB;
	sourceSession: SessionRow;
}): Promise<HandoffResult> {
	const { cfg, db, sourceSession } = args;
	const provider = sourceSession.provider as ProviderId;
	const model = sourceSession.model;
	const preparedSummary = await prepareHandoffSummary({
		cfg,
		db,
		sourceSession,
	});
	const handoffContext = buildHandoffContext({
		sourceSession,
		context: preparedSummary,
	});
	const branchPointMessageId = await getLatestMessageId(db, sourceSession.id);

	const created = await prepareSessionRow({
		cfg,
		agent: sourceSession.agent,
		provider,
		model,
		title: `Handoff: ${sourceSession.title || 'Untitled'}`,
	});
	const session: SessionRow = {
		...created,
		contextSummary: handoffContext,
		inheritedContext: handoffContext,
		parentSessionId: sourceSession.id,
		branchPointMessageId,
		sessionType: 'handoff',
	};

	const now = Date.now();
	const sourceMessages = [
		prepareTextMessage({
			sessionId: sourceSession.id,
			role: 'user',
			agent: sourceSession.agent,
			provider: sourceSession.provider,
			model: sourceSession.model,
			text: '/handoff',
			createdAt: now,
		}),
		prepareTextMessage({
			sessionId: sourceSession.id,
			role: 'assistant',
			agent: sourceSession.agent,
			provider: sourceSession.provider,
			model: sourceSession.model,
			text: 'Handoff created. Opening the new session…',
			createdAt: now + 1,
		}),
	];
	const visibleMessage = buildHandoffVisibleMessage(sourceSession.id);
	const systemMessage = prepareTextMessage({
		sessionId: session.id,
		role: 'system',
		agent: session.agent,
		provider: session.provider,
		model: session.model,
		text: visibleMessage,
	});

	db.transaction((tx) => {
		for (const prepared of sourceMessages) {
			tx.insert(messages).values(prepared.message).run();
			tx.insert(messageParts).values(prepared.part).run();
		}
		tx.insert(sessions).values(session).run();
		tx.insert(messages).values(systemMessage.message).run();
		tx.insert(messageParts).values(systemMessage.part).run();
	});

	for (const prepared of sourceMessages) prepared.publish();
	publish({ type: 'session.created', sessionId: session.id, payload: session });
	systemMessage.publish();
	publish({
		type: 'session.updated',
		sessionId: session.id,
		payload: session,
	});

	return {
		session,
		sourceSessionId: sourceSession.id,
		context: handoffContext,
		message: visibleMessage,
	};
}
