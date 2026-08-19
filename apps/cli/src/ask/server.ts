import { client } from '@ottocode/api';
import PKG from '../../package.json' with { type: 'json' };
import {
	ensureDaemonProject,
	openProjectOnServer,
	readDaemonToken,
	type OpenProjectContext,
} from '../daemon.ts';
import { createServerRuntime, type ServerRuntime } from '../runtime/server.ts';

let currentServer: ServerRuntime | null = null;

export async function startEphemeralServer(): Promise<string> {
	if (currentServer) return currentServer.loopbackApiUrl;
	currentServer = await createServerRuntime({
		projectRoot: process.cwd(),
		mode: 'embedded',
		webMode: 'disabled',
		port: 0,
	});
	const url = currentServer.loopbackApiUrl;
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
		await currentServer.stop();
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
