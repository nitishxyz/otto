import { client } from '@ottocode/api';
import { createApp, bunWebSocket } from '@ottocode/server';

let currentServer: ReturnType<typeof Bun.serve> | null = null;
let configuredBaseUrl: string | null = null;

/**
 * Ensure ACP talks to otto through the HTTP API surface.
 */
export async function ensureAcpServer(): Promise<string> {
	if (process.env.OTTO_SERVER_URL) {
		const url = String(process.env.OTTO_SERVER_URL);
		configureClient(url);
		return url;
	}

	if (currentServer) return `http://localhost:${currentServer.port}`;

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

function configureClient(baseURL: string) {
	if (configuredBaseUrl === baseURL) return;
	client.setConfig({ baseURL, adapter: 'fetch' });
	configuredBaseUrl = baseURL;
}
