import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getOttoHomeDir } from '@ottocode/sdk';
import type { Context, MiddlewareHandler } from 'hono';
import {
	isOwnerSessionAuthorized,
	OWNER_SESSION_COOKIE,
	OWNER_SESSION_HEADER,
} from './routes/tunnel/owner-auth.ts';
import { getShareByToken } from './routes/tunnel/shares.ts';
import { consumeTerminalWebSocketTicket } from './routes/terminals/ws-ticket.ts';

export const DAEMON_TOKEN_COOKIE = 'otto_server_token';
export const SHARE_TOKEN_HEADER = 'x-otto-share-token';
export const PINNED_PROJECT_HEADER = 'x-otto-share-project-id';

/** Returns the persistent daemon authentication token path. */
export function getDaemonTokenPath(): string {
	return join(getOttoHomeDir(), 'server-token');
}

/** Reads an existing daemon token or creates a stable, private token. */
export async function ensureDaemonToken(
	tokenPath = getDaemonTokenPath(),
): Promise<string> {
	await mkdir(dirname(tokenPath), { recursive: true });
	try {
		const existing = (await Bun.file(tokenPath).text()).trim();
		if (existing) {
			await chmod(tokenPath, 0o600).catch(() => {});
			return existing;
		}
	} catch {}

	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Buffer.from(bytes).toString('base64url');
	await Bun.write(tokenPath, `${token}\n`);
	await chmod(tokenPath, 0o600).catch(() => {});
	return token;
}

export function cookieValue(
	cookieHeader: string,
	name: string,
): string | undefined {
	for (const item of cookieHeader.split(';')) {
		const separator = item.indexOf('=');
		if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
		const value = item.slice(separator + 1).trim();
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
	return undefined;
}

/** Extracts a memory-only owner session from explicit or browser transports. */
export function getOwnerSessionToken(c: Context): string | undefined {
	const auth = c.req.header('authorization') ?? '';
	const bearer = auth.toLowerCase().startsWith('bearer ')
		? auth.slice(7).trim()
		: undefined;
	return (
		c.req.header(OWNER_SESSION_HEADER) ??
		bearer ??
		cookieValue(c.req.header('cookie') ?? '', OWNER_SESSION_COOKIE)
	);
}

/** Extracts daemon or share credentials from supported request transports. */
export function getRequestToken(c: Context): string | undefined {
	const auth = c.req.header('authorization') ?? '';
	const bearer = auth.toLowerCase().startsWith('bearer ')
		? auth.slice(7).trim()
		: undefined;
	return (
		c.req.header('x-otto-server-token') ??
		c.req.header(SHARE_TOKEN_HEADER) ??
		bearer ??
		cookieValue(c.req.header('cookie') ?? '', DAEMON_TOKEN_COOKIE)
	);
}

/** Checks whether a request bears the persistent daemon token. */
export async function isDaemonTokenAuthorized(c: Context): Promise<boolean> {
	const provided = getRequestToken(c);
	if (!provided) return false;
	return provided === (await ensureDaemonToken());
}

/** Returns true for daemon-global paths unavailable to project shares. */
export function isBlockedProjectSharePath(pathname: string): boolean {
	return (
		pathname.startsWith('/v1/projects') || pathname.startsWith('/v1/tunnel')
	);
}

/** Returns true when the request arrived through a non-loopback host. */
export function isTunnelRequest(c: Context): boolean {
	const hostname = new URL(c.req.url).hostname.toLowerCase();
	return (
		hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]'
	);
}

function isApiPath(pathname: string): boolean {
	return (
		pathname === '/v1' ||
		pathname.startsWith('/v1/') ||
		pathname === '/openapi.json'
	);
}

/** Authenticates tunneled API requests and pins project-scoped shares. */
export const tunnelAuthMiddleware: MiddlewareHandler = async (c, next) => {
	if (c.req.method === 'OPTIONS') {
		await next();
		return;
	}

	const pathname = new URL(c.req.url).pathname;
	const tunneled = isTunnelRequest(c);
	const terminalWsMatch = pathname.match(/^\/v1\/terminals\/([^/]+)\/ws$/);
	if (c.req.method === 'GET' && terminalWsMatch) {
		const ticketToken = c.req.query('ticket');
		if (!tunneled && !ticketToken) {
			await next();
			return;
		}
		const terminalId = decodeURIComponent(terminalWsMatch[1] ?? '');
		const ticket = ticketToken
			? consumeTerminalWebSocketTicket(ticketToken, terminalId)
			: undefined;
		if (!ticket) return c.json({ error: 'Unauthorized' }, 401);
		if (ticket.projectId) {
			c.req.raw.headers.set('x-otto-project-id', ticket.projectId);
			c.req.raw.headers.set(PINNED_PROJECT_HEADER, ticket.projectId);
			c.req.raw.headers.delete('x-otto-project');
		}
		await next();
		return;
	}
	if (!tunneled) {
		await next();
		return;
	}
	if (c.req.method === 'GET' && pathname === '/v1/tunnel/ping') {
		await next();
		return;
	}
	if (
		c.req.method === 'POST' &&
		(pathname === '/v1/tunnel/owner/challenge' ||
			pathname === '/v1/tunnel/owner/session')
	) {
		await next();
		return;
	}

	const provided = getRequestToken(c);
	if (provided && (await isDaemonTokenAuthorized(c))) {
		await next();
		return;
	}
	if (isOwnerSessionAuthorized(getOwnerSessionToken(c))) {
		await next();
		return;
	}

	const share = provided ? getShareByToken(provided) : undefined;
	if (share) {
		if (isBlockedProjectSharePath(pathname)) {
			return c.json(
				{ error: 'Project share cannot access daemon-global routes' },
				403,
			);
		}
		c.req.raw.headers.set('x-otto-project-id', share.projectId);
		c.req.raw.headers.set(PINNED_PROJECT_HEADER, share.projectId);
		c.req.raw.headers.delete('x-otto-project');
		await next();
		return;
	}

	if (isApiPath(pathname)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	await next();
};
