import { createServer, type Server } from 'node:http';
import { z } from '@hono/zod-openapi';
import { openAuthUrl } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { isDaemonTokenAuthorized, isTunnelRequest } from '../tunnel-auth.ts';

const PROXY_TTL_MS = 10 * 60 * 1000;
const callbackListeners = new Map<
	string,
	{ server: Server; timer: ReturnType<typeof setTimeout> }
>();

const startCallbackProxyBodySchema = z.object({
	authorizationUrl: z.string().url(),
	callbackUrl: z.string().url(),
	remoteBaseUrl: z.string().url(),
	remoteFlowId: z.string().min(1),
	remoteToken: z.string().min(1),
});

const startCallbackProxyResponseSchema = z.object({
	proxyId: z.string(),
	opened: z.boolean(),
});

const callbackProxyErrorSchema = z.object({ error: z.string() });

export interface OAuthCallbackProxyInput {
	authorizationUrl: string;
	callbackUrl: string;
	remoteBaseUrl: string;
	remoteFlowId: string;
	remoteToken: string;
}

export interface OAuthLoopbackCallbackResult {
	code?: string;
	state?: string;
	error?: string;
	errorDescription?: string;
}

export interface OAuthLoopbackCallbackInput {
	callbackUrl: string;
	successMessage: string;
	complete: (result: OAuthLoopbackCallbackResult) => Promise<void>;
}

function callbackAddress(callbackUrl: string): {
	hostname: string;
	port: number;
	pathname: string;
} {
	const url = new URL(callbackUrl);
	if (url.protocol !== 'http:') {
		throw new Error('Loopback OAuth callback must use HTTP');
	}
	if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		throw new Error('OAuth callback proxy only accepts loopback URLs');
	}
	const port = Number(url.port || '80');
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('OAuth callback URL has an invalid port');
	}
	return {
		hostname:
			url.hostname === 'localhost'
				? '127.0.0.1'
				: url.hostname === '[::1]'
					? '::1'
					: url.hostname,
		port,
		pathname: url.pathname || '/',
	};
}

function stopCallbackListener(listenerId: string): void {
	const listener = callbackListeners.get(listenerId);
	if (!listener) return;
	callbackListeners.delete(listenerId);
	clearTimeout(listener.timer);
	listener.server.close();
}

function html(title: string, message: string): string {
	const escapeHtml = (value: string) =>
		value.replace(
			/[&<>"']/g,
			(character) =>
				({
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#039;',
				})[character] ?? character,
		);
	const safeTitle = escapeHtml(title);
	const safeMessage = escapeHtml(message);
	return `<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><main><h1>${safeTitle}</h1><p>${safeMessage}</p></main></body></html>`;
}

/** Starts a one-time loopback callback listener with injected completion logic. */
export async function startOAuthLoopbackCallback(
	input: OAuthLoopbackCallbackInput,
): Promise<{ listenerId: string }> {
	const address = callbackAddress(input.callbackUrl);
	const listenerId = crypto.randomUUID();
	let handled = false;

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? '/', input.callbackUrl);
			if (req.method !== 'GET') {
				res.writeHead(405).end();
				return;
			}
			if (url.pathname !== address.pathname || handled) {
				res.writeHead(404).end();
				return;
			}
			handled = true;
			await input.complete({
				code: url.searchParams.get('code') ?? undefined,
				state: url.searchParams.get('state') ?? undefined,
				error: url.searchParams.get('error') ?? undefined,
				errorDescription:
					url.searchParams.get('error_description') ?? undefined,
			});
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(html('Authorization complete', input.successMessage));
		} catch (error) {
			res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(
				html(
					'Authorization failed',
					error instanceof Error ? error.message : 'OAuth callback failed',
				),
			);
		} finally {
			setTimeout(() => stopCallbackListener(listenerId), 100);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(address.port, address.hostname, () => {
			server.off('error', reject);
			resolve();
		});
	});
	const timer = setTimeout(
		() => stopCallbackListener(listenerId),
		PROXY_TTL_MS,
	);
	callbackListeners.set(listenerId, { server, timer });
	return { listenerId };
}

export async function startOAuthCallbackProxy(
	input: OAuthCallbackProxyInput,
	openUrl: (url: string) => Promise<boolean> = openAuthUrl,
): Promise<{ proxyId: string; opened: boolean }> {
	const remoteBaseUrl = new URL(input.remoteBaseUrl);
	if (!['http:', 'https:'].includes(remoteBaseUrl.protocol)) {
		throw new Error('Target daemon URL must use HTTP or HTTPS');
	}
	const completionUrl = new URL(
		`/v1/mcp/oauth/flows/${encodeURIComponent(input.remoteFlowId)}/complete`,
		remoteBaseUrl,
	);
	const { listenerId } = await startOAuthLoopbackCallback({
		callbackUrl: input.callbackUrl,
		successMessage:
			'The remote machine is configured. You can close this window.',
		complete: async (result) => {
			const response = await fetch(completionUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${input.remoteToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(result),
				signal: AbortSignal.timeout(30_000),
				redirect: 'error',
			});
			const payload = (await response.json().catch(() => null)) as {
				error?: string;
			} | null;
			if (!response.ok) {
				throw new Error(
					payload?.error ?? 'Remote daemon rejected OAuth callback',
				);
			}
		},
	});
	return {
		proxyId: listenerId,
		opened: await openUrl(input.authorizationUrl),
	};
}

/** Registers the local-daemon-only OAuth loopback callback proxy. */
export function registerOAuthCallbackProxyRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/oauth/callback-proxies',
			tags: ['oauth'],
			operationId: 'startOAuthCallbackProxy',
			summary: 'Start a local OAuth callback proxy for a remote daemon',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: startCallbackProxyBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Callback proxy started',
					content: {
						'application/json': { schema: startCallbackProxyResponseSchema },
					},
				},
				'400': {
					description: 'Callback proxy could not start',
					content: {
						'application/json': { schema: callbackProxyErrorSchema },
					},
				},
				'401': {
					description: 'Local daemon authorization required',
					content: {
						'application/json': { schema: callbackProxyErrorSchema },
					},
				},
				'403': {
					description: 'Remote callback proxy requests are forbidden',
					content: {
						'application/json': { schema: callbackProxyErrorSchema },
					},
				},
			},
		},
		async (c) => {
			if (isTunnelRequest(c)) {
				return c.json(
					{ error: 'Callback proxy is only available locally' },
					403,
				);
			}
			if (!(await isDaemonTokenAuthorized(c))) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			try {
				return c.json(await startOAuthCallbackProxy(await c.req.json()), 200);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : String(error) },
					400,
				);
			}
		},
	);
}
