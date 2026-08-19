import { runSessions } from '../sessions.ts';
import { ensureAuth } from '../middleware/with-auth.ts';
import { ensureServer } from '../ask/server.ts';

export interface SessionsOptions {
	project: string;
	json: boolean;
	list: boolean;
	pick: boolean;
	limit?: number;
}

export async function handleSessions(opts: SessionsOptions) {
	if (!(await ensureAuth(opts.project))) return;
	await ensureServer(opts.project);

	const pick = !opts.list && !opts.json ? true : opts.pick;
	await runSessions({
		project: opts.project,
		json: opts.json,
		pick,
		limit: opts.limit,
	});
}

export { registerSessionsCommand } from './lazy/sessions.ts';
