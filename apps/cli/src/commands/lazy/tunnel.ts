import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushOption } from './helpers.ts';

async function dispatch(argv: string[], version: string) {
	const { registerTunnelCommand } = await import('../tunnel.ts');
	await dispatchRegisteredCommand(
		(program) => registerTunnelCommand(program, version),
		argv,
	);
}

export function registerTunnelCommand(program: Command, version: string) {
	const tunnel = program
		.command('tunnel')
		.description('Manage global machine-sharing access');

	for (const action of ['enable', 'status', 'disable'] as const) {
		tunnel
			.command(action)
			.description(
				action === 'enable'
					? 'Enable persistent machine-sharing access'
					: action === 'disable'
						? 'Disable persistent machine-sharing access'
						: 'Show machine-sharing tunnel status',
			)
			.option(
				'--project <path>',
				'Project used to start the daemon',
				process.cwd(),
			)
			.action(async (opts) => {
				const argv = ['tunnel', action];
				pushOption(argv, '--project', opts.project);
				await dispatch(argv, version);
			});
	}
}
