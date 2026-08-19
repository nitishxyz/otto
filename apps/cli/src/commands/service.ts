import {
	ensureDaemon,
	getDaemonStatus,
	readDaemonToken,
	restartDaemon,
	rotateDaemonPassword,
	startDaemon,
	stopDaemon,
} from '../daemon.ts';

export interface ServiceOptions {
	project?: string;
	port?: number;
}

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

export async function startService(opts: ServiceOptions, version: string) {
	const registration = await ensureDaemon({
		version,
		projectRoot: opts.project,
		port: opts.port,
	});
	console.log(`otto daemon running at ${registration.url}`);
}

export async function showServiceStatus(version: string) {
	printStatus(await getDaemonStatus({ version }));
}

export async function stopService() {
	const stopped = await stopDaemon({});
	console.log(stopped ? 'otto daemon stopped' : 'otto daemon not running');
}

export async function restartService(opts: ServiceOptions, version: string) {
	const registration = await restartDaemon({
		version,
		projectRoot: opts.project,
		port: opts.port,
	});
	console.log(`otto daemon restarted at ${registration.url}`);
}

export async function rotateServicePassword() {
	const token = await rotateDaemonPassword();
	console.log(token);
}

export async function printServiceToken() {
	const token = await readDaemonToken();
	if (!token) throw new Error('No daemon token exists.');
	console.log(token);
}

export async function forceStartService(opts: ServiceOptions, version: string) {
	const registration = await startDaemon({
		version,
		projectRoot: opts.project,
		port: opts.port,
	});
	console.log(`otto daemon started at ${registration.url}`);
}
