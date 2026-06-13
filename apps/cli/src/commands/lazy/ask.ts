import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

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
		.action(async (prompt, opts) => {
			const argv = ['ask'];
			if (prompt) argv.push(prompt);
			pushOption(argv, '--agent', opts.agent);
			pushOption(argv, '--provider', opts.provider);
			pushOption(argv, '--model', opts.model);
			pushFlag(argv, '--wild', opts.wild);
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--last', opts.last);
			pushOption(argv, '--session', opts.session);
			pushFlag(argv, '--yes', opts.yes);
			const { registerAskCommand: register } = await import('../ask.ts');
			await dispatchRegisteredCommand(register, argv);
		});
}
