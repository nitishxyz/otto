import type { DB } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';

export async function touchSessionLastActive(args: {
	db: DB;
	sessionId: string;
}): Promise<void> {
	const { db, sessionId } = args;
	try {
		await db
			.update(sessions)
			.set({ lastActiveAt: Date.now() })
			.where(eq(sessions.id, sessionId))
			.run();
	} catch {}
}
