import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
	generateQRCode,
	isTunnelBinaryInstalled,
	killStaleTunnels,
	logger,
	OttoTunnel,
} from '@ottocode/sdk';
import { getServerPort } from '../../state.ts';

export type TunnelScope = 'remote-control' | 'project-share';
type TunnelStatus = 'idle' | 'starting' | 'connected' | 'error';

type TunnelFactory = () => OttoTunnel;

interface TunnelSlot {
	scope: TunnelScope;
	projectId: string | null;
	activeTunnel: OttoTunnel | null;
	proxyServer: Server | null;
	url: string | null;
	status: TunnelStatus;
	error: string | null;
	progress: string | null;
	port?: number;
}

export interface TunnelScopeOptions {
	scope?: TunnelScope;
	projectId?: string;
}

const tunnelSlots = new Map<string, TunnelSlot>();
let tunnelFactory: TunnelFactory = () => new OttoTunnel();

function getTunnelKey(options: TunnelScopeOptions = {}) {
	const scope = options.scope ?? 'remote-control';
	return scope === 'project-share'
		? `${scope}:${options.projectId ?? ''}`
		: scope;
}

function createTunnelSlot(options: TunnelScopeOptions = {}): TunnelSlot {
	const scope = options.scope ?? 'remote-control';
	return {
		scope,
		projectId: scope === 'project-share' ? (options.projectId ?? null) : null,
		activeTunnel: null,
		proxyServer: null,
		url: null,
		status: 'idle',
		error: null,
		progress: null,
	};
}

function getTunnelSlot(options: TunnelScopeOptions = {}) {
	const key = getTunnelKey(options);
	let slot = tunnelSlots.get(key);
	if (!slot) {
		slot = createTunnelSlot(options);
		tunnelSlots.set(key, slot);
	}
	return slot;
}

function getExistingTunnelSlot(options: TunnelScopeOptions = {}) {
	return tunnelSlots.get(getTunnelKey(options)) ?? createTunnelSlot(options);
}

function validateScope(options: TunnelScopeOptions = {}) {
	const scope = options.scope ?? 'remote-control';
	if (scope === 'project-share' && !options.projectId) {
		return {
			ok: false as const,
			error: 'projectId is required for project-share tunnel',
		};
	}
	return { ok: true as const, scope };
}

function getCurrentTunnelState(options: TunnelScopeOptions = {}) {
	const slot = getExistingTunnelSlot(options);
	const isRunning = slot.activeTunnel?.isRunning ?? false;
	const status = isRunning
		? slot.url
			? 'connected'
			: 'starting'
		: slot.status;

	return {
		scope: slot.scope,
		projectId: slot.projectId,
		status,
		url: slot.url,
		error: slot.error,
		isRunning,
		progress: slot.progress,
	};
}

function isBlockedProjectSharePath(pathname: string) {
	return (
		pathname === '/v1/projects' ||
		pathname.startsWith('/v1/projects/') ||
		pathname === '/v1/tunnel' ||
		pathname.startsWith('/v1/tunnel/')
	);
}

function startProjectScopeProxy(
	projectId: string,
	targetPort: number,
): Promise<{ server: Server; port: number }> {
	const server = createServer(async (req, res) => {
		try {
			const requestUrl = new URL(
				req.url ?? '/',
				`http://localhost:${targetPort}`,
			);

			if (isBlockedProjectSharePath(requestUrl.pathname)) {
				res.writeHead(403, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						error: 'Project share cannot access daemon-global routes',
					}),
				);
				return;
			}

			requestUrl.hostname = 'localhost';
			requestUrl.port = String(targetPort);
			requestUrl.protocol = 'http:';
			requestUrl.searchParams.set('projectId', projectId);
			requestUrl.searchParams.delete('project');

			const headers = new Headers();
			for (const [key, value] of Object.entries(req.headers)) {
				if (
					!value ||
					key.toLowerCase() === 'host' ||
					key.toLowerCase() === 'content-length'
				)
					continue;
				if (Array.isArray(value)) {
					for (const item of value) headers.append(key, item);
				} else {
					headers.set(key, value);
				}
			}
			headers.set('x-otto-project-id', projectId);
			headers.delete('x-otto-project');

			const method = req.method ?? 'GET';
			const hasBody = method !== 'GET' && method !== 'HEAD';
			let body: Buffer | undefined;
			if (hasBody) {
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
				}
				body = Buffer.concat(chunks);
			}
			const upstream = await fetch(requestUrl, {
				method,
				headers,
				body,
			});

			res.writeHead(
				upstream.status,
				Object.fromEntries(upstream.headers.entries()),
			);
			if (upstream.body) {
				for await (const chunk of upstream.body) {
					res.write(chunk);
				}
			}
			res.end();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.writeHead(502, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: message }));
		}
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve({ server, port: (server.address() as AddressInfo).port });
		});
	});
}

