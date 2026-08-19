import { getOttoHomeDir } from '@ottocode/sdk';
import { compareReleaseVersions } from '@ottocode/sdk/release';
import type { ListProjectsResponse } from '@ottocode/api';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { parseOptionalCliPort } from './runtime/network.ts';
import { basename, join, resolve } from 'node:path';
import { createDaemonApi, type DaemonApi } from './runtime/daemon-api.ts';

export { daemonAuthHeaders } from './runtime/daemon-api.ts';

export interface DaemonRegistration {
	id: string;
	version: string;
	url: string;
	pid: number;
	startedAt: number;
}

export interface ActiveDaemonSelection {
	path: string;
	version: string;
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
	| {
			state: 'stale';
			registration: DaemonRegistration;
			reason: string;
			health?: DaemonHealth;
	  }
	| { state: 'missing' };

export class DaemonVersionMismatchError extends Error {
	readonly cliVersion: string;
	readonly daemonVersion: string;

	constructor(cliVersion: string, daemonVersion: string) {
		super(
			`Otto daemon v${daemonVersion} is newer than CLI v${cliVersion}. Upgrade the CLI before continuing.`,
		);
		this.name = 'DaemonVersionMismatchError';
		this.cliVersion = cliVersion;
		this.daemonVersion = daemonVersion;
	}
}

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
	isProcessAlive?: (pid: number) => boolean;
	isPortAvailable?: (port: number) => Promise<boolean>;
	sleep?: (ms: number) => Promise<void>;
	shutdownTimeoutMs?: number;
	startupTimeoutMs?: number;
}

export interface OpenProjectContext {
	baseUrl: string;
	projectId: string;
	projectRoot: string;
	token: string | null;
	authHeaders: Record<string, string>;
}

export type DaemonProjectSummary = ListProjectsResponse['projects'][number];

export const DEFAULT_DAEMON_PORT = 47_477;

const HEALTH_TIMEOUT_MS = 1_500;
const PROCESS_POLL_INTERVAL_MS = 100;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const STARTUP_TIMEOUT_MS = 10_000;
const SOURCE_CLI_ENTRY = resolve(import.meta.dir, '..', 'index.ts');

export function parseDaemonPort(value: string | undefined): number | undefined {
	return parseOptionalCliPort(value, {
		allowZero: false,
		name: 'daemon port',
	});
}

export function getPreferredDaemonPort(
	port?: number,
	env: NodeJS.ProcessEnv = process.env,
): number {
	return port ?? parseDaemonPort(env.OTTO_DAEMON_PORT) ?? DEFAULT_DAEMON_PORT;
}

/** Spawns a detached daemon with a caller-provided handoff identity. */
export function spawnDaemonProcess(options: {
	projectRoot: string;
	executable: string;
	port: number;
	daemonId: string;
	spawn?: typeof Bun.spawn;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): ReturnType<typeof Bun.spawn> {
	const spawn = options.spawn ?? Bun.spawn;
	const proc = spawn({
		cmd: getDaemonSpawnCommand(
			options.projectRoot,
			options.executable,
			options.port,
		),
		cwd: options.cwd ?? process.cwd(),
		env: {
			...(options.env ?? process.env),
			OTTO_DAEMON_ID: options.daemonId,
			OTTO_DAEMON_PORT: String(options.port),
		},
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
	});
	proc.unref();
	return proc;
}

export async function isDaemonPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolveAvailable) => {
		const server = createServer();
		server.unref();
		server.once('error', () => resolveAvailable(false));
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolveAvailable(true));
		});
	});
}

