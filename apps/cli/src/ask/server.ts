import {
	createApp,
	bunWebSocket,
	setDefaultProjectRoot,
} from '@ottocode/server';
import { client } from '@ottocode/api';
import PKG from '../../package.json' with { type: 'json' };
import {
	ensureDaemonProject,
	openProjectOnServer,
	readDaemonToken,
	type OpenProjectContext,
} from '../daemon.ts';

let currentServer: ReturnType<typeof Bun.serve> | null = null;

export async function startEphemeralServer(): Promise<string> {
	if (currentServer) return `http://localhost:${currentServer.port}`;
	setDefaultProjectRoot(process.cwd());
	const app = createApp();
	currentServer = Bun.serve({
		port: 0,
		fetch: app.fetch,
		idleTimeout: 240,
		websocket: bunWebSocket,
	});
	const url = `http://localhost:${currentServer.port}`;
	configureClient(url);
	return url;
}

export async function getOrStartServerContext(
	projectRoot: string,
): Promise<OpenProjectContext> {
	if (process.env.OTTO_SERVER_URL) {
		const url = String(process.env.OTTO_SERVER_URL);
		const context = await openProjectOnServer({
			baseUrl: url,
			projectRoot,
			token: await readDaemonToken(),
		});
		configureClient(context.baseUrl, context);
		return context;
	}
	const context = await ensureDaemonProject({
		version: (PKG as { version: string }).version,
		projectRoot,
	});
	configureClient(context.baseUrl, context);
	return context;
}

export async function getOrStartServerUrl(): Promise<string> {
	return (await getOrStartServerContext(process.cwd())).baseUrl;
}

export async function ensureServer(
	projectRoot = process.cwd(),
): Promise<string> {
	return (await getOrStartServerContext(projectRoot)).baseUrl;
}

export async function stopEphemeralServer(): Promise<void> {
	if (currentServer) {
		try {
			currentServer.stop();
		} catch {}
		currentServer = null;
	}
}

function configureClient(baseURL: string, context?: OpenProjectContext) {
	client.setConfig({
		baseURL,
		adapter: 'fetch',
		headers: context
			? {
					...context.authHeaders,
					'X-Otto-Project-Id': context.projectId,
					'X-Otto-Project': context.projectRoot,
				}
			: undefined,
	});
}
