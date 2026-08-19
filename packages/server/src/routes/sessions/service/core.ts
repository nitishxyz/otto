import { getDbForConfig } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { eq, inArray } from 'drizzle-orm';
import { touchProject } from '../../../runtime/projects/registry.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
import type { ProjectDbContext } from './types.ts';

export async function loadProjectDb(
	projectRoot: string,
): Promise<ProjectDbContext> {
	const cfg = await loadConfig(projectRoot);
	const db = await getDbForConfig(cfg);
	// Best-effort: record this project in the global registry so the cross-
	// project usage dashboard can discover it. Debounced per-process.
	void touchProject(cfg.projectRoot, cfg.paths.dbPath);
	return { cfg, db };
}

export async function findSessionById(
	db: ProjectDbContext['db'],
	sessionId: string,
	projectRoot?: string,
) {
	if (projectRoot) return sessionRepository(db, projectRoot).find(sessionId);
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	return rows[0] ?? null;
}

export async function deleteSessionMessagesAndParts(
	db: ProjectDbContext['db'],
	sessionId: string,
) {
	await db
		.delete(messageParts)
		.where(
			inArray(
				messageParts.messageId,
				db
					.select({ id: messages.id })
					.from(messages)
					.where(eq(messages.sessionId, sessionId)),
			),
		);
	await db.delete(messages).where(eq(messages.sessionId, sessionId));
}