function stopProxyServer(slot: TunnelSlot) {
	if (!slot.proxyServer) return;
	slot.proxyServer.close();
	slot.proxyServer = null;
}

export async function getTunnelStatus(options: TunnelScopeOptions = {}) {
	const binaryInstalled = await isTunnelBinaryInstalled();
	const state = getCurrentTunnelState(options);

	return {
		scope: state.scope,
		projectId: state.projectId,
		status: state.status,
		url: state.url,
		error: state.error,
		binaryInstalled,
		isRunning: state.isRunning,
	};
}

export async function startTunnel(
	requestedPort?: number,
	options: TunnelScopeOptions = {},
) {
	const validation = validateScope(options);
	if (!validation.ok) return validation;

	const slot = getTunnelSlot(options);
	if (slot.activeTunnel?.isRunning) {
		return {
			ok: true,
			scope: slot.scope,
			projectId: slot.projectId,
			url: slot.url,
			message: 'Tunnel already running',
		};
	}

	try {
		const serverPort = requestedPort || getServerPort() || 9100;
		let tunnelPort = serverPort;

		if (
			![...tunnelSlots.values()].some((item) => item.activeTunnel?.isRunning)
		) {
			await killStaleTunnels();
		}

		if (slot.scope === 'project-share') {
			const proxy = await startProjectScopeProxy(
				slot.projectId ?? '',
				serverPort,
			);
			slot.proxyServer = proxy.server;
			tunnelPort = proxy.port;
		}

		slot.port = tunnelPort;
		slot.status = 'starting';
		slot.error = null;
		slot.progress = 'Initializing...';

		slot.activeTunnel = tunnelFactory();

		const url = await slot.activeTunnel.start(tunnelPort, (msg) => {
			slot.progress = msg;
		});

		slot.url = url;
		slot.status = 'connected';
		slot.progress = null;

		slot.activeTunnel.on('error', (err) => {
			logger.error('Tunnel error:', err);
			slot.error = err.message;
			slot.status = 'error';
		});

		slot.activeTunnel.on('exit', () => {
			slot.status = 'idle';
			slot.url = null;
			slot.activeTunnel = null;
			stopProxyServer(slot);
		});

		return {
			ok: true,
			scope: slot.scope,
			projectId: slot.projectId,
			url: slot.url,
			message: 'Tunnel started',
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		slot.status = 'error';
		slot.error = message;
		slot.progress = null;
		stopProxyServer(slot);

		logger.error('Failed to start tunnel:', error);
		return {
			ok: false,
			scope: slot.scope,
			projectId: slot.projectId,
			error: message,
		};
	}
}

export function registerExternalTunnel(
	url?: string,
	options: TunnelScopeOptions = {},
) {
	const validation = validateScope(options);
	if (!validation.ok) return validation;

	if (!url) {
		return { ok: false, error: 'URL is required' };
	}

	const slot = getTunnelSlot(options);
	slot.url = url;
	slot.status = 'connected';
	slot.error = null;
	slot.progress = null;

	return {
		ok: true,
		scope: slot.scope,
		projectId: slot.projectId,
		url: slot.url,
		message: 'External tunnel registered',
	};
}

export function stopTunnel(options: TunnelScopeOptions = {}) {
	const validation = validateScope(options);
	if (!validation.ok) return validation;

	const slot = getTunnelSlot(options);
	if (!slot.activeTunnel) {
		return {
			ok: true,
			scope: slot.scope,
			projectId: slot.projectId,
			message: 'No tunnel running',
		};
	}

	try {
		slot.activeTunnel.stop();
		slot.activeTunnel = null;
		slot.url = null;
		slot.status = 'idle';
		slot.error = null;
		stopProxyServer(slot);

		return {
			ok: true,
			scope: slot.scope,
			projectId: slot.projectId,
			message: 'Tunnel stopped',
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			scope: slot.scope,
			projectId: slot.projectId,
			error: message,
		};
	}
}

export async function getTunnelQRCode(options: TunnelScopeOptions = {}) {
	const slot = getExistingTunnelSlot(options);
	if (!slot.url) {
		return {
			ok: false,
			scope: slot.scope,
			projectId: slot.projectId,
			error: 'No tunnel URL available',
		};
	}

	try {
		const qrCode = await generateQRCode(slot.url);
		return {
			ok: true,
			scope: slot.scope,
			projectId: slot.projectId,
			url: slot.url,
			qrCode,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			scope: slot.scope,
			projectId: slot.projectId,
			error: message,
		};
	}
}

export async function handleTunnelStream(c: Context) {
	const options = getTunnelScopeOptionsFromContext(c);
	return streamSSE(c as Context, async (stream) => {
		const sendEvent = async (data: Record<string, unknown>) => {
			try {
				await stream.write(`data: ${JSON.stringify(data)}\n\n`);
			} catch (error) {
				logger.error('SSE error writing event', error);
			}
		};

		await sendEvent({ type: 'status', ...getCurrentTunnelState(options) });

		const interval = setInterval(async () => {
			await sendEvent({ type: 'status', ...getCurrentTunnelState(options) });
		}, 1000);

		const onAbort = () => {
			clearInterval(interval);
			stream.close();
		};

		c.req.raw.signal.addEventListener('abort', onAbort, { once: true });

		await new Promise<void>((resolve) => {
			c.req.raw.signal.addEventListener('abort', () => resolve(), {
				once: true,
			});
		});

		clearInterval(interval);
	});
}

export function stopActiveTunnel() {
	for (const slot of tunnelSlots.values()) {
		if (slot.activeTunnel) {
			slot.activeTunnel.stop();
			slot.activeTunnel = null;
			slot.url = null;
			slot.status = 'idle';
		}
		stopProxyServer(slot);
	}
}

export function stopProjectTunnel(projectId: string) {
	return stopTunnel({ scope: 'project-share', projectId });
}

export function setExternalTunnel(tunnel: OttoTunnel, url: string) {
	const slot = getTunnelSlot({ scope: 'remote-control' });
	slot.activeTunnel = tunnel;
	slot.url = url;
	slot.status = 'connected';
	slot.error = null;
	slot.progress = null;

	tunnel.on('error', (err) => {
		slot.error = err.message;
		slot.status = 'error';
	});

	tunnel.on('exit', () => {
		slot.status = 'idle';
		slot.url = null;
		slot.activeTunnel = null;
	});
}

export function getActiveTunnelUrl(): string | null {
	return getExistingTunnelSlot({ scope: 'remote-control' }).url;
}

export function getTunnelScopeOptionsFromContext(
	c: Context,
): TunnelScopeOptions {
	const scope = (c.req.query('scope') || c.req.header('X-Otto-Tunnel-Scope')) as
		| TunnelScope
		| undefined;
	const projectId =
		c.req.query('projectId') || c.req.header('X-Otto-Project-Id') || undefined;
	return {
		scope: scope === 'project-share' ? scope : 'remote-control',
		projectId,
	};
}

export const tunnelTesting = {
	setTunnelFactory(factory: TunnelFactory) {
		tunnelFactory = factory;
	},
	reset() {
		stopActiveTunnel();
		tunnelSlots.clear();
		tunnelFactory = () => new OttoTunnel();
	},
};