/** Waits until a loopback port can be bound by a replacement daemon. */
export async function waitForDaemonPortRelease(options: {
	port: number;
	timeoutMs?: number;
	isPortAvailable?: (port: number) => Promise<boolean>;
	sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
	const deadline = Date.now() + (options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS);
	const available = options.isPortAvailable ?? isDaemonPortAvailable;
	const sleep = options.sleep ?? Bun.sleep;
	while (!(await available(options.port))) {
		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for daemon port ${options.port} to be released`,
			);
		}
		await sleep(PROCESS_POLL_INTERVAL_MS);
	}
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
	if (/^bun(?:\.exe)?$/.test(basename(executable))) {
		return [executable, 'run', SOURCE_CLI_ENTRY, ...serveArgs];
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

function activeDaemonPath(
	options?: Pick<DaemonServiceOptions, 'paths'>,
): string {
	return join(pathsFromOptions(options).dir, 'active-daemon.json');
}

function compareDaemonVersions(left: string, right: string): number | null {
	try {
		return compareReleaseVersions(left, right);
	} catch {
		return null;
	}
}

function daemonVersionsEqual(left: string | null, right: string): boolean {
	return left !== null && compareDaemonVersions(left, right) === 0;
}

/** Reads a valid activated daemon binary that is at least as new as the CLI. */
export async function readActiveDaemonSelection(
	installedVersion: string,
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<ActiveDaemonSelection | null> {
	try {
		const parsed = (await Bun.file(
			activeDaemonPath(options),
		).json()) as Partial<ActiveDaemonSelection>;
		if (
			typeof parsed.path !== 'string' ||
			typeof parsed.version !== 'string' ||
			(compareDaemonVersions(parsed.version, installedVersion) ?? -1) < 0
		) {
			return null;
		}
		const info = await stat(parsed.path);
		return info.isFile() ? (parsed as ActiveDaemonSelection) : null;
	} catch {
		return null;
	}
}

/** Atomically persists a health-verified activated daemon binary. */
export async function writeActiveDaemonSelection(
	selection: ActiveDaemonSelection,
	options?: Pick<DaemonServiceOptions, 'paths'>,
): Promise<void> {
	const paths = pathsFromOptions(options);
	await mkdir(paths.dir, { recursive: true });
	const destination = activeDaemonPath(options);
	const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
	await Bun.write(temporary, `${JSON.stringify(selection, null, 2)}\n`);
	await rename(temporary, destination);
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

export async function fetchDaemonHealth(
	registration: DaemonRegistration,
	options: Pick<DaemonServiceOptions, 'paths' | 'fetch'> = {},
): Promise<DaemonHealth | null> {
	const token = await readDaemonToken(options);
	if (!token) return null;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
	try {
		const body = await createDaemonApi({
			baseUrl: registration.url,
			token,
			fetch: options.fetch,
		}).getServerInfo(controller.signal);
		return {
			port: body.port,
			version: body.version,
			pid: body.pid,
			daemonId: body.daemonId,
			startedAt: body.startedAt,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function daemonIdentityMatches(
	registration: DaemonRegistration,
	health: DaemonHealth,
): boolean {
	return health.pid === registration.pid && health.daemonId === registration.id;
}

function processIsAlive(pid: number): boolean {
	try {
		return process.kill(pid, 0);
	} catch (error) {
		return !(
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ESRCH'
		);
	}
}

async function removeRegistrationIfCurrent(
	registration: DaemonRegistration,
	options: Pick<DaemonServiceOptions, 'paths'>,
): Promise<void> {
	const current = await readDaemonRegistration(options);
	if (
		current?.id === registration.id &&
		current.pid === registration.pid &&
		current.startedAt === registration.startedAt
	) {
		await removeDaemonRegistration(options);
	}
}

export async function getDaemonStatus(
	options: Pick<
		DaemonServiceOptions,
		'version' | 'paths' | 'fetch' | 'isProcessAlive'
	>,
): Promise<DaemonStatus> {
	const active = await readActiveDaemonSelection(options.version, options);
	const expectedVersion = active?.version ?? options.version;
	const registration = await readDaemonRegistration(options);
	if (!registration) return { state: 'missing' };
	const health = await fetchDaemonHealth(registration, options);
	if (!health) {
		if (!(options.isProcessAlive ?? processIsAlive)(registration.pid)) {
			await removeRegistrationIfCurrent(registration, options);
		}
		return { state: 'stale', registration, reason: 'health check failed' };
	}
	if (health.daemonId !== registration.id) {
		return { state: 'stale', registration, reason: 'daemon id mismatch' };
	}
	if (health.pid !== registration.pid) {
		return { state: 'stale', registration, reason: 'pid mismatch' };
	}
	if (
		!daemonVersionsEqual(registration.version, expectedVersion) ||
		!daemonVersionsEqual(health.version, expectedVersion)
	) {
		return {
			state: 'stale',
			registration,
			health,
			reason: 'version mismatch',
		};
	}
	return { state: 'running', registration, health };
}

export async function ensureDaemon(
	options: DaemonServiceOptions,
): Promise<DaemonRegistration> {
	const current = await getDaemonStatus(options);
	if (current.state === 'running') {
		if (
			(compareDaemonVersions(current.registration.version, options.version) ??
				0) > 0
		) {
			throw new DaemonVersionMismatchError(
				options.version,
				current.registration.version,
			);
		}
		return current.registration;
	}
	if (current.state === 'stale') {
		if (current.reason === 'version mismatch') {
			const daemonVersion =
				current.health?.version ?? current.registration.version;
			if ((compareDaemonVersions(daemonVersion, options.version) ?? 0) > 0) {
				throw new DaemonVersionMismatchError(options.version, daemonVersion);
			}
			await stopDaemon(options);
		} else {
			const remaining = await readDaemonRegistration(options);
			if (remaining) {
				throw new Error(`Cannot replace daemon: ${current.reason}`);
			}
		}
	}
	return startDaemon(options);
}

export async function openProjectOnServer(options: {
	baseUrl: string;
	projectRoot: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<OpenProjectContext> {
	const token = options.token ?? (await readDaemonToken());
	const api = createDaemonApi({
		baseUrl: options.baseUrl,
		token,
		fetch: options.fetch,
	});
	const body = await api.openProject(options.projectRoot);
	return {
		baseUrl: options.baseUrl,
		projectId: body.id,
		projectRoot: body.path,
		token,
		authHeaders: api.headers,
	};
}

export async function listProjectsOnServer(options: {
	baseUrl: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<DaemonProjectSummary[]> {
	const token = options.token ?? (await readDaemonToken());
	return createDaemonApi({
		baseUrl: options.baseUrl,
		token,
		fetch: options.fetch,
	}).listProjects();
}

export async function closeProjectOnServer(options: {
	baseUrl: string;
	projectId: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<void> {
	const token = options.token ?? (await readDaemonToken());
	await createDaemonApi({
		baseUrl: options.baseUrl,
		token,
		fetch: options.fetch,
	}).closeProject(options.projectId);
}

export async function forgetProjectOnServer(options: {
	baseUrl: string;
	projectIdOrPath: string;
	token?: string | null;
	fetch?: typeof fetch;
}): Promise<void> {
	const token = options.token ?? (await readDaemonToken());
	await createDaemonApi({
		baseUrl: options.baseUrl,
		token,
		fetch: options.fetch,
	}).forgetProject(options.projectIdOrPath);
}

/** Starts or reuses the daemon and returns its canonical generated API client. */
export async function connectDaemonApi(
	options: DaemonServiceOptions,
): Promise<DaemonApi> {
	const registration = await ensureDaemon(options);
	return createDaemonApi({
		baseUrl: registration.url,
		token: await readDaemonToken(options),
		fetch: options.fetch,
	});
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
	const active = await readActiveDaemonSelection(options.version, options);
	const executable = active?.path ?? process.execPath;
	await waitForDaemonPortRelease({
		port,
		timeoutMs: options.startupTimeoutMs,
		isPortAvailable: options.isPortAvailable,
		sleep: options.sleep,
	});
	const proc = spawnDaemonProcess({
		projectRoot,
		executable,
		port,
		daemonId: id,
		spawn: options.spawn,
	});
	let exited = false;
	void proc.exited.then(() => {
		exited = true;
	});

	const deadline =
		Date.now() + (options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
	const sleep = options.sleep ?? Bun.sleep;
	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(`otto daemon failed to start on port ${port}`);
		}
		const registration = await readDaemonRegistration({ paths });
		if (registration?.id === id) {
			const status = await getDaemonStatus({ ...options, paths });
			if (status.state === 'running') return status.registration;
		}
		await sleep(PROCESS_POLL_INTERVAL_MS);
	}
	throw new Error('Timed out waiting for otto daemon to start');
}

export async function stopDaemon(
	options: Pick<
		DaemonServiceOptions,
		| 'paths'
		| 'fetch'
		| 'signal'
		| 'isProcessAlive'
		| 'sleep'
		| 'shutdownTimeoutMs'
	>,
): Promise<boolean> {
	const registration = await readDaemonRegistration(options);
	if (!registration) return false;
	const health = await fetchDaemonHealth(registration, options);
	if (!health) {
		const alive = (options.isProcessAlive ?? processIsAlive)(registration.pid);
		if (alive) {
			throw new Error(
				'Daemon is still running but authenticated health failed',
			);
		}
		await removeRegistrationIfCurrent(registration, options);
		return false;
	}
	if (!daemonIdentityMatches(registration, health)) return false;
	const signalImpl = options.signal ?? process.kill;
	let signaled = false;
	try {
		signaled = signalImpl(registration.pid, 'SIGTERM');
	} catch (error) {
		if (
			!(
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ESRCH'
			)
		) {
			throw error;
		}
	}

	const isAlive = options.isProcessAlive ?? processIsAlive;
	const sleep = options.sleep ?? Bun.sleep;
	const deadline =
		Date.now() + (options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS);
	while (true) {
		const [alive, currentHealth] = await Promise.all([
			Promise.resolve(isAlive(registration.pid)),
			fetchDaemonHealth(registration, options),
		]);
		if (!alive && !currentHealth) {
			await removeRegistrationIfCurrent(registration, options);
			return signaled;
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for daemon process ${registration.pid} to stop`,
			);
		}
		await sleep(PROCESS_POLL_INTERVAL_MS);
	}
}

