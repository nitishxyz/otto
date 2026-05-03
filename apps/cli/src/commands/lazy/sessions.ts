import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushFlag, pushOption } from './helpers.ts';

export function registerSessionsCommand(program: Command) {
	program
		.command('sessions')
		.description('Manage or pick sessions (default: pick)')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.option('--json', 'Output as JSON', false)
		.option('--list', 'List sessions without interactive picker', false)
		.option('--pick', 'Show interactive session picker', false)
		.option('--limit <n>', 'Limit number of sessions', (v) =>
			Number.parseInt(v, 10),
		)
		.action(async (opts) => {
			const argv = ['sessions'];
			pushOption(argv, '--project', opts.project);
			pushFlag(argv, '--json', opts.json);
			pushFlag(argv, '--list', opts.list);
			pushFlag(argv, '--pick', opts.pick);
			pushOption(argv, '--limit', opts.limit);
			const { registerSessionsCommand: register } = await import(
				'../sessions.ts'
			);
			await dispatchRegisteredCommand(register, argv);
		});
}
