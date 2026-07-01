import { getOttoHomeDir } from '@ottocode/sdk';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export interface DaemonRegistration {
	id: string;
	version: string;
	url: string;
	pid: number;
	startedAt: number;
}

export interface DaemonHealth {
	port: number | null;
	version: string | null;
	pid: number;
	daemonId: string | null;
	startedAt: number;
}

export type DaemonStatus =
	| { state: 'running'; registration: DaemonRegistration; health: DaemonHealth }
	| { state: 'stale'; registration: DaemonRegistration; reason: string }
	| { state: 'missing' };

export interface DaemonPaths {
	dir: string;
	registrationPath: string;
	tokenPath: string;
}

export interface DaemonServiceOptions {
	version: string;
	projectRoot?: string;
	port?: number;
	paths?: DaemonPaths;
	fetch?: typeof fetch;
	spawn?: typeof Bun.spawn;
	signal?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
}

export interface OpenProjectContext {
	baseUrl: string;
	projectId: string;
	projectRoot: string;
	token: string | null;
	authHeaders: Record<string, string>;
}

export interface DaemonProjectSummary {
	id: string;
	name: string;
	path: string;
	stateDir: string;
	dbPath: string;
	openedAt?: number;
	lastUsedAt: number;
	open: boolean;
}

export const DEFAULT_DAEMON_PORT = 47_477;

const HEALTH_TIMEOUT_MS = 1_500;

export function parseDaemonPort(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`Invalid daemon port: ${value}`);
	}
	return port;
}

export function getPreferredDaemonPort(
	port?: number,
	env: NodeJS.ProcessEnv = process.env,
): number {
	return port ?? parseDaemonPort(env.OTTO_DAEMON_PORT) ?? DEFAULT_DAEMON_PORT;
}

export function getDaemonSpawnCommand(
	projectRoot: string,
	executable = process.execPath,
	port?: number,
): string[] {
	const serveArgs = [
		'serve',
		'--api-only',
		'--no-open',
		'--daemon-register',
		'--port',
		String(getPreferredDaemonPort(port)),
		'--project',
		projectRoot,
	];
	if (basename(executable) === 'bun') {
		return [executable, 'run', 'apps/cli/index.ts', ...serveArgs];
	}
	return [executable, ...serveArgs];
}

export function getDaemonPaths(): DaemonPaths {
	const dir = getOttoHomeDir();
	return {
		dir,
		registrationPath: join(dir, 'server.json'),
		tokenPath: join(dir, 'server-token'),
	};
}

function pathsFromOptions(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): DaemonPaths {
	return options?.paths ?? getDaemonPaths();
}

