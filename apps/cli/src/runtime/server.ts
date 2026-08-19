import { getDb } from '@ottocode/database';
import { loadConfig, logger } from '@ottocode/sdk';
import {
	bunWebSocket,
	createApp,
	setDaemonId,
	setDaemonRestartHandler,
	setDefaultProjectRoot,
	setServerPort,
	setServerVersion,
	shutdownActiveTunnels,
	shutdownProjectManager,
} from '@ottocode/server';
import { networkInterfaces } from 'node:os';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_DAEMON_PORT, parseDaemonPort } from '../daemon.ts';
import { createWebServer, createWebUIFetch } from '../web-server.ts';
import { parseOptionalCliPort } from './network.ts';

export type ServerRuntimeMode = 'foreground' | 'daemon' | 'embedded';
export type ServerWebMode = 'separate' | 'same-origin' | 'disabled';

type ApiFetch = NonNullable<Parameters<typeof Bun.serve>[0]['fetch']>;
type ApiWebSocket = NonNullable<Parameters<typeof Bun.serve>[0]['websocket']>;

export interface ServerRuntimeOptions {
	projectRoot: string;
	version?: string;
	mode: ServerRuntimeMode;
	webMode: ServerWebMode;
	port?: number;
	network?: boolean;
	daemonId?: string | null;
	env?: NodeJS.ProcessEnv;
	serve?: typeof Bun.serve;
}

export interface ServerRuntime {
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	port: number;
	apiUrl: string;
	loopbackApiUrl: string;
	web: {
		mode: ServerWebMode;
		url: string | null;
		running: boolean;
	};
	context: {
		hostname: string;
		displayHost: string;
		daemonId: string | null;
	};
	stop: () => Promise<void>;
}

function isApiRequest(request: Request): boolean {
	const pathname = new URL(request.url).pathname;
	return (
		pathname === '/v1' ||
		pathname.startsWith('/v1/') ||
		pathname === '/openapi.json'
	);
}

/** Routes API requests to Hono and browser requests to the embedded web UI. */
export function createSameOriginFetch(
	apiFetch: ApiFetch,
	webFetch: (request: Request) => Response | Promise<Response>,
): ApiFetch {
	const fetchApi = apiFetch as (
		request: Request,
		server: Bun.Server<undefined>,
	) => Response | Promise<Response>;
	return ((request: Request, server: Bun.Server<undefined>) =>
		isApiRequest(request)
			? fetchApi(request, server)
			: webFetch(request)) as ApiFetch;
}

function getLocalIP(): string {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === 'IPv4' && !address.internal)
				return address.address;
		}
	}
	return '0.0.0.0';
}

function requestedPort(options: ServerRuntimeOptions): number {
	const env = options.env ?? process.env;
	if (options.mode === 'daemon') {
		return (
			options.port ??
			parseDaemonPort(env.OTTO_DAEMON_PORT) ??
			DEFAULT_DAEMON_PORT
		);
	}
	return (
		options.port ?? parseOptionalCliPort(env.PORT, { allowZero: true }) ?? 0
	);
}

function createProjectStorageError(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	error: unknown,
): Error {
	const reason = error instanceof Error ? error.message : String(error);
	return new Error(
		[
			`Otto could not open its local project database at ${cfg.paths.dbPath}.`,
			`The current project needs a writable .otto directory under ${cfg.projectRoot}.`,
			`Make sure ${cfg.paths.dataDir} is writable, or rerun otto from a writable directory (or pass --project <path>).`,
			`Original error: ${reason}`,
		].join(' '),
	);
}

/** Starts the shared foreground/daemon HTTP runtime and owns resource shutdown. */
export async function createServerRuntime(
	options: ServerRuntimeOptions,
): Promise<ServerRuntime> {
	const resolvedProjectRoot = resolve(options.projectRoot);
	const projectRoot = await realpath(resolvedProjectRoot).catch(
		() => resolvedProjectRoot,
	);
	const cfg = await loadConfig(projectRoot);
	try {
		await getDb(cfg.projectRoot);
	} catch (error) {
		throw createProjectStorageError(cfg, error);
	}

	const daemonId =
		options.mode === 'daemon' ? (options.daemonId ?? null) : null;
	if (options.version !== undefined) setServerVersion(options.version);
	setDaemonId(daemonId);
	setDefaultProjectRoot(options.mode === 'daemon' ? null : cfg.projectRoot);
	setDaemonRestartHandler(null);

	const app = createApp();
	const hostname = options.network ? '0.0.0.0' : '127.0.0.1';
	const apiFetch =
		options.webMode === 'same-origin'
			? createSameOriginFetch(app.fetch, createWebUIFetch(null))
			: app.fetch;
	const serve = options.serve ?? Bun.serve;
	const listenPort = requestedPort(options);
	const apiServer = serve({
		port: listenPort,
		hostname,
		fetch: apiFetch,
		idleTimeout: 240,
		websocket: bunWebSocket as ApiWebSocket,
	});
	const port = apiServer.port ?? listenPort;
	setServerPort(port);

	const displayHost = options.network ? getLocalIP() : '127.0.0.1';
	const apiUrl = `http://${displayHost}:${port}`;
	const loopbackApiUrl = `http://127.0.0.1:${port}`;
	let webServer: ReturnType<typeof createWebServer>['server'] | null = null;
	let webUrl: string | null =
		options.webMode === 'same-origin' ? loopbackApiUrl : null;
	if (options.webMode === 'separate') {
		try {
			const started = createWebServer(
				port + 1,
				options.network ? port : apiUrl,
				Boolean(options.network),
			);
			webServer = started.server;
			webUrl = `http://${displayHost}:${started.port}`;
		} catch (error) {
			logger.error('Failed to start Web UI server', error);
		}
	}

	let stopPromise: Promise<void> | null = null;
	const stop = () => {
		stopPromise ??= (async () => {
			setDaemonRestartHandler(null);
			try {
				shutdownActiveTunnels();
			} catch (error) {
				logger.error('Error stopping tunnel processes', error);
			}
			try {
				await shutdownProjectManager();
			} catch (error) {
				logger.error('Error cleaning up project resources', error);
			}
			try {
				webServer?.stop(true);
			} catch (error) {
				logger.error('Error stopping web server', error);
			}
			try {
				apiServer.stop(true);
			} catch (error) {
				logger.error('Error stopping API server', error);
			}
		})();
		return stopPromise;
	};

	return {
		cfg,
		port,
		apiUrl,
		loopbackApiUrl,
		web: {
			mode: options.webMode,
			url: webUrl,
			running: options.webMode === 'same-origin' || webServer !== null,
		},
		context: { hostname, displayHost, daemonId },
		stop,
	};
}
