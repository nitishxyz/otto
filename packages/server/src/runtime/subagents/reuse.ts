import { eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { getSessionById } from '../session/manager.ts';

type ReusableSession = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;

export async function resolveReusableChildSession(args: {
	db: DB;
	parentSessionId: string;
	targetAgent: string;
	reuseSessionId: string;
}): Promise<
	{ ok: true; session: ReusableSession } | { ok: false; error: string }
> {
	const { db, parentSessionId, targetAgent, reuseSessionId } = args;
	const session = await getSessionById({ db, sessionId: reuseSessionId });
	if (!session) {
		return {
			ok: false,
			error: `Reuse session "${reuseSessionId}" not found. Delegate without reuseSessionId to start fresh.`,
		};
	}
	if (
		session.sessionType !== 'subagent' ||
		session.parentSessionId !== parentSessionId
	) {
		return {
			ok: false,
			error:
				'Reuse session must be a sub-agent session previously spawned from this session.',
		};
	}
	if (session.agent !== targetAgent) {
		return {
			ok: false,
			error: `Reuse session belongs to agent "${session.agent}", not "${targetAgent}". Reuse is only valid for the same agent.`,
		};
	}
	const records = await db
		.select({ status: subagents.status })
		.from(subagents)
		.where(eq(subagents.childSessionId, reuseSessionId));
	if (records.some((record) => record.status === 'running')) {
		return {
			ok: false,
			error:
				'Reuse session is still running a task. Wait for it to finish or delegate to a fresh session.',
		};
	}
	return { ok: true, session };
}
