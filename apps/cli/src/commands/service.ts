import type { Command } from 'commander';
import {
	ensureDaemon,
	getDaemonStatus,
	parseDaemonPort,
	readDaemonToken,
	restartDaemon,
	rotateDaemonPassword,
	startDaemon,
	stopDaemon,
} from '../daemon.ts';

type ServiceOptions = {
	project?: string;
	port?: number;
};

function printStatus(status: Awaited<ReturnType<typeof getDaemonStatus>>) {
	if (status.state === 'running') {
		console.log('otto daemon running');
		console.log(`  url: ${status.registration.url}`);
		console.log(`  pid: ${status.registration.pid}`);
		console.log(`  id: ${status.registration.id}`);
		console.log(`  version: ${status.registration.version}`);
		return;
	}
	if (status.state === 'stale') {
		console.log(`otto daemon stale: ${status.reason}`);
		return;
	}
	console.log('otto daemon not running');
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
		.option('--port <port>', 'Preferred daemon port', parseDaemonPort)
		.action(async (opts: ServiceOptions) => {
			const registration = await ensureDaemon({
				version,
				projectRoot: opts.project,
				port: opts.port,
			});
			console.log(`otto daemon running at ${registration.url}`);
		});

	service
		.command('status')
		.description('Show local daemon status')
		.action(async () => {
			printStatus(await getDaemonStatus({ version }));
		});

	service
		.command('stop')
		.description('Stop the local daemon if running')
		.action(async () => {
			const stopped = await stopDaemon({});
			console.log(stopped ? 'otto daemon stopped' : 'otto daemon not running');
		});

	service
		.command('restart')
		.description('Restart the local daemon')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', parseDaemonPort)
		.action(async (opts: ServiceOptions) => {
			const registration = await restartDaemon({
				version,
				projectRoot: opts.project,
				port: opts.port,
			});
			console.log(`otto daemon restarted at ${registration.url}`);
		});

	service
		.command('password')
		.description('Rotate and print the local daemon token')
		.action(async () => {
			const status = await getDaemonStatus({ version });
			if (status.state === 'running') {
				throw new Error('Stop the daemon before rotating its token.');
			}
			const token = await rotateDaemonPassword();
			console.log(token);
		});

	service
		.command('token')
		.description('Print the current local daemon token')
		.action(async () => {
			const token = await readDaemonToken();
			if (!token) throw new Error('No daemon token exists.');
			console.log(token);
		});

	service
		.command('force-start')
		.description('Start a new daemon without reusing an existing registration')
		.option(
			'--project <path>',
			'Initial project for daemon startup',
			process.cwd(),
		)
		.option('--port <port>', 'Preferred daemon port', parseDaemonPort)
		.action(async (opts: ServiceOptions) => {
			const registration = await startDaemon({
				version,
				projectRoot: opts.project,
				port: opts.port,
			});
			console.log(`otto daemon started at ${registration.url}`);
		});
}
