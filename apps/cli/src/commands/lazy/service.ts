import type { Command } from 'commander';
import { dispatchRegisteredCommand, pushOption } from './helpers.ts';

async function dispatch(argv: string[], version: string) {
	const { registerServiceCommand } = await import('../service.ts');
	await dispatchRegisteredCommand(
		(program) => registerServiceCommand(program, version),
		argv,
	);
}

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
		.option('--port <port>', 'Preferred daemon port', (v) =>
			Number.parseInt(v, 10),
		)
		.action(async (opts) => {
			const argv = ['service', 'start'];
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--port', opts.port);
			await dispatch(argv, version);
		});

	service
		.command('status')
		.description('Show local daemon status')
		.action(async () => {
			await dispatch(['service', 'status'], version);
		});

	service
		.command('stop')
		.description('Stop the local daemon if running')
		.action(async () => {
			await dispatch(['service', 'stop'], version);
		});

	service
		.command('restart')
		.description('Restart the local daemon')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', (v) =>
			Number.parseInt(v, 10),
		)
		.action(async (opts) => {
			const argv = ['service', 'restart'];
			pushOption(argv, '--project', opts.project);
			pushOption(argv, '--port', opts.port);
			await dispatch(argv, version);
		});

	service
		.command('password')
		.description('Rotate and print the local daemon token')
		.action(async () => {
			await dispatch(['service', 'password'], version);
		});

	service
		.command('token')
		.description('Print the current local daemon token')
		.action(async () => {
			await dispatch(['service', 'token'], version);
		});
}
