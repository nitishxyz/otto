import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
	generateQRCode,
	isTunnelBinaryInstalled,
	logger,
	ManagedTunnelProvisionError,
	OttoTunnel,
	provisionManagedTunnel,
	type ManagedTunnelAuth,
	type ManagedTunnelProvision,
	type ManagedTunnelProvisionOptions,
} from '@ottocode/sdk';
import { getServerInfo, getServerPort } from '../../state.ts';
import { isBlockedProjectSharePath } from '../../tunnel-auth.ts';
import { getOttoRouterOAuthAuth } from '../ottorouter/service.ts';
import {
	readManagedTunnelDesiredState,
	writeManagedTunnelDesiredState,
} from './managed-state.ts';
import { clearOwnerAuthorizationState } from './owner-auth.ts';
import { clearTerminalWebSocketTickets } from '../terminals/ws-ticket.ts';
import {
	clearTunnelShares,
	createTunnelShare,
	listTunnelShares,
	revokeTunnelShare,
} from './shares.ts';

export type TunnelScope = 'remote-control' | 'project-share';
export type TunnelMode = 'managed' | 'quick';
type TunnelStatus = 'idle' | 'starting' | 'connected' | 'error';

type TunnelFactory = () => OttoTunnel;
type ManagedAuthProvider = () => Promise<{
	accessToken: string;
	refreshAccessToken?: (options?: {
		staleAccessToken?: string;
	}) => Promise<{ accessToken: string }>;
} | null>;
type ManagedProvisioner = (
	auth: ManagedTunnelAuth,
	options: ManagedTunnelProvisionOptions,
) => Promise<ManagedTunnelProvision>;
type ManagedStateReader = typeof readManagedTunnelDesiredState;
type ManagedStateWriter = typeof writeManagedTunnelDesiredState;
type ManagedRestartDelay = (attempt: number) => number;
type ManagedDisconnectDelay = () => number;

const defaultManagedRestartDelay: ManagedRestartDelay = (attempt) =>
	Math.min(1000 * 2 ** attempt, 30_000);
const defaultManagedDisconnectDelay: ManagedDisconnectDelay = () => 30_000;

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
	mode?: TunnelMode;
}

const tunnelSlots = new Map<string, TunnelSlot>();
const managedShareIds = new Map<string, string>();
let tunnelFactory: TunnelFactory = () => new OttoTunnel();
let managedAuthProvider: ManagedAuthProvider = getOttoRouterOAuthAuth;
let managedProvisioner: ManagedProvisioner = provisionManagedTunnel;
let managedStateReader: ManagedStateReader = readManagedTunnelDesiredState;
let managedStateWriter: ManagedStateWriter = writeManagedTunnelDesiredState;
let managedStartPromise: Promise<void> | null = null;
let managedTunnelDesired = false;
let managedRestartAttempt = 0;
let managedRestartTimer: ReturnType<typeof setTimeout> | null = null;
let managedRestartDelay = defaultManagedRestartDelay;
let managedDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
let managedDisconnectDelay = defaultManagedDisconnectDelay;
const managedConnections = new Set<string>();
const managedTunnel: TunnelSlot & { hostname: string | null } = {
	scope: 'remote-control',
	projectId: null,
	activeTunnel: null,
	proxyServer: null,
	url: null,
	status: 'idle',
	error: null,
	progress: null,
	hostname: null,
};

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

function clearManagedRestartTimer() {
	if (managedRestartTimer) clearTimeout(managedRestartTimer);
	managedRestartTimer = null;
}

function clearManagedDisconnectTimer() {
	if (managedDisconnectTimer) clearTimeout(managedDisconnectTimer);
	managedDisconnectTimer = null;
}

function scheduleManagedDisconnectRecovery(tunnel: OttoTunnel) {
	if (!managedTunnelDesired || managedDisconnectTimer) return;
	managedTunnel.status = 'starting';
	managedTunnel.progress = 'Waiting for tunnel network recovery...';
	managedDisconnectTimer = setTimeout(() => {
		managedDisconnectTimer = null;
		if (
			!managedTunnelDesired ||
			managedTunnel.activeTunnel !== tunnel ||
			managedConnections.size > 0
		) {
			return;
		}
		managedTunnel.activeTunnel = null;
		managedTunnel.url = null;
		managedTunnel.hostname = null;
		managedTunnel.status = 'idle';
		managedTunnel.progress = 'Restarting disconnected managed tunnel...';
		tunnel.stop();
		scheduleManagedTunnelRestart();
	}, managedDisconnectDelay());
}

