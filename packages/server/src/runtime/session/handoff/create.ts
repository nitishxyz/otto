import type { DB } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { createSession } from '../manager.ts';
import { getLatestMessageId, insertTextMessage } from './messages.ts';
import { buildHandoffContext, buildHandoffVisibleMessage } from './prompts.ts';
import { prepareHandoffSummary } from './summary.ts';
import type { HandoffResult, SessionRow } from './types.ts';

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

	const now = Date.now();
	await insertTextMessage({
		db,
		sessionId: sourceSession.id,
		role: 'user',
		agent: sourceSession.agent,
		provider: sourceSession.provider,
		model: sourceSession.model,
		text: '/handoff',
		createdAt: now,
	});
	await insertTextMessage({
		db,
		sessionId: sourceSession.id,
		role: 'assistant',
		agent: sourceSession.agent,
		provider: sourceSession.provider,
		model: sourceSession.model,
		text: 'Handoff created. Opening the new session…',
		createdAt: now + 1,
	});

	const created = await createSession({
		db,
		cfg,
		agent: sourceSession.agent,
		provider,
		model,
		title: `Handoff: ${sourceSession.title || 'Untitled'}`,
	});

	await db
		.update(sessions)
		.set({
			contextSummary: handoffContext,
			parentSessionId: sourceSession.id,
			branchPointMessageId,
			sessionType: 'handoff',
			lastActiveAt: Date.now(),
		})
		.where(eq(sessions.id, created.id));

	const session: SessionRow = {
		...created,
		contextSummary: handoffContext,
		parentSessionId: sourceSession.id,
		branchPointMessageId,
		sessionType: 'handoff',
	};

	const visibleMessage = buildHandoffVisibleMessage(sourceSession.id);
	await insertTextMessage({
		db,
		sessionId: session.id,
		role: 'system',
		agent: session.agent,
		provider: session.provider,
		model: session.model,
		text: visibleMessage,
	});

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
