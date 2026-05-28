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

const DEFAULT_PORT = 3200;
let previewProcess: ReturnType<typeof Bun.spawn> | null = null;
let previewStdout = '';
let previewStderr = '';
let cleanupHandlersRegistered = false;

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
		url: url ?? `http://localhost:${fallbackPort}`,
		deviceName,
		udid,
	};
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

async function runServeSim(args: string[]): Promise<ServeSimCommandResult> {
	const proc = Bun.spawn(['bunx', 'serve-sim', ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
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
	previewProcess = Bun.spawn(['bunx', 'serve-sim', ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	readPreviewStream(
		previewProcess.stdout as ReadableStream<Uint8Array> | null,
		(chunk) => {
			previewStdout += chunk;
			const parsed = extractServeSimState(previewStdout, state.port);
			if (parsed.url) {
				updateState({
					status: 'connected',
					url: parsed.url,
					deviceName: parsed.deviceName ?? state.deviceName,
					udid: parsed.udid ?? state.udid,
					error: null,
				});
			}
		},
	);
	readPreviewStream(
		previewProcess.stderr as ReadableStream<Uint8Array> | null,
		(chunk) => {
			previewStderr += chunk;
		},
	);
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

async function waitForPreviewUrl(port: number, timeoutMs = 3500) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const parsed = extractServeSimState(previewStdout, port);
		if (parsed.url && parsed.url !== `http://localhost:${port}`) return parsed;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return extractServeSimState(previewStdout, port);
}

export function getSimulatorStatus(): SimulatorState {
	return { ...state };
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

	if (previewProcess) {
		return { ok: true, ...getSimulatorStatus(), stdout: previewStdout };
	}

	await killProcessOnPort(port);
	registerCleanupHandlers();

	const args = ['--port', String(port)];
	if (options.device) args.push(options.device);

	startPreviewProcess(args);
	const parsed = await waitForPreviewUrl(port);
	if (!previewProcess) {
		const error = previewStderr || previewStdout || 'Failed to start serve-sim';
		updateState({ status: 'error', error });
		return { ok: false, error, stdout: previewStdout, stderr: previewStderr };
	}
	updateState({
		status: 'connected',
		url: parsed.url,
		deviceName: parsed.deviceName,
		udid: parsed.udid,
		port,
		error: null,
	});

	return { ok: true, ...getSimulatorStatus(), stdout: previewStdout };
}

export async function listSimulators() {
	const result = await runServeSim(['--list', '--quiet']);
	if (result.exitCode !== 0) {
		return {
			ok: false,
			error:
				result.stderr || result.stdout || 'Failed to list serve-sim streams',
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
	const parsed = extractServeSimState(result.stdout, state.port);
	if (parsed.url) {
		updateState({
			status: 'connected',
			url: parsed.url,
			deviceName: parsed.deviceName ?? state.deviceName,
			udid: parsed.udid ?? state.udid,
			error: null,
		});
	}
	return { ok: true, state: getSimulatorStatus(), raw: result.stdout };
}

export async function stopSimulator(device?: string) {
	cleanupPreviewProcess();
	const args = ['--kill', '--quiet'];
	if (device) args.push(device);
	const result = await runServeSim(args);
	if (result.exitCode !== 0) {
		const error = result.stderr || result.stdout || 'Failed to stop serve-sim';
		updateState({ status: 'error', error });
		return { ok: false, error, stdout: result.stdout, stderr: result.stderr };
	}
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
