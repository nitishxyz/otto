import type { Command } from 'commander';
import type { ProviderId } from '@ottocode/sdk';

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
			const { handleAsk } = await import('../ask.ts');
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
