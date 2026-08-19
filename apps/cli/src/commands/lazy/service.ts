import type { Command } from 'commander';
import { parseCliPort } from '../../runtime/network.ts';
import type { ServiceOptions } from '../service.ts';

export function registerServiceCommand(program: Command, version: string) {
	const service = program
		.command('service')
		.description('Manage the shared local otto daemon');

	service
		.command('start')
		.description('Start or reuse the local daemon')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', (value) =>
			parseCliPort(value, { allowZero: false, name: 'daemon port' }),
		)
		.action(async (opts: ServiceOptions) => {
			const { startService } = await import('../service.ts');
			await startService(opts, version);
		});

	service
		.command('status')
		.description('Show local daemon status')
		.action(async () => {
			const { showServiceStatus } = await import('../service.ts');
			await showServiceStatus(version);
		});

	service
		.command('stop')
		.description('Stop the local daemon if running')
		.action(async () => {
			const { stopService } = await import('../service.ts');
			await stopService();
		});

	service
		.command('restart')
		.description('Restart the local daemon')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', (value) =>
			parseCliPort(value, { allowZero: false, name: 'daemon port' }),
		)
		.action(async (opts: ServiceOptions) => {
			const { restartService } = await import('../service.ts');
			await restartService(opts, version);
		});

	service
		.command('password')
		.description('Rotate and print the local daemon token')
		.action(async () => {
			const { rotateServicePassword } = await import('../service.ts');
			await rotateServicePassword();
		});

	service
		.command('token')
		.description('Print the current local daemon token')
		.action(async () => {
			const { printServiceToken } = await import('../service.ts');
			await printServiceToken();
		});

	service
		.command('force-start')
		.description('Start a new daemon without reusing an existing registration')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', (value) =>
			parseCliPort(value, { allowZero: false, name: 'daemon port' }),
		)
		.action(async (opts: ServiceOptions) => {
			const { forceStartService } = await import('../service.ts');
			await forceStartService(opts, version);
		});
}
