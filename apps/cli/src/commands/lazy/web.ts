import { Option, type Command } from 'commander';
import { parseCliPort } from '../../runtime/network.ts';
import type { WebOptions } from '../web.ts';

export interface WebCommandOptions {
	url?: string;
	api?: string;
	port?: number;
	network: boolean;
	open: boolean;
	project?: string;
}

export function toWebOptions(opts: WebCommandOptions): WebOptions {
	return {
		url: opts.url,
		api: opts.api,
		port: opts.port,
		network: opts.network,
		noOpen: !opts.open,
		project: opts.project,
	};
}

export function registerWebCommand(program: Command, version: string) {
	program
		.command('web')
		.description('Open Web UI for this project')
		.option(
			'--url <api-url>',
			'Use an existing API server instead of the local daemon',
		)
		.addOption(
			new Option('--api <url>', 'Deprecated alias for --url').hideHelp(),
		)
		.option('-p, --port <port>', 'Web UI port', (value) =>
			parseCliPort(value, { allowZero: true }),
		)
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--no-open', 'Do not open browser automatically')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts: WebCommandOptions) => {
			const { handleWeb } = await import('../web.ts');
			await handleWeb(toWebOptions(opts), version);
		});
}
