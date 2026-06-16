import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Context } from 'hono';

export type SimulatorStatus = 'idle' | 'starting' | 'connected' | 'error';

export interface SimulatorState {
	status: SimulatorStatus;
	url: string | null;
	deviceName: string | null;
	udid: string | null;
	port: number;
	error: string | null;
	updatedAt: string;
}

interface ServeSimCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface ServeSimCommand {
	command: string;
	cwd?: string;
}

const DEFAULT_PORT = 3200;
let previewProcess: ReturnType<typeof Bun.spawn> | null = null;
let previewStdout = '';
let previewStderr = '';
let cleanupHandlersRegistered = false;
let serveSimCommand: ServeSimCommand | null = null;

const state: SimulatorState = {
	status: 'idle',
	url: null,
	deviceName: null,
	udid: null,
	port: DEFAULT_PORT,
	error: null,
	updatedAt: new Date().toISOString(),
};

function updateState(updates: Partial<Omit<SimulatorState, 'updatedAt'>>) {
	Object.assign(state, updates, { updatedAt: new Date().toISOString() });
}

function isMacOS() {
	return process.platform === 'darwin';
}

function parseMaybeJsonLines(text: string): unknown[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
}

function findUrl(text: string): string | null {
	const match = text.match(/https?:\/\/[^\s"']+/);
	return match?.[0] ?? null;
}

function previewUrlForPort(port: number): string {
	return `http://localhost:${port}`;
}

function extractServeSimState(stdout: string, fallbackPort: number) {
	const jsonValues = parseMaybeJsonLines(stdout);
	let url = findUrl(stdout);
	let deviceName: string | null = null;
	let udid: string | null = null;

	for (const value of jsonValues) {
		if (!value || typeof value !== 'object') continue;
		const record = value as Record<string, unknown>;
		const candidates = Array.isArray(record.devices)
			? record.devices
			: Array.isArray(record.streams)
				? record.streams
				: [record];

		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== 'object') continue;
			const item = candidate as Record<string, unknown>;
			if (!url && typeof item.url === 'string') url = item.url;
			if (!url && typeof item.previewUrl === 'string') url = item.previewUrl;
			if (!url && typeof item.preview === 'string') url = item.preview;
			if (!deviceName && typeof item.name === 'string') deviceName = item.name;
			if (!deviceName && typeof item.deviceName === 'string') {
				deviceName = item.deviceName;
			}
			if (!udid && typeof item.udid === 'string') udid = item.udid;
		}
	}

	return {
		url: url ?? previewUrlForPort(fallbackPort),
		deviceName,
		udid,
	};
}

async function isPreviewUrlReady(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 750);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok || response.status < 500;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}
function markPreviewConnected(
	parsed: ReturnType<typeof extractServeSimState>,
	port: number,
) {
	updateState({
		status: 'connected',
		url: previewUrlForPort(port),
		deviceName: parsed.deviceName ?? state.deviceName,
		udid: parsed.udid ?? state.udid,
		port,
		error: null,
	});
}

async function detectRunningPreview(port: number) {
	if (!isMacOS()) return null;
	const previewUrl = previewUrlForPort(port);
	const runningStream = await getRunningServeSimStream(port);
	if (!runningStream || !(await isPreviewUrlReady(previewUrl))) return null;

	return { ...runningStream, url: previewUrl };
}

