import { runShare } from '../share.ts';
import { ensureAuth } from '../middleware/with-auth.ts';
import { ensureServer } from '../ask/server.ts';

export interface ShareCommandOptions {
	project: string;
	title?: string;
	description?: string;
	until?: string;
	update?: boolean;
	delete?: boolean;
	status?: boolean;
	list?: boolean;
}

export async function handleShare(
	sessionId: string | undefined,
	opts: ShareCommandOptions,
) {
	if (!(await ensureAuth(opts.project))) return;
	await ensureServer(opts.project);

	await runShare({
		project: opts.project,
		sessionId,
		title: opts.title,
		description: opts.description,
		until: opts.until,
		update: opts.update,
		delete: opts.delete,
		status: opts.status,
		list: opts.list,
	});
}

export { registerShareCommand } from './lazy/share.ts';
