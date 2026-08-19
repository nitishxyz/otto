import type { Command } from 'commander';

interface TunnelOptions {
	project?: string;
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
			.action(async (opts: TunnelOptions) => {
				const handlers = await import('../tunnel.ts');
				if (action === 'enable')
					await handlers.enableTunnel(version, opts.project);
				else if (action === 'disable')
					await handlers.disableTunnel(version, opts.project);
				else await handlers.showTunnelStatus(version, opts.project);
			});
	}
}