function scheduleManagedTunnelRestart() {
	if (
		!managedTunnelDesired ||
		managedRestartTimer ||
		managedTunnel.activeTunnel?.isRunning
	) {
		return;
	}

	const delay = managedRestartDelay(managedRestartAttempt++);
	managedTunnel.progress = 'Waiting to reconnect managed tunnel...';
	managedRestartTimer = setTimeout(() => {
		managedRestartTimer = null;
		managedTunnel.status = 'starting';
		managedTunnel.progress = 'Reconnecting managed tunnel...';
		void startManagedTunnel({ mode: 'managed' }, false)
			.then((result) => {
				if (result.ok) {
					managedRestartAttempt = 0;
					return;
				}
				scheduleManagedTunnelRestart();
			})
			.catch((error) => {
				logger.error('Failed to restart managed tunnel:', error);
				scheduleManagedTunnelRestart();
			});
	}, delay);
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
	if (options.mode === 'managed') {
		const projectId =
			options.scope === 'project-share' ? options.projectId : null;
		const shareId = projectId ? managedShareIds.get(projectId) : undefined;
		const share = shareId
			? listTunnelShares().find((item) => item.id === shareId)
			: undefined;
		const daemonRunning = managedTunnel.activeTunnel?.isRunning ?? false;
		const isRunning = projectId
			? Boolean(share) && daemonRunning
			: daemonRunning;
		return {
			scope: options.scope ?? 'remote-control',
			projectId: projectId ?? null,
			status: projectId && !share ? 'idle' : managedTunnel.status,
			url: projectId ? (share?.url ?? null) : managedTunnel.url,
			error: managedTunnel.error,
			isRunning,
			progress: managedTunnel.progress,
			mode: 'managed' as const,
			hostname: managedTunnel.hostname,
		};
	}

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
		mode: 'quick' as const,
		hostname: null,
	};
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
	let ottorouterConnected = false;
	try {
		ottorouterConnected = Boolean(await managedAuthProvider());
	} catch {}

	return {
		scope: state.scope,
		projectId: state.projectId,
		status: state.status,
		url: state.url,
		error: state.error,
		binaryInstalled,
		isRunning: state.isRunning,
		mode: state.mode,
		hostname: state.hostname,
		ottorouterConnected,
	};
}

