import type { Command } from 'commander';
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

export function registerAskCommand(program: Command) {
	program
		.command('ask [prompt]')
		.alias('run')
		.alias('do')
		.alias('a')
		.description('One-shot ask (or interactive if no prompt)')
		.option('--agent <name>', 'Override agent')
		.option(
			'--provider <provider>',
			'Override provider (openai, anthropic, google, openrouter, opencode, ottorouter)',
		)
		.option('--model <model>', 'Override model')
		.option('--wild', 'Allow uncataloged model id (default with --model)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--last', 'Continue most recent session', false)
		.option('--session <id>', 'Continue specific session')
		.option('-y, --yes', 'Auto-approve all tool executions')
		.action(async (prompt, opts, command) => {
			const parentOpts = command.parent?.opts() ?? {};
			await handleAsk(prompt, {
				agent: opts.agent ?? parentOpts.agent,
				provider: (opts.provider ?? parentOpts.provider) as
					| ProviderId
					| undefined,
				model: opts.model ?? parentOpts.model,
				wild: opts.wild,
				project: opts.project,
				last: opts.last,
				session: opts.session,
			});
		});
}
