import type { ProviderId } from '@ottocode/sdk';
import { intro, outro, text, isCancel, cancel } from '@clack/prompts';
import { runAsk } from '../ask.ts';
import { ensureAuth } from '../middleware/with-auth.ts';

export interface AskOptions {
	agent?: string;
	provider?: ProviderId;
	model?: string;
	wild?: boolean;
	project: string;
	last: boolean;
	session?: string;
}

export async function handleAsk(prompt: string | undefined, opts: AskOptions) {
	const projectRoot = opts.project;

	if (!(await ensureAuth(projectRoot))) return;

	if (prompt) {
		await runAsk(prompt, {
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			wild: opts.wild,
			project: opts.project,
			last: opts.last,
			sessionId: opts.session,
		});
		return;
	}

	intro('otto ask');
	const input = await text({ message: 'What would you like to ask?' });
	if (isCancel(input)) return cancel('Cancelled');
	const userPrompt = String(input ?? '').trim();
	if (!userPrompt) {
		outro('No input provided. Exiting.');
		return;
	}

	await runAsk(userPrompt, {
		project: projectRoot,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		wild: opts.wild,
		last: opts.last,
		sessionId: opts.session,
	});
}

export { registerAskCommand } from './lazy/ask.ts';
