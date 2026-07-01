import type { Command } from 'commander';
import { dispatchVersionedCommand, pushFlag, pushOption } from './helpers.ts';

export function registerServeCommand(program: Command, version: string) {
	program
		.command('serve')
		.description('Advanced: run a standalone foreground API/Web server')
		.option('-p, --port <port>', 'Port to listen on', (v) =>
			Number.parseInt(v, 10),
		)
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--tunnel', 'Enable Cloudflare tunnel for remote access', false)
		.option('--api-only', 'Start only the API server without Web UI', false)
		.option(
			'--daemon-register',
			'Register this server as the local daemon',
			false,
		)
		.option('--no-open', 'Do not open browser automatically')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['serve'];
			pushOption(argv, '--port', opts.port);
			pushFlag(argv, '--network', opts.network);
			pushFlag(argv, '--tunnel', opts.tunnel);
			pushFlag(argv, '--api-only', opts.apiOnly);
			pushFlag(argv, '--daemon-register', opts.daemonRegister);
			pushFlag(argv, '--no-open', !opts.open);
			pushOption(argv, '--project', opts.project);
			const { registerServeCommand: register } = await import('../serve.ts');
			await dispatchVersionedCommand(register, version, argv);
		});
}