async function killProcessOnPort(port: number) {
	const proc = Bun.spawn(['lsof', '-ti', `:${port}`], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	const pids = stdout
		.split('\n')
		.map((pid) => pid.trim())
		.filter(Boolean);
	for (const pid of pids) {
		Bun.spawn(['kill', pid], { stdout: 'ignore', stderr: 'ignore' });
	}
}

function cleanupPreviewProcess() {
	if (previewProcess) {
		previewProcess.kill();
		previewProcess = null;
	}
}

function registerCleanupHandlers() {
	if (cleanupHandlersRegistered) return;
	cleanupHandlersRegistered = true;
	const cleanup = () => cleanupPreviewProcess();
	process.once('exit', cleanup);
	process.once('SIGINT', () => {
		cleanup();
		process.exit(130);
	});
	process.once('SIGTERM', () => {
		cleanup();
		process.exit(143);
	});
}

function getAgiBinDir() {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

function findServeSimCommand(): ServeSimCommand {
	if (serveSimCommand) return serveSimCommand;

	const installedBin = join(getAgiBinDir(), 'serve-sim');
	if (existsSync(installedBin)) {
		serveSimCommand = {
			command: installedBin,
			cwd: dirname(installedBin),
		};
		return serveSimCommand;
	}

	throw new Error(
		`Embedded serve-sim binary is not installed at ${installedBin}. Rebuild or restart Otto so bundled binaries are bootstrapped.`,
	);
}

function serveSimSpawnArgs(args: string[]) {
	const resolvedCommand = findServeSimCommand();
	return {
		cmd: [resolvedCommand.command, ...args],
		cwd: resolvedCommand.cwd,
	};
}

async function runServeSim(args: string[]): Promise<ServeSimCommandResult> {
	const resolved = serveSimSpawnArgs(args);
	const proc = Bun.spawn(resolved.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: resolved.cwd,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function parseRunningServeSimStream(stdout: string, fallbackPort: number) {
	for (const value of parseMaybeJsonLines(stdout)) {
		if (!value || typeof value !== 'object') continue;
		const record = value as Record<string, unknown>;
		const candidates = Array.isArray(record.devices)
			? record.devices
			: Array.isArray(record.streams)
				? record.streams
				: [record];

		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== 'object') continue;
			const item = candidate as Record<string, unknown>;
			if (item.running !== true) continue;

			const streamUrl =
				typeof item.streamUrl === 'string' ? item.streamUrl : null;
			const url = typeof item.url === 'string' ? item.url : null;
			if (!streamUrl && !url) continue;

			return {
				url: url ?? previewUrlForPort(fallbackPort),
				streamUrl,
				deviceName:
					typeof item.name === 'string'
						? item.name
						: typeof item.deviceName === 'string'
							? item.deviceName
							: null,
				udid:
					typeof item.udid === 'string'
						? item.udid
						: typeof item.device === 'string'
							? item.device
							: null,
			};
		}
	}

	return null;
}

async function getRunningServeSimStream(port: number) {
	const result = await runServeSim(['--list', '--quiet']).catch(() => null);
	if (!result) return null;
	if (result.exitCode !== 0) return null;

	const parsed = parseRunningServeSimStream(result.stdout, port);
	if (!parsed) return null;
	if (parsed.streamUrl && !(await isPreviewUrlReady(parsed.streamUrl))) {
		return null;
	}
	return parsed;
}

async function readPreviewStream(
	stream: ReadableStream<Uint8Array> | null,
	onChunk: (chunk: string) => void,
) {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			onChunk(decoder.decode(value, { stream: true }));
		}
	} catch {
		// Process shutdown can close streams while a read is pending.
	}
}

function startPreviewProcess(args: string[]) {
	previewStdout = '';
	previewStderr = '';
	const resolved = serveSimSpawnArgs(args);
	previewProcess = Bun.spawn(resolved.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: resolved.cwd,
	});
	readPreviewStream(
		previewProcess.stdout as ReadableStream<Uint8Array> | null,
		(chunk) => {
			previewStdout += chunk;
		},
	);
	readPreviewStream(
		previewProcess.stderr as ReadableStream<Uint8Array> | null,
		(chunk) => {
			previewStderr += chunk;
		},
	);
	void waitForPreviewUrl(state.port, 30_000).then((parsed) => {
		if (previewProcess && parsed) {
			markPreviewConnected(parsed, state.port);
		}
	});
	previewProcess.exited.then((exitCode) => {
		if (state.status === 'connected' || state.status === 'starting') {
			updateState({
				status: exitCode === 0 ? 'idle' : 'error',
				error: exitCode === 0 ? null : previewStderr || 'serve-sim exited',
			});
		}
		previewProcess = null;
	});
}

async function waitForPreviewUrl(port: number, timeoutMs = 15_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const parsed = await detectRunningPreview(port);
		if (parsed) return parsed;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return null;
}

export function getSimulatorStatus(): SimulatorState {
	return { ...state };
}

export async function refreshSimulatorStatus(): Promise<SimulatorState> {
	const parsed = await detectRunningPreview(state.port);
	if (parsed) {
		markPreviewConnected(parsed, state.port);
	} else if (
		state.status === 'connected' ||
		(state.status === 'starting' && !previewProcess)
	) {
		updateState({
			status: 'idle',
			url: null,
			deviceName: null,
			udid: null,
			error: null,
		});
	}
	return getSimulatorStatus();
}