async function startManagedTunnelUnlocked(
	options: TunnelScopeOptions,
	persistDesiredState = true,
) {
	const scope = options.scope ?? 'remote-control';
	if (scope === 'project-share' && options.projectId) {
		const existingId = managedShareIds.get(options.projectId);
		const existing = existingId
			? listTunnelShares().find((item) => item.id === existingId)
			: undefined;
		if (existing) {
			return {
				ok: true,
				mode: 'managed' as const,
				scope,
				projectId: options.projectId,
				url: existing.url,
				message: 'Project share already active',
			};
		}
		if (existingId) managedShareIds.delete(options.projectId);
	}

	try {
		if (!managedTunnel.activeTunnel?.isRunning) {
			const auth = await managedAuthProvider();
			if (!auth) {
				return {
					ok: false as const,
					mode: 'managed' as const,
					scope,
					projectId: scope === 'project-share' ? options.projectId : null,
					code: 'ottorouter_not_connected',
					error: 'Connect OttoRouter before starting a managed tunnel',
				};
			}

			const localPort = getServerPort();
			if (!localPort) {
				throw new Error('Daemon server port is not available');
			}

			managedTunnel.status = 'starting';
			managedTunnel.error = null;
			managedTunnel.progress = 'Provisioning managed tunnel...';
			const provisionOptions = {
				localPort,
				daemonVersion: getServerInfo().version ?? 'unknown',
			};
			let provision: ManagedTunnelProvision;
			try {
				provision = await managedProvisioner(
					{ accessToken: auth.accessToken },
					provisionOptions,
				);
			} catch (error) {
				if (
					!(error instanceof ManagedTunnelProvisionError) ||
					(error.status !== 401 && error.status !== 403) ||
					!auth.refreshAccessToken
				) {
					throw error;
				}
				const refreshed = await auth.refreshAccessToken({
					staleAccessToken: auth.accessToken,
				});
				provision = await managedProvisioner(
					{ accessToken: refreshed.accessToken },
					provisionOptions,
				);
			}

			const tunnel = tunnelFactory();
			managedConnections.clear();
			clearManagedDisconnectTimer();
			managedTunnel.activeTunnel = tunnel;
			managedTunnel.hostname = provision.hostname;
			managedTunnel.url = provision.url;
			tunnel.on('error', (error) => {
				if (managedTunnel.activeTunnel !== tunnel) return;
				logger.error('Managed tunnel error:', error);
				managedTunnel.error = error.message;
				managedTunnel.status = 'error';
			});
			tunnel.on('connected', (connection) => {
				if (managedTunnel.activeTunnel !== tunnel) return;
				managedConnections.add(connection.id);
				clearManagedDisconnectTimer();
				managedTunnel.status = 'connected';
				managedTunnel.error = null;
				managedTunnel.progress = null;
			});
			tunnel.on('disconnected', (connection) => {
				if (managedTunnel.activeTunnel !== tunnel) return;
				managedConnections.delete(connection.id);
				if (managedConnections.size === 0) {
					scheduleManagedDisconnectRecovery(tunnel);
				}
			});
			tunnel.on('exit', () => {
				if (managedTunnel.activeTunnel !== tunnel) return;
				managedConnections.clear();
				clearManagedDisconnectTimer();
				managedTunnel.status = 'idle';
				managedTunnel.url = null;
				managedTunnel.hostname = null;
				managedTunnel.activeTunnel = null;
				scheduleManagedTunnelRestart();
			});
			await tunnel.startManaged(
				provision.tunnel_token,
				provision.url,
				(message) => {
					managedTunnel.progress = message;
				},
			);
			managedTunnel.status = 'connected';
			managedTunnel.progress = null;
			managedRestartAttempt = 0;
			clearManagedRestartTimer();
		}

		if (scope === 'project-share' && options.projectId) {
			const share = createTunnelShare(
				options.projectId,
				managedTunnel.url ?? '',
			);
			managedShareIds.set(options.projectId, share.id);
			if (persistDesiredState) {
				await managedStateWriter(true);
				managedTunnelDesired = true;
				scheduleManagedTunnelRestart();
			}
			return {
				ok: true,
				mode: 'managed' as const,
				scope,
				projectId: options.projectId,
				url: share.url,
				message: 'Project share started',
			};
		}
		if (persistDesiredState) {
			await managedStateWriter(true);
			managedTunnelDesired = true;
			scheduleManagedTunnelRestart();
		}

		return {
			ok: true,
			mode: 'managed' as const,
			scope,
			projectId: null,
			url: managedTunnel.url,
			message: 'Managed tunnel started',
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		managedTunnel.status = 'error';
		managedTunnel.error = message;
		managedTunnel.progress = null;
		managedTunnel.activeTunnel?.stop();
		managedTunnel.activeTunnel = null;
		managedConnections.clear();
		clearManagedDisconnectTimer();
		managedTunnel.url = null;
		managedTunnel.hostname = null;
		logger.error('Failed to start managed tunnel:', error);
		return {
			ok: false as const,
			mode: 'managed' as const,
			scope,
			projectId: scope === 'project-share' ? options.projectId : null,
			error: message,
		};
	}
}

async function startManagedTunnel(
	options: TunnelScopeOptions,
	persistDesiredState = true,
) {
	if (managedStartPromise) {
		await managedStartPromise;
		return startManagedTunnelUnlocked(options, persistDesiredState);
	}

	const operation = startManagedTunnelUnlocked(options, persistDesiredState);
	const pending = operation.then(() => {});
	managedStartPromise = pending;
	try {
		return await operation;
	} finally {
		if (managedStartPromise === pending) managedStartPromise = null;
	}
}

/** Restores the desired managed daemon tunnel without blocking daemon startup. */
export async function restoreManagedTunnel(): Promise<void> {
	const desired = await managedStateReader();
	managedTunnelDesired = desired.enabled;
	if (!desired.enabled) {
		clearManagedRestartTimer();
		return;
	}
	managedTunnel.status = 'starting';
	managedTunnel.error = null;
	managedTunnel.progress = 'Restoring managed tunnel...';
	const result = await startManagedTunnel({ mode: 'managed' }, false);
	if (!result.ok) {
		managedTunnel.status = 'error';
		managedTunnel.error = result.error ?? 'Managed tunnel restore failed';
		managedTunnel.progress = null;
		scheduleManagedTunnelRestart();
	}
}

export async function startTunnel(
	requestedPort?: number,
	options: TunnelScopeOptions = {},
) {
	const validation = validateScope(options);
	if (!validation.ok) return validation;
	if (options.mode === 'managed') return startManagedTunnel(options);

	const slot = getTunnelSlot(options);
	if (slot.activeTunnel?.isRunning) {
		return {
			ok: true,
			mode: 'quick' as const,
			scope: slot.scope,
			projectId: slot.projectId,
			url: slot.url,
			message: 'Tunnel already running',
		};
	}

	try {
		const serverPort = requestedPort || getServerPort() || 9100;
		let tunnelPort = serverPort;

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
			mode: 'quick' as const,
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
			mode: 'quick' as const,
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
		mode: 'quick' as const,
		scope: slot.scope,
		projectId: slot.projectId,
		url: slot.url,
		message: 'External tunnel registered',
	};
}

export async function stopTunnel(options: TunnelScopeOptions = {}) {
	const validation = validateScope(options);
	if (!validation.ok) return validation;
	if (options.mode === 'managed') {
		const scope = options.scope ?? 'remote-control';
		if (scope === 'project-share' && options.projectId) {
			const shareId = managedShareIds.get(options.projectId);
			if (shareId) revokeTunnelShare(shareId);
			managedShareIds.delete(options.projectId);
			return {
				ok: true,
				mode: 'managed' as const,
				scope,
				projectId: options.projectId,
				message: shareId ? 'Project share stopped' : 'No project share active',
			};
		}

		managedTunnelDesired = false;
		clearManagedRestartTimer();
		clearManagedDisconnectTimer();
		managedConnections.clear();
		let persistenceError: string | undefined;
		try {
			await managedStateWriter(false);
		} catch (error) {
			persistenceError = error instanceof Error ? error.message : String(error);
		}
		managedTunnel.activeTunnel?.stop();
		managedTunnel.activeTunnel = null;
		managedTunnel.url = null;
		managedTunnel.hostname = null;
		managedTunnel.status = 'idle';
		managedTunnel.error = null;
		return {
			ok: !persistenceError,
			mode: 'managed' as const,
			scope,
			projectId: null,
			message: 'Managed tunnel stopped',
			...(persistenceError
				? { error: `Failed to persist disabled state: ${persistenceError}` }
				: {}),
		};
	}

	const slot = getTunnelSlot(options);
	if (!slot.activeTunnel) {
		return {
			ok: true,
			mode: 'quick' as const,
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
			mode: 'quick' as const,
			scope: slot.scope,
			projectId: slot.projectId,
			error: message,
		};
	}
}

export async function getTunnelQRCode(options: TunnelScopeOptions = {}) {
	const state = getCurrentTunnelState(options);
	if (!state.url) {
		return {
			ok: false,
			mode: state.mode,
			scope: state.scope,
			projectId: state.projectId,
			error: 'No tunnel URL available',
		};
	}

	try {
		const qrCode = await generateQRCode(state.url);
		return {
			ok: true,
			mode: state.mode,
			scope: state.scope,
			projectId: state.projectId,
			url: state.url,
			qrCode,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			mode: state.mode,
			scope: state.scope,
			projectId: state.projectId,
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

/** Stops runtime tunnel processes without changing persisted desired state. */
export function shutdownActiveTunnels(): void {
	stopActiveTunnel();
}

export function stopActiveTunnel() {
	managedTunnelDesired = false;
	managedRestartAttempt = 0;
	clearManagedRestartTimer();
	clearManagedDisconnectTimer();
	managedConnections.clear();
	managedTunnel.activeTunnel?.stop();
	managedTunnel.activeTunnel = null;
	managedTunnel.url = null;
	managedTunnel.hostname = null;
	managedTunnel.status = 'idle';
	managedTunnel.error = null;
	managedTunnel.progress = null;
	managedShareIds.clear();
	clearTunnelShares();
	clearOwnerAuthorizationState();
	clearTerminalWebSocketTickets();
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
	return (
		managedTunnel.url ?? getExistingTunnelSlot({ scope: 'remote-control' }).url
	);
}

export function getTunnelScopeOptionsFromContext(
	c: Context,
): TunnelScopeOptions {
	const scope = (c.req.query('scope') || c.req.header('X-Otto-Tunnel-Scope')) as
		| TunnelScope
		| undefined;
	const projectId =
		c.req.query('projectId') || c.req.header('X-Otto-Project-Id') || undefined;
	const mode = c.req.query('mode') === 'managed' ? 'managed' : 'quick';
	return {
		scope: scope === 'project-share' ? scope : 'remote-control',
		projectId,
		mode,
	};
}

export const tunnelTesting = {
	setTunnelFactory(factory: TunnelFactory) {
		tunnelFactory = factory;
	},
	setManagedAuthProvider(provider: ManagedAuthProvider) {
		managedAuthProvider = provider;
	},
	setManagedProvisioner(provisioner: ManagedProvisioner) {
		managedProvisioner = provisioner;
	},
	setManagedStateReader(reader: ManagedStateReader) {
		managedStateReader = reader;
	},
	setManagedStateWriter(writer: ManagedStateWriter) {
		managedStateWriter = writer;
	},
	setManagedRestartDelay(delay: ManagedRestartDelay) {
		managedRestartDelay = delay;
	},
	setManagedDisconnectDelay(delay: ManagedDisconnectDelay) {
		managedDisconnectDelay = delay;
	},
	reset() {
		stopActiveTunnel();
		tunnelSlots.clear();
		tunnelFactory = () => new OttoTunnel();
		managedAuthProvider = getOttoRouterOAuthAuth;
		managedProvisioner = provisionManagedTunnel;
		managedStateReader = readManagedTunnelDesiredState;
		managedStateWriter = writeManagedTunnelDesiredState;
		managedRestartDelay = defaultManagedRestartDelay;
		managedDisconnectDelay = defaultManagedDisconnectDelay;
		managedStartPromise = null;
	},
};
