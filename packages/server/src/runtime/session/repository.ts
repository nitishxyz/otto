import type { DB } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { APIError } from '../errors/api-error.ts';

export type SessionRow = typeof sessions.$inferSelect;

export class SessionNotFoundError extends APIError {
	constructor(sessionId: string) {
		super('Session not found', {
			status: 404,
			code: 'session_not_found',
			details: { sessionId },
		});
		this.name = 'SessionNotFoundError';
	}
}

export class SessionProjectMismatchError extends APIError {
	constructor(sessionId: string, projectRoot: string) {
		// Deliberately use 404 so callers cannot use a session id to discover
		// records owned by another project.
		super('Session not found', {
			status: 404,
			code: 'session_project_mismatch',
			details: { sessionId, projectRoot },
		});
		this.name = 'SessionProjectMismatchError';
	}
}

/** Project runtimes use isolated databases; projectPath is a second ownership boundary. */
export class SessionRepository {
	constructor(
		private readonly db: DB,
		private readonly projectRoot: string,
	) {}

	async find(sessionId: string): Promise<SessionRow | null> {
		const rows = await this.db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1);
		const session = rows[0] ?? null;
		if (session && session.projectPath !== this.projectRoot) {
			throw new SessionProjectMismatchError(sessionId, this.projectRoot);
		}
		return session;
	}

	async require(sessionId: string): Promise<SessionRow> {
		const session = await this.find(sessionId);
		if (!session) throw new SessionNotFoundError(sessionId);
		return session;
	}
}

export function sessionRepository(
	db: DB,
	projectRoot: string,
): SessionRepository {
	return new SessionRepository(db, projectRoot);
}
