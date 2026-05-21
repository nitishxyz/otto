import type { Command } from 'commander';
import {
	loadConfig,
	getTerminalManager,
	openAuthUrl,
	logger,
	printQRCode,
} from '@ottocode/sdk';
import {
	createApp as createServer,
	setServerPort,
	bunWebSocket,
} from '@ottocode/server';
import { getDb } from '@ottocode/database';
import { startTunnel, stopTunnel } from '@ottocode/api';
import { createWebServer } from '../web-server.ts';
import { colors } from '../ui.ts';

export interface StartServerResult {
	port: number;
	webUrl?: string;
	stop: () => Promise<void>;
}

function createProjectStorageError(
	projectRoot: string,
	dataDir: string,
	dbPath: string,
	error: unknown,
): Error {
	const reason = error instanceof Error ? error.message : String(error);
	return new Error(
		[
			`Otto could not open its local project database at ${dbPath}.`,
			`The current project needs a writable .otto directory under ${projectRoot}.`,
			`Make sure ${dataDir} is writable, or rerun otto from a writable directory (or pass --project <path>).`,
			`Original error: ${reason}`,
		].join(' '),
	);
}

async function ensureProjectStorage(projectRoot: string) {
	const cfg = await loadConfig(projectRoot);
	try {
		await getDb(cfg.projectRoot);
	} catch (error) {
		throw createProjectStorageError(
			cfg.projectRoot,
			cfg.paths.dataDir,
			cfg.paths.dbPath,
			error,
		);
	}
	return cfg;
}

async function activateProject(projectRoot: string): Promise<void> {
	process.chdir(projectRoot);
	await ensureProjectStorage(process.cwd());
}

export async function startApiServer(opts: {
	project: string;
	port?: number;
}): Promise<StartServerResult> {
	await activateProject(opts.project);

	const app = createServer();
	const portEnv = process.env.PORT ? Number(process.env.PORT) : undefined;
	const requestedPort = opts.port ?? portEnv ?? 0;

	const agiServer = Bun.serve({
		port: requestedPort,
		hostname: '127.0.0.1',
		fetch: app.fetch,
		idleTimeout: 240,
		websocket: bunWebSocket,
	});

	const serverPort = agiServer.port ?? requestedPort;
	const apiUrl = `http://127.0.0.1:${serverPort}`;
	setServerPort(serverPort);

	let webServer: ReturnType<typeof createWebServer>['server'] | null = null;
	let webUrl: string | undefined;
	try {
		const { port: actualWebPort, server } = createWebServer(
			serverPort + 1,
			apiUrl,
			false,
		);
		webServer = server;
		webUrl = `http://127.0.0.1:${actualWebPort}`;
	} catch (error) {
		logger.error('Failed to start Web UI server', error);
	}

	const stop = async () => {
		try {
			const terminalManager = getTerminalManager();
			if (terminalManager) await terminalManager.killAll();
		} catch {}
		try {
			webServer?.stop(true);
		} catch {}
		try {
			agiServer.stop(true);
		} catch {}
	};

	return { port: serverPort, webUrl, stop };
}

function getLocalIP(): string {
	try {
		const { networkInterfaces } = require('node:os');
		const nets = networkInterfaces();
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
				if (net.family === 'IPv4' && !net.internal) {
					return net.address;
				}
			}
		}
	} catch {}
	return '0.0.0.0';
}

export interface ServeOptions {
	project: string;
	port?: number;
	network: boolean;
	noOpen: boolean;
	tunnel: boolean;
	apiOnly: boolean;
}

export async function handleServe(opts: ServeOptions, version: string) {
	await activateProject(opts.project);

	const app = createServer();
	const portEnv = process.env.PORT ? Number(process.env.PORT) : undefined;
	const requestedPort = opts.port ?? portEnv ?? 0;
	const hostname = opts.network ? '0.0.0.0' : '127.0.0.1';

	const agiServer = Bun.serve({
		port: requestedPort,
		hostname,
		fetch: app.fetch,
		idleTimeout: 240,
		websocket: bunWebSocket,
	});

	const displayHost = opts.network ? getLocalIP() : '127.0.0.1';
	const serverPort = agiServer.port ?? requestedPort;
	const apiUrl = `http://${displayHost}:${serverPort}`;

	// Register server port so tunnel routes can use it
	setServerPort(serverPort);

	let webServer: ReturnType<typeof createWebServer>['server'] | null = null;
	let webUrl: string | null = null;
	if (!opts.apiOnly) {
		try {
			const { port: actualWebPort, server } = createWebServer(
				serverPort + 1,
				opts.network ? serverPort : apiUrl,
				opts.network,
			);
			webServer = server;
			webUrl = `http://${displayHost}:${actualWebPort}`;
		} catch (error) {
			logger.error('Failed to start Web UI server', error);
			console.log('   otto server is still running without Web UI');
		}
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
	const shutdown = async (signal: NodeJS.Signals) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`\nReceived ${signal}, shutting down...`);

		// Stop tunnel via server endpoint
		try {
			await stopTunnel({
				baseURL: apiUrl,
			});
		} catch {
			// Ignore - server may already be stopping
		}

		try {
			const terminalManager = getTerminalManager();
			if (terminalManager) {
				await terminalManager.killAll();
			}
		} catch (error) {
			logger.error('Error cleaning up terminals', error);
		}

		try {
			webServer?.stop(true);
		} catch (error) {
			logger.error('Error stopping web server', error);
		}

		try {
			agiServer.stop(true);
		} catch (error) {
			logger.error('Error stopping API server', error);
		}

		process.exit(0);
	};

	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);

	await new Promise(() => {});
}

export function registerServeCommand(program: Command, version: string) {
	program
		.command('serve')
		.description('Start API server + Web UI')
		.option('-p, --port <port>', 'Port to listen on', (v) =>
			Number.parseInt(v, 10),
		)
		.option('--network', 'Bind to 0.0.0.0 for network access', false)
		.option('--tunnel', 'Enable Cloudflare tunnel for remote access', false)
		.option('--api-only', 'Start only the API server without Web UI', false)
		.option('--no-open', 'Do not open browser automatically')
		.option('--project <path>', 'Use project at <path>', process.cwd())
		.action(async (opts) => {
			await handleServe(
				{
					project: opts.project,
					port: opts.port,
					network: opts.network,
					tunnel: opts.tunnel,
					noOpen: !opts.open,
					apiOnly: opts.apiOnly,
				},
				version,
			);
		});
}
