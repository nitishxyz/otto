import type { Command } from 'commander';
import { parseCliPort } from '../../runtime/network.ts';
import type { ServeOptions } from '../serve.ts';

export interface ServeCommandOptions {
	project: string;
	port?: number;
	network: boolean;
	open: boolean;
	tunnel: boolean;
	apiOnly: boolean;
	daemonRegister?: boolean;
}

export function toServeOptions(opts: ServeCommandOptions): ServeOptions {
	return {
		project: opts.project,
		port: opts.port,
		network: opts.network,
		tunnel: opts.tunnel,
		noOpen: !opts.open,
		apiOnly: opts.apiOnly,
		daemonRegister: opts.daemonRegister,
	};
}

export function registerServeCommand(program: Command, version: string) {
	program
		.command('serve')
		.description('Advanced: run a standalone foreground API/Web server')
		.option('-p, --port <port>', 'Port to listen on', (value) =>
			parseCliPort(value, { allowZero: true }),
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
		.action(async (opts: ServeCommandOptions) => {
			const { handleServe } = await import('../serve.ts');
			await handleServe(toServeOptions(opts), version);
		});
}