export async function restartDaemon(
	options: DaemonServiceOptions,
): Promise<DaemonRegistration> {
	const registration = await readDaemonRegistration(options);
	await stopDaemon(options);
	let previousPort: number | null = null;
	if (registration) {
		try {
			previousPort = Number(new URL(registration.url).port) || null;
		} catch {}
	}
	await waitForDaemonPortRelease({
		port: previousPort ?? getPreferredDaemonPort(options.port),
		timeoutMs: options.shutdownTimeoutMs,
		isPortAvailable: options.isPortAvailable,
		sleep: options.sleep,
	});
	return startDaemon(options);
}

export async function rotateDaemonPassword(
	options: Pick<DaemonServiceOptions, 'paths' | 'fetch'> = {},
): Promise<string> {
	const paths = pathsFromOptions(options);
	const registration = await readDaemonRegistration(options);
	if (registration) {
		const health = await fetchDaemonHealth(registration, options);
		if (health && daemonIdentityMatches(registration, health)) {
			throw new Error('Stop the daemon before rotating its token.');
		}
	}
	await mkdir(paths.dir, { recursive: true });
	const token =
		crypto.randomUUID().replace(/-/g, '') +
		crypto.randomUUID().replace(/-/g, '');
	await Bun.write(paths.tokenPath, `${token}\n`);
	await chmod(paths.tokenPath, 0o600).catch(() => {});
	return token;
}