export async function readDaemonRegistration(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<DaemonRegistration | null> {
	try {
		const parsed = (await Bun.file(
			pathsFromOptions(options).registrationPath,
		).json()) as Partial<DaemonRegistration>;
		if (
			typeof parsed.id !== 'string' ||
			typeof parsed.version !== 'string' ||
			typeof parsed.url !== 'string' ||
			typeof parsed.pid !== 'number' ||
			typeof parsed.startedAt !== 'number'
		) {
			return null;
		}
		return parsed as DaemonRegistration;
	} catch {
		return null;
	}
}

export async function writeDaemonRegistration(
	registration: DaemonRegistration,
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<void> {
	const paths = pathsFromOptions(options);
	await mkdir(paths.dir, { recursive: true });
	const tmpPath = `${paths.registrationPath}.${process.pid}.${Date.now()}.tmp`;
	await Bun.write(tmpPath, `${JSON.stringify(registration, null, 2)}\n`);
	await rename(tmpPath, paths.registrationPath);
}

export async function writeDaemonRegistrationFromServer(
	registration: DaemonRegistration,
): Promise<void> {
	await writeDaemonRegistration(registration);
}

export async function removeDaemonRegistration(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<void> {
	await rm(pathsFromOptions(options).registrationPath, { force: true });
}

export async function ensureDaemonToken(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<string> {
	const paths = pathsFromOptions(options);
	await mkdir(paths.dir, { recursive: true });
	try {
		const existing = (await Bun.file(paths.tokenPath).text()).trim();
		if (existing.length > 0) {
			await chmod(paths.tokenPath, 0o600).catch(() => {});
			return existing;
		}
	} catch {}

	const token =
		crypto.randomUUID().replace(/-/g, '') +
		crypto.randomUUID().replace(/-/g, '');
	await Bun.write(paths.tokenPath, `${token}\n`);
	await chmod(paths.tokenPath, 0o600).catch(() => {});
	return token;
}

export async function readDaemonToken(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<string | null> {
	try {
		return (
			(await Bun.file(pathsFromOptions(options).tokenPath).text()).trim() ||
			null
		);
	} catch {
		return null;
	}
}

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'X-Otto-Server-Token': token,
	};
}

export function daemonAuthHeaders(
	token: string | null,
): Record<string, string> {
	return token
		? {
				Authorization: `Bearer ${token}`,
				'X-Otto-Server-Token': token,
			}
		: {};
}

export async function fetchDaemonHealth(
	registration: DaemonRegistration,
	options: Pick<DaemonServiceOptions, 'paths' | 'fetch'> = {},
): Promise<DaemonHealth | null> {
	const token = await readDaemonToken(options);
	if (!token) return null;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
	try {
		const fetchImpl = options.fetch ?? fetch;
		const response = await fetchImpl(`${registration.url}/v1/server/info`, {
			headers: authHeaders(token),
			signal: controller.signal,
		});
		if (!response.ok) return null;
		const body = (await response.json()) as Partial<DaemonHealth>;
		if (
			typeof body.pid !== 'number' ||
			typeof body.startedAt !== 'number' ||
			(body.version !== null && typeof body.version !== 'string') ||
			(body.daemonId !== null && typeof body.daemonId !== 'string')
		) {
			return null;
		}
		return {
			port: typeof body.port === 'number' ? body.port : null,
			version: body.version ?? null,
			pid: body.pid,
			daemonId: body.daemonId ?? null,
			startedAt: body.startedAt,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

export async function getDaemonStatus(
	options: Pick<DaemonServiceOptions, 'version' | 'paths' | 'fetch'>,
): Promise<DaemonStatus> {
	const registration = await readDaemonRegistration(options);
	if (!registration) return { state: 'missing' };
	const health = await fetchDaemonHealth(registration, options);
	if (!health) {
		await removeDaemonRegistration(options);
		return { state: 'stale', registration, reason: 'health check failed' };
	}
	if (health.daemonId && health.daemonId !== registration.id) {
		await removeDaemonRegistration(options);
		return { state: 'stale', registration, reason: 'daemon id mismatch' };
	}
	if (health.pid !== registration.pid) {
		await removeDaemonRegistration(options);
		return { state: 'stale', registration, reason: 'pid mismatch' };
	}
	if (
		registration.version !== options.version ||
		health.version !== options.version
	) {
		return { state: 'stale', registration, reason: 'version mismatch' };
	}
	return { state: 'running', registration, health };
}

export async function ensureDaemon(
	options: DaemonServiceOptions,
): Promise<DaemonRegistration> {
	const current = await getDaemonStatus(options);
	if (current.state === 'running') return current.registration;
	if (current.state === 'stale' && current.reason !== 'version mismatch') {
		await removeDaemonRegistration(options);
	}
	return startDaemon(options);
}

export async function openProjectOnServer(options: {
	baseUrl: string;
	projectRoot: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<OpenProjectContext> {
	const fetchImpl = options.fetch ?? fetch;
	const token = options.token ?? (await readDaemonToken());
	const auth = daemonAuthHeaders(token);
	const response = await fetchImpl(`${options.baseUrl}/v1/projects/open`, {
		method: 'POST',
		headers: {
			...auth,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ path: options.projectRoot }),
	});
	if (!response.ok) {
		throw new Error(`Failed to open project on daemon: ${response.status}`);
	}
	const body = (await response.json()) as { id?: unknown; path?: unknown };
	if (typeof body.id !== 'string' || typeof body.path !== 'string') {
		throw new Error('Invalid project open response from daemon');
	}
	return {
		baseUrl: options.baseUrl,
		projectId: body.id,
		projectRoot: body.path,
		token,
		authHeaders: auth,
	};
}

export async function listProjectsOnServer(options: {
	baseUrl: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<DaemonProjectSummary[]> {
	const fetchImpl = options.fetch ?? fetch;
	const token = options.token ?? (await readDaemonToken());
	const response = await fetchImpl(`${options.baseUrl}/v1/projects`, {
		headers: daemonAuthHeaders(token),
	});
	if (!response.ok) {
		throw new Error(`Failed to list projects: ${response.status}`);
	}
	const body = (await response.json()) as { projects?: unknown };
	if (!Array.isArray(body.projects)) {
		throw new Error('Invalid projects response from daemon');
	}
	return body.projects as DaemonProjectSummary[];
}

export async function closeProjectOnServer(options: {
	baseUrl: string;
	projectId: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<void> {
	const fetchImpl = options.fetch ?? fetch;
	const token = options.token ?? (await readDaemonToken());
	const response = await fetchImpl(
		`${options.baseUrl}/v1/projects/${encodeURIComponent(options.projectId)}/close`,
		{
			method: 'DELETE',
			headers: daemonAuthHeaders(token),
		},
	);
	if (!response.ok) {
		throw new Error(`Failed to close project: ${response.status}`);
	}
}

export async function forgetProjectOnServer(options: {
	baseUrl: string;
	projectIdOrPath: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<void> {
	const fetchImpl = options.fetch ?? fetch;
	const token = options.token ?? (await readDaemonToken());
	const response = await fetchImpl(
		`${options.baseUrl}/v1/projects/${encodeURIComponent(options.projectIdOrPath)}`,
		{
			method: 'DELETE',
			headers: daemonAuthHeaders(token),
		},
	);
	if (!response.ok) {
		throw new Error(`Failed to forget project: ${response.status}`);
	}
}

export async function ensureDaemonProject(
	options: DaemonServiceOptions,
): Promise<OpenProjectContext> {
	const registration = await ensureDaemon(options);
	return openProjectOnServer({
		baseUrl: registration.url,
		projectRoot: options.projectRoot ?? process.cwd(),
		token: await readDaemonToken(options),
		fetch: options.fetch,
	});
}

export async function startDaemon(
	options: DaemonServiceOptions,
): Promise<DaemonRegistration> {
	const paths = pathsFromOptions(options);
	const token = await ensureDaemonToken(options);
	void token;
	const id = crypto.randomUUID();
	const projectRoot = resolve(options.projectRoot ?? process.cwd());
	const port = getPreferredDaemonPort(options.port);
	const spawnImpl = options.spawn ?? Bun.spawn;
	const proc = spawnImpl({
		cmd: getDaemonSpawnCommand(projectRoot, process.execPath, port),
		cwd: process.cwd(),
		env: {
			...process.env,
			OTTO_DAEMON_ID: id,
			OTTO_DAEMON_PORT: String(port),
		},
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
	});
	proc.unref();
	let exited = false;
	void proc.exited.then(() => {
		exited = true;
	});

	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(`otto daemon failed to start on port ${port}`);
		}
		const registration = await readDaemonRegistration({ paths });
		if (registration?.id === id) {
			const status = await getDaemonStatus({ ...options, paths });
			if (status.state === 'running') return status.registration;
		}
		await Bun.sleep(100);
	}
	throw new Error('Timed out waiting for otto daemon to start');
}

export async function stopDaemon(
	options: Pick<DaemonServiceOptions, 'paths' | 'fetch' | 'signal'>,
): Promise<boolean> {
	const registration = await readDaemonRegistration(options);
	if (!registration) return false;
	const health = await fetchDaemonHealth(registration, options);
	if (!health) {
		await removeDaemonRegistration(options);
		return false;
	}
	if (health.daemonId && health.daemonId !== registration.id) return false;
	if (health.pid !== registration.pid) return false;
	const signalImpl = options.signal ?? process.kill;
	const stopped = signalImpl(registration.pid, 'SIGTERM');
	await removeDaemonRegistration(options);
	return stopped;
}

export async function restartDaemon(
	options: DaemonServiceOptions,
): Promise<DaemonRegistration> {
	await stopDaemon(options);
	return startDaemon(options);
}

export async function rotateDaemonPassword(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<string> {
	const paths = pathsFromOptions(options);
	await mkdir(paths.dir, { recursive: true });
	const token =
		crypto.randomUUID().replace(/-/g, '') +
		crypto.randomUUID().replace(/-/g, '');
	await Bun.write(paths.tokenPath, `${token}\n`);
	await chmod(paths.tokenPath, 0o600).catch(() => {});
	return token;
}
