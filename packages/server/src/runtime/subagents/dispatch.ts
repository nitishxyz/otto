import type { DB } from '@ottocode/database';
import type { OttoConfig, ProviderId } from '@ottocode/sdk';
import type { DispatchOptions } from '../message/types.ts';

type SessionForDispatch = DispatchOptions['session'];

export async function dispatchSubagentMessage(args: {
	cfg: OttoConfig;
	db: DB;
	session: SessionForDispatch;
	agent: string;
	content: string;
}) {
	const { dispatchAssistantMessage } = await import('../message/service.ts');
	return dispatchAssistantMessage({
		cfg: args.cfg,
		db: args.db,
		session: args.session,
		agent: args.agent,
		provider: args.session.provider as ProviderId,
		model: args.session.model,
		content: args.content,
	});
}
