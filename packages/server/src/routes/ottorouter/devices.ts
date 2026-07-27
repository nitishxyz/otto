import { z } from '@hono/zod-openapi';
import { getManagedTunnelDeviceId } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { getProtocolInfo } from '../../protocol.ts';
import { getServerInfo } from '../../state.ts';
import { fetchWithOttoRouterAuth, getOttoRouterBaseUrl } from './service.ts';

const tunnelDeviceSchema = z.object({
	deviceId: z.string(),
	hostname: z.string().nullable().optional(),
	name: z.string().nullable().optional(),
	status: z.string().nullable().optional(),
});
const authorizeBodySchema = z.object({
	device_id: z.string().uuid(),
	challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const machineProjectsBodySchema = z.object({
	deviceId: z.string().uuid(),
	hostname: z.string().min(1),
	forceOwnerSession: z.boolean().optional(),
});
const machineProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	path: z.string(),
	open: z.boolean(),
	lastUsedAt: z.number(),
	pinned: z.boolean().optional(),
});
const remoteServerInfoSchema = z.object({
	version: z.string().nullable(),
	protocol: z
		.object({
			version: z.number().int(),
			minVersion: z.number().int(),
			maxVersion: z.number().int(),
			capabilities: z.array(z.string()),
		})
		.optional(),
});
const machineProjectsResponseSchema = z.object({
	status: z.enum(['ready', 'unavailable']),
	apiUrl: z.string().optional(),
	ownerSession: z.string().optional(),
	ownerSessionExpiresAt: z.number().optional(),
	projects: z.array(machineProjectSchema).optional(),
	serverInfo: remoteServerInfoSchema.nullable().optional(),
	message: z.string().optional(),
});
const authorizeResponseSchema = z.object({
	assertion: z.string(),
	device_id: z.string().uuid(),
});

const deviceListSchema = z.object({
	configured: z.boolean(),
	devices: z.array(tunnelDeviceSchema),
	error: z.string().optional(),
});

interface SetuDevice {
	device_id?: unknown;
	hostname?: unknown;
	name?: unknown;
	status?: unknown;
}

const machineSessions = new Map<
	string,
	{ token: string; expiresAt: number; apiUrl: string }
>();

function machineUrl(hostname: string): string {
	return hostname.startsWith('http://') || hostname.startsWith('https://')
		? hostname.replace(/\/$/, '')
		: `https://${hostname.replace(/\/$/, '')}`;
}

function machineRequestHeaders(ownerSession?: string): Record<string, string> {
	const protocol = getProtocolInfo();
	const clientVersion = getServerInfo().version;
	return {
		Accept: 'application/json',
		'X-Otto-Client': 'server-machine-access',
		...(clientVersion ? { 'X-Otto-Client-Version': clientVersion } : {}),
		'X-Otto-Protocol-Version': String(protocol.version),
		'X-Otto-Protocol-Min': String(protocol.minVersion),
		'X-Otto-Protocol-Max': String(protocol.maxVersion),
		...(ownerSession ? { 'X-Otto-Owner-Session': ownerSession } : {}),
	};
}

async function loadAuthorizedMachineProjects(
	deviceId: string,
	hostname: string,
	forceOwnerSession = false,
) {
	const apiUrl = machineUrl(hostname);
	let session = machineSessions.get(deviceId);
	if (
		forceOwnerSession ||
		!session ||
		session.expiresAt <= Date.now() + 60_000
	) {
		const challengeResponse = await fetch(
			`${apiUrl}/v1/tunnel/owner/challenge`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
				signal: AbortSignal.timeout(5_000),
			},
		);
		if (!challengeResponse.ok) {
			return {
				status: 'unavailable' as const,
				message:
					challengeResponse.status === 530
						? 'Machine offline. Start otto and its managed tunnel, then retry.'
						: `Machine authorization unavailable (HTTP ${challengeResponse.status}).`,
			};
		}
		const challenge = (await challengeResponse.json()) as {
			challenge: string;
			device_id: string;
		};
		if (challenge.device_id !== deviceId) {
			return {
				status: 'unavailable' as const,
				message: 'Tunnel device identity mismatch.',
			};
		}
		const assertionResponse = await fetchWithOttoRouterAuth(
			`${getOttoRouterBaseUrl()}/v1/tunnels/device/authorize`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({
					device_id: deviceId,
					challenge: challenge.challenge,
				}),
			},
		);
		if (!assertionResponse) {
			return {
				status: 'unavailable' as const,
				message: 'Connect OttoRouter and retry.',
			};
		}
		if (!assertionResponse.ok) {
			return {
				status: 'unavailable' as const,
				message: `OttoRouter authorization failed (HTTP ${assertionResponse.status}).`,
			};
		}
		const { assertion } = (await assertionResponse.json()) as {
			assertion: string;
		};
		const sessionResponse = await fetch(`${apiUrl}/v1/tunnel/owner/session`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ assertion }),
			signal: AbortSignal.timeout(5_000),
		});
		if (!sessionResponse.ok) {
			return {
				status: 'unavailable' as const,
				message: `Machine rejected authorization (HTTP ${sessionResponse.status}).`,
			};
		}
		const exchanged = (await sessionResponse.json()) as {
			access_token: string;
			expires_in: number;
		};
		session = {
			token: exchanged.access_token,
			expiresAt: Date.now() + exchanged.expires_in * 1000,
			apiUrl,
		};
		machineSessions.set(deviceId, session);
	}
	const headers = machineRequestHeaders(session.token);
	const [projectsResponse, infoResponse] = await Promise.all([
		fetch(`${apiUrl}/v1/projects`, {
			headers,
			signal: AbortSignal.timeout(5_000),
		}),
		fetch(`${apiUrl}/v1/server/info`, {
			headers,
			signal: AbortSignal.timeout(5_000),
		}).catch(() => null),
	]);
	if (!projectsResponse.ok)
		throw new Error(
			`Machine projects failed (HTTP ${projectsResponse.status})`,
		);
	const { projects } = (await projectsResponse.json()) as {
		projects: unknown[];
	};
	const serverInfo =
		infoResponse?.ok === true
			? ((await infoResponse.json()) as z.infer<typeof remoteServerInfoSchema>)
			: null;
	return {
		status: 'ready' as const,
		apiUrl,
		ownerSession: session.token,
		ownerSessionExpiresAt: session.expiresAt,
		projects,
		serverInfo,
	};
}

