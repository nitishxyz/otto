import type { Command } from 'commander';
import { dispatchVersionedCommand, pushFlag, pushOption } from './helpers.ts';

export function registerWebCommand(program: Command, version: string) {
	program
		.command('web')
		.description('Start Web UI only, connected to a remote API server')
		.requiredOption('--api <url>', 'API server URL to connect to')
		.option('-p, --port <port>', 'Web UI port', (v) => Number.parseInt(v, 10))
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--no-open', 'Do not open browser automatically')
		.action(async (opts) => {
			const argv = ['web'];
			pushOption(argv, '--api', opts.api);
			pushOption(argv, '--port', opts.port);
			pushFlag(argv, '--network', opts.network);
			pushFlag(argv, '--no-open', !opts.open);
			const { registerWebCommand: register } = await import('../web.ts');
			await dispatchVersionedCommand(register, version, argv);
		});
}
