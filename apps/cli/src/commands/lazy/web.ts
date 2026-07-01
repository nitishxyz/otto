import { Option, type Command } from 'commander';
import { dispatchVersionedCommand, pushFlag, pushOption } from './helpers.ts';

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
		.option('-p, --port <port>', 'Web UI port', (v) => Number.parseInt(v, 10))
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--no-open', 'Do not open browser automatically')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			const argv = ['web'];
			pushOption(argv, '--url', opts.url);
			pushOption(argv, '--api', opts.api);
			pushOption(argv, '--port', opts.port);
			pushFlag(argv, '--network', opts.network);
			pushFlag(argv, '--no-open', !opts.open);
			pushOption(argv, '--project', opts.project);
			const { registerWebCommand: register } = await import('../web.ts');
			await dispatchVersionedCommand(register, version, argv);
		});
}