const OFFLINE_EDGE_STATUSES = new Set([502, 503, 504, 521, 522, 523, 530]);

export function classifyProbeStatus(
	status: number,
): 'online' | 'offline' | 'checking' {
	if (OFFLINE_EDGE_STATUSES.has(status)) return 'offline';
	if (status >= 200 && status < 500) return 'online';
	return 'checking';
}

/** Probes the public daemon ping endpoint without reusing edge caches. */
export async function probeDevice(
	hostname: string | null,
	fetcher: typeof globalThis.fetch,
): Promise<'online' | 'offline' | 'checking'> {
	if (!hostname) return 'checking';
	try {
		const url = new URL('/v1/tunnel/ping', machineUrl(hostname));
		url.searchParams.set('_', String(Date.now()));
		const response = await fetcher(url, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Cache-Control': 'no-cache, no-store, max-age=0',
				Pragma: 'no-cache',
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(5_000),
			cache: 'no-store',
		});
		return classifyProbeStatus(response.status);
	} catch {
		return 'offline';
	}
}

async function probeDevices(
	devices: ReturnType<typeof remoteDevicesOnly>,
	fetcher: typeof globalThis.fetch,
) {
	const result = [...devices];
	for (let offset = 0; offset < result.length; offset += 4) {
		await Promise.all(
			result.slice(offset, offset + 4).map(async (device, index) => {
				result[offset + index] = {
					...device,
					status: await probeDevice(device.hostname, fetcher),
				};
			}),
		);
	}
	return result;
}

/** Normalizes Setu devices and removes the daemon represented by this process. */
export function remoteDevicesOnly(
	devices: SetuDevice[],
	localDeviceId: string,
) {
	return devices
		.filter(
			(device): device is SetuDevice & { device_id: string } =>
				typeof device.device_id === 'string' &&
				device.device_id !== localDeviceId,
		)
		.map((device) => ({
			deviceId: device.device_id,
			hostname: typeof device.hostname === 'string' ? device.hostname : null,
			name: typeof device.name === 'string' ? device.name : null,
			status: typeof device.status === 'string' ? device.status : null,
		}));
}

/** Lists account tunnel devices while excluding this daemon's persisted identity. */
export async function listRemoteOttoRouterDevices(
	fetcher: typeof globalThis.fetch = globalThis.fetch,
) {
	const response = await fetchWithOttoRouterAuth(
		`${getOttoRouterBaseUrl()}/v1/tunnels/devices`,
		{
			headers: {
				Accept: 'application/json',
				'Cache-Control': 'no-cache, no-store, max-age=0',
				Pragma: 'no-cache',
			},
			cache: 'no-store',
		},
		fetcher,
	);
	if (!response) return { configured: false, devices: [] };
	if (response.status === 401 || response.status === 403) {
		return {
			configured: false,
			devices: [],
			error: 'OttoRouter sign-in expired. Reconnect to view your machines.',
		};
	}
	if (!response.ok) {
		return {
			configured: true,
			devices: [],
			error: `Could not load OttoRouter machines (HTTP ${response.status}).`,
		};
	}
	const payload = (await response.json()) as { devices?: SetuDevice[] };
	const localDeviceId = await getManagedTunnelDeviceId();
	const devices = await probeDevices(
		remoteDevicesOnly(payload.devices ?? [], localDeviceId),
		fetcher,
	);
	return { configured: true, devices };
}

export function registerOttoRouterDeviceRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/machine/projects',
			tags: ['ottorouter'],
			operationId: 'listAuthorizedMachineProjects',
			summary: 'Authorize a remote machine and list its projects',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: machineProjectsBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Machine projects',
					content: {
						'application/json': { schema: machineProjectsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const body = machineProjectsBodySchema.parse(await c.req.json());
			return c.json(
				await loadAuthorizedMachineProjects(
					body.deviceId,
					body.hostname,
					body.forceOwnerSession,
				),
			);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/devices',
			tags: ['ottorouter'],
			operationId: 'listOttoRouterDevices',
			summary: 'List remote OttoRouter tunnel devices',
			responses: {
				'200': {
					description: 'Account devices excluding this daemon',
					content: { 'application/json': { schema: deviceListSchema } },
				},
			},
		},
		async (c) => c.json(await listRemoteOttoRouterDevices()),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/devices/authorize',
			tags: ['ottorouter'],
			operationId: 'authorizeOttoRouterDevice',
			summary: 'Authorize an owned tunnel device challenge',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: authorizeBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'Short-lived owner assertion',
					content: { 'application/json': { schema: authorizeResponseSchema } },
				},
			},
		},
		async (c) => {
			const body = authorizeBodySchema.parse(await c.req.json());
			const response = await fetchWithOttoRouterAuth(
				`${getOttoRouterBaseUrl()}/v1/tunnels/device/authorize`,
				{
					method: 'POST',
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(body),
				},
			);
			if (!response)
				return c.json({ error: 'OttoRouter OAuth not configured' }, 401);
			const payload = (await response.json()) as Record<string, unknown>;
			return c.json(payload, response.status as 200);
		},
	);
}