export async function startSimulator(
	options: { port?: number; device?: string; openPanel?: boolean } = {},
) {
	if (!isMacOS()) {
		const error = 'serve-sim requires macOS with Xcode command line tools';
		updateState({ status: 'error', error });
		return { ok: false, ...getSimulatorStatus() };
	}

	const port = options.port ?? DEFAULT_PORT;
	updateState({ status: 'starting', error: null, port });
	try {
		findServeSimCommand();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		updateState({ status: 'error', error: message });
		return { ok: false, ...getSimulatorStatus(), error: message };
	}
	const runningPreview = await detectRunningPreview(port);
	if (runningPreview) {
		markPreviewConnected(runningPreview, port);
		return { ok: true, ...getSimulatorStatus(), stdout: previewStdout };
	}

	if (previewProcess) {
		const parsed = await waitForPreviewUrl(port, 1_000);
		if (parsed) {
			markPreviewConnected(parsed, port);
			return { ok: true, ...getSimulatorStatus(), stdout: previewStdout };
		}
		cleanupPreviewProcess();
		await killProcessOnPort(port);
	}

	await killProcessOnPort(port);
	registerCleanupHandlers();

	const args = ['--port', String(port)];
	if (options.device) args.push(options.device);

	startPreviewProcess(args);
	const parsed = await waitForPreviewUrl(port);
	if (!previewProcess || !parsed) {
		const error =
			previewStderr || previewStdout || 'Timed out waiting for serve-sim';
		cleanupPreviewProcess();
		await killProcessOnPort(port);
		updateState({ status: 'error', error });
		return { ok: false, error, stdout: previewStdout, stderr: previewStderr };
	}
	markPreviewConnected(parsed, port);

	return { ok: true, ...getSimulatorStatus(), stdout: previewStdout };
}

export async function listSimulators() {
	const result = await runServeSim(['--list', '--quiet']).catch((error) => ({
		exitCode: 1,
		stdout: '',
		stderr: error instanceof Error ? error.message : String(error),
	}));
	if (result.exitCode !== 0) {
		return {
			ok: false,
			error:
				result.stderr || result.stdout || 'Failed to list serve-sim streams',
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
	const parsed = parseRunningServeSimStream(result.stdout, state.port);
	if (parsed && (await isPreviewUrlReady(previewUrlForPort(state.port)))) {
		markPreviewConnected(parsed, state.port);
	} else if (state.status === 'connected') {
		updateState({
			status: 'idle',
			url: null,
			deviceName: null,
			udid: null,
			error: null,
		});
	}
	return { ok: true, state: getSimulatorStatus(), raw: result.stdout };
}

export async function stopSimulator(device?: string) {
	const port = state.port;
	cleanupPreviewProcess();
	const args = ['--kill', '--quiet'];
	if (device) args.push(device);
	const result = await runServeSim(args).catch((error) => ({
		exitCode: 1,
		stdout: '',
		stderr: error instanceof Error ? error.message : String(error),
	}));
	if (result.exitCode !== 0) {
		const error = result.stderr || result.stdout || 'Failed to stop serve-sim';
		updateState({ status: 'error', error });
		return { ok: false, error, stdout: result.stdout, stderr: result.stderr };
	}
	await killProcessOnPort(port);
	updateState({
		status: 'idle',
		url: null,
		deviceName: null,
		udid: null,
		error: null,
	});
	return { ok: true, ...getSimulatorStatus(), stdout: result.stdout };
}

export async function sendSimulatorButton(name = 'home', device?: string) {
	const args = ['button', name, '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		button: name,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}

export async function sendSimulatorGesture(gesture: unknown, device?: string) {
	const args = ['gesture', JSON.stringify(gesture), '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		gesture,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}

export async function rotateSimulator(orientation: string, device?: string) {
	const args = ['rotate', orientation, '--quiet'];
	if (device) args.push('-d', device);
	const result = await runServeSim(args);
	return {
		ok: result.exitCode === 0,
		orientation,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
	};
}

export async function getSimulatorLogs(c: Context) {
	if (!state.url) {
		return c.json(
			{ ok: false, error: 'No serve-sim preview URL is active' },
			400,
		);
	}
	const logsUrl = new URL('/logs', state.url).toString();
	try {
		const response = await fetch(logsUrl);
		const text = await response.text();
		return c.json({ ok: response.ok, logs: text, url: logsUrl });
	} catch (error) {
		return c.json(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
}
