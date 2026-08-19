import { openAuthUrl, logger, printQRCode } from '@ottocode/sdk';
import {
	setDaemonRestartHandler,
	restoreManagedTunnel,
	bunWebSocket,
	type DaemonRestartRequest,
} from '@ottocode/server';
import { startTunnel } from '@ottocode/api';
import {
	fetchDaemonHealth,
	spawnDaemonProcess,
	waitForDaemonPortRelease,
	readDaemonRegistration,
	writeActiveDaemonSelection,
} from '../daemon.ts';
import { validateCliPort } from '../runtime/network.ts';
import { createServerRuntime } from '../runtime/server.ts';
import { colors } from '../ui.ts';

export { createSameOriginFetch } from '../runtime/server.ts';

export interface StartServerResult {
	port: number;
	webUrl?: string;
	stop: () => Promise<void>;
}

type ApiWebSocket = NonNullable<Parameters<typeof Bun.serve>[0]['websocket']>;

/** Spawns the detached successor after the current daemon releases its port. */
export function spawnDaemonReplacement(options: {
	projectRoot: string;
	executable: string;
	port: number;
	daemonId: string;
	spawn?: typeof Bun.spawn;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): ReturnType<typeof Bun.spawn> {
	return spawnDaemonProcess(options);
}

/** Waits until the successor owns registration and answers authenticated health. */
export async function waitForDaemonReplacement(options: {
	process: ReturnType<typeof Bun.spawn>;
	daemonId: string;
	version: string;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
	let exited = false;
	void options.process.exited.then(() => {
		exited = true;
	});
	const deadline = Date.now() + (options.timeoutMs ?? 15_000);
	const sleep = options.sleep ?? Bun.sleep;
	while (Date.now() < deadline) {
		if (exited) throw new Error('Replacement daemon exited before startup');
		const registration = await readDaemonRegistration();
		if (
			registration?.id === options.daemonId &&
			registration.pid === options.process.pid &&
			registration.version === options.version
		) {
			const health = await fetchDaemonHealth(registration);
			if (
				health?.daemonId === options.daemonId &&
				health.pid === options.process.pid &&
				health.version === options.version
			) {
				return;
			}
		}
		await sleep(150);
	}
	throw new Error('Timed out waiting for replacement daemon');
}

export function serveApi(options: {
	port: number;
	hostname: string;
	fetch: NonNullable<Parameters<typeof Bun.serve>[0]['fetch']>;
	serve?: typeof Bun.serve;
}) {
	const serve = options.serve ?? Bun.serve;
	return serve({
		port: options.port,
		hostname: options.hostname,
		fetch: options.fetch,
		idleTimeout: 240,
		websocket: bunWebSocket as ApiWebSocket,
	});
}

export async function startApiServer(opts: {
	project: string;
	port?: number;
}): Promise<StartServerResult> {
	const runtime = await createServerRuntime({
		projectRoot: opts.project,
		mode: 'embedded',
		webMode: 'separate',
		port: opts.port,
	});
	return {
		port: runtime.port,
		webUrl: runtime.web.url ?? undefined,
		stop: runtime.stop,
	};
}

export interface ServeOptions {
	project: string;
	port?: number;
	network: boolean;
	noOpen: boolean;
	tunnel: boolean;
	apiOnly: boolean;
	daemonRegister?: boolean;
}

export async function handleServe(opts: ServeOptions, version: string) {
	if (opts.daemonRegister && opts.port !== undefined) {
		validateCliPort(opts.port, { allowZero: false, name: 'daemon port' });
	}
	const daemonId = opts.daemonRegister
		? process.env.OTTO_DAEMON_ID || crypto.randomUUID()
		: null;
	const runtime = await createServerRuntime({
		projectRoot: opts.project,
		version,
		mode: opts.daemonRegister ? 'daemon' : 'foreground',
		webMode: opts.daemonRegister
			? 'same-origin'
			: opts.apiOnly
				? 'disabled'
				: 'separate',
		port: opts.port,
		network: opts.network,
		daemonId,
	});
	const serverPort = runtime.port;
	const apiUrl = runtime.apiUrl;
	const webUrl = opts.daemonRegister ? null : runtime.web.url;

	if (opts.daemonRegister) {
		const { writeDaemonRegistrationFromServer } = await import('../daemon.ts');
		await writeDaemonRegistrationFromServer({
			id: daemonId as string,
			version,
			url: runtime.loopbackApiUrl,
			pid: process.pid,
			startedAt: Date.now(),
		});
		void restoreManagedTunnel().catch((error) => {
			logger.error('Managed tunnel restore failed', error);
		});
	}

	let tunnelUrl: string | null = null;

	if (opts.tunnel) {
		try {
			console.log(colors.dim('  Starting tunnel...'));

			const response = await startTunnel({
				baseURL: apiUrl,
				body: {},
			});
			if (response.error) throw new Error(JSON.stringify(response.error));

			const result = response.data as {
				ok: boolean;
				url?: string;
				error?: string;
			};

			if (result.ok && result.url) {
				tunnelUrl = result.url;
			} else {
				const errorMsg = result.error || 'Unknown error';
				if (errorMsg.includes('Rate limited')) {
					console.log(colors.yellow('  ⚠ Rate limited by Cloudflare'));
					console.log(
						colors.dim('    Please wait 5-10 minutes before trying again'),
					);
				} else {
					console.log(colors.dim(`  Tunnel failed: ${errorMsg}`));
				}
			}
		} catch (error) {
			const _errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Failed to start tunnel', error);
			console.log(
				colors.dim('  Tunnel failed, continuing without remote access'),
			);
		}
	}

	console.log('');
	console.log(colors.bold('  ⚡ otto') + colors.dim(` v${version}`));
	console.log('');
	console.log(`  ${colors.dim('API')}     ${colors.cyan(apiUrl)}`);
	if (webUrl) {
		console.log(`  ${colors.dim('Web UI')}  ${colors.cyan(webUrl)}`);
	}
	if (tunnelUrl) {
		console.log(`  ${colors.dim('Tunnel')}  ${colors.green(tunnelUrl)}`);
	}
	if (opts.network) {
		console.log('');
		console.log(
			colors.dim(`  Also accessible at http://localhost:${serverPort}`),
		);
	}
	console.log('');
	console.log(colors.dim('  Press Ctrl+C to stop'));
	console.log('');

	if (tunnelUrl) {
		await printQRCode(tunnelUrl, 'Scan to connect from mobile:');
	}

	if (webUrl && !opts.noOpen) {
		const opened = await openAuthUrl(webUrl);
		if (!opened) {
			console.log(colors.dim(`  Could not open browser automatically`));
		}
	}

	let shuttingDown = false;
	const cleanup = runtime.stop;

	const shutdown = async (signal: NodeJS.Signals) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`\nReceived ${signal}, shutting down...`);
		await cleanup();

		process.exit(0);
	};

	const restart = async (request: DaemonRestartRequest) => {
		console.log('\nRestarting managed daemon...');
		await cleanup();
		const executable = request.executable ?? process.execPath;
		const expectedVersion = request.targetVersion ?? version;
		const daemonId = crypto.randomUUID();
		let replacement: ReturnType<typeof Bun.spawn> | null = null;
		try {
			await waitForDaemonPortRelease({ port: serverPort });
			replacement = spawnDaemonReplacement({
				projectRoot: runtime.cfg.projectRoot,
				executable,
				port: serverPort,
				daemonId,
			});
			await waitForDaemonReplacement({
				process: replacement,
				daemonId,
				version: expectedVersion,
			});
			if (request.executable && request.targetVersion) {
				await writeActiveDaemonSelection({
					path: request.executable,
					version: request.targetVersion,
				});
			}
			process.exit(0);
		} catch (error) {
			logger.error('Replacement daemon failed to start', error);
			if (request.executable && request.executable !== process.execPath) {
				try {
					if (replacement) {
						replacement.kill('SIGTERM');
						await Promise.race([replacement.exited, Bun.sleep(2000)]);
					}
					await waitForDaemonPortRelease({ port: serverPort });
					const rollbackId = crypto.randomUUID();
					const rollback = spawnDaemonReplacement({
						projectRoot: runtime.cfg.projectRoot,
						executable: process.execPath,
						port: serverPort,
						daemonId: rollbackId,
					});
					await waitForDaemonReplacement({
						process: rollback,
						daemonId: rollbackId,
						version,
					});
				} catch (rollbackError) {
					logger.error('Failed to roll back daemon executable', rollbackError);
				}
			}
			process.exit(1);
		}
	};

	if (opts.daemonRegister) {
		setDaemonRestartHandler((request) => {
			if (shuttingDown) throw new Error('Daemon restart already in progress');
			shuttingDown = true;
			// Let the accepted response flush before closing the API and tunnel.
			setTimeout(() => void restart(request), 300);
		});
	}

	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);

	await new Promise(() => {});
}
