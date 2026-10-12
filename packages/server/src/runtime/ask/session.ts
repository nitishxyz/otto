import type { DB } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import {
	isProviderAuthorized,
	validateProviderModel,
	type OttoConfig,
	type ProviderId,
} from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { getRequestApiKey } from '../provider/credentials.ts';

/** Accepts a session authenticated by ephemeral request credentials without exporting them to env. */
export async function createAskSession(args: {
	db: DB;
	cfg: OttoConfig;
	agent: string;
	provider: ProviderId;
	model: string;
	allowUnknownModel?: boolean;
}) {
	validateProviderModel(args.provider, args.model, args.cfg, {
		allowUnknownModel: args.allowUnknownModel,
	});
	if (
		getRequestApiKey(args.provider) === undefined &&
		!(await isProviderAuthorized(args.cfg, args.provider))
	) {
		throw new Error(
			`Provider ${args.provider} is not configured. Run \`otto auth login\` to add credentials.`,
		);
	}
	const now = Date.now();
	const [session] = await args.db
		.insert(sessions)
		.values({
			id: crypto.randomUUID(),
			agent: args.agent,
			provider: args.provider,
			model: args.model,
			projectPath: args.cfg.projectRoot,
			createdAt: now,
			lastActiveAt: now,
			lastViewedAt: now,
			sessionType: 'main',
		})
		.returning();
	if (!session) throw new Error('Failed to create ask session');
	publish({
		type: 'session.created',
		sessionId: session.id,
		projectRoot: args.cfg.projectRoot,
		payload: session,
	});
	return session;
}
