import {
	getServeSimAvailability,
	runServeSim,
	serveSimSpawnArgs,
} from './command.ts';
import {
	DEFAULT_PORT,
	getSimulatorStatus,
	simulatorRuntime,
	simulatorState,
	updateState,
} from './state.ts';
import type { ParsedServeSimState } from './types.ts';

export function isMacOS() {
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

export function previewUrlForPort(port: number): string {
	return `http://localhost:${port}`;
}

function extractServeSimState(
	stdout: string,
	fallbackPort: number,
): ParsedServeSimState {
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

export async function isPreviewUrlReady(
	url: string,
	timeoutMs = 2_000,
): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok || response.status < 500;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

export function markPreviewConnected(
	parsed: ReturnType<typeof extractServeSimState>,
	port: number,
): void {
	simulatorRuntime.consecutiveProbeFailures = 0;
	updateState({
		status: 'connected',
		url: previewUrlForPort(port),
		deviceName: parsed.deviceName ?? simulatorState.deviceName,
		udid: parsed.udid ?? simulatorState.udid,
		port,
		error: null,
	});
}

export async function detectRunningPreview(port: number) {
	if (!isMacOS()) return null;
	const previewUrl = previewUrlForPort(port);
	// The reachable preview server is the source of truth. `serve-sim --list`
	// runs as a separate short-lived process (especially via `bun x`/`npx`) and
	// may not observe the just-started stream yet, so it is only used to enrich
	// device metadata once the preview page is confirmed live.
	if (!(await isPreviewUrlReady(previewUrl))) return null;

	const runningStream = await getRunningServeSimStream(port).catch(() => null);
	return {
		url: previewUrl,
		streamUrl: runningStream?.streamUrl ?? null,
		deviceName: runningStream?.deviceName ?? null,
		udid: runningStream?.udid ?? null,
	};
}

export async function killProcessOnPort(port: number): Promise<void> {
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

export function cleanupPreviewProcess(): void {
	if (simulatorRuntime.previewProcess) {
		simulatorRuntime.previewProcess.kill();
		simulatorRuntime.previewProcess = null;
	}
}

export function registerCleanupHandlers(): void {
	if (simulatorRuntime.cleanupHandlersRegistered) return;
	simulatorRuntime.cleanupHandlersRegistered = true;
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
	return parsed;
}

async function readPreviewStream(
	stream: ReadableStream<Uint8Array> | null,
	onChunk: (chunk: string) => void,
): Promise<void> {
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

export function startPreviewProcess(args: string[]): void {
	simulatorRuntime.previewStdout = '';
	simulatorRuntime.previewStderr = '';
	const resolved = serveSimSpawnArgs(args);
	simulatorRuntime.previewProcess = Bun.spawn(resolved.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: resolved.cwd,
	});
	readPreviewStream(
		simulatorRuntime.previewProcess.stdout as ReadableStream<Uint8Array> | null,
		(chunk) => {
			simulatorRuntime.previewStdout += chunk;
		},
	);
	readPreviewStream(
		simulatorRuntime.previewProcess.stderr as ReadableStream<Uint8Array> | null,
		(chunk) => {
			simulatorRuntime.previewStderr += chunk;
		},
	);
	void waitForPreviewUrl(simulatorState.port, 30_000).then((parsed) => {
		if (simulatorRuntime.previewProcess && parsed) {
			markPreviewConnected(parsed, simulatorState.port);
		}
	});
	simulatorRuntime.previewProcess.exited.then(async (exitCode) => {
		simulatorRuntime.previewProcess = null;

		// The foreground runner (e.g. `bun x`/`npx`) can exit while serve-sim's
		// helper keeps the preview server alive. Treat a still-reachable preview
		// URL as connected instead of reporting a spurious failure.
		if (await isPreviewUrlReady(previewUrlForPort(simulatorState.port))) {
			markPreviewConnected(
				{
					url: previewUrlForPort(simulatorState.port),
					deviceName: simulatorState.deviceName,
					udid: simulatorState.udid,
				},
				simulatorState.port,
			);
			return;
		}

		if (
			simulatorState.status === 'connected' ||
			simulatorState.status === 'starting'
		) {
			updateState({
				status: exitCode === 0 ? 'idle' : 'error',
				error:
					exitCode === 0
						? null
						: simulatorRuntime.previewStderr || 'serve-sim exited',
			});
		}
	});
}

export async function waitForPreviewUrl(port: number, timeoutMs = 15_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const parsed = await detectRunningPreview(port);
		if (parsed) return parsed;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return null;
}

// Number of consecutive failed probes tolerated before a connected preview is
// considered gone. Status polling runs ~every 3s, so this keeps a working
// preview stable through transient probe timeouts / first-paint stalls.
const MAX_PROBE_FAILURES = 3;

async function probePreviewLive(url: string): Promise<boolean> {
	// Two quick attempts smooth over a single slow response without delaying
	// the status endpoint noticeably.
	for (let attempt = 0; attempt < 2; attempt++) {
		if (await isPreviewUrlReady(url)) return true;
	}
	return false;
}

export async function refreshSimulatorStatus() {
	const availability = getServeSimAvailability();
	updateState({
		setupStatus: availability.setupStatus,
		setupMessage: availability.setupMessage,
		runner: availability.runner,
	});

	// A live preview server is authoritative: if the page still responds we keep
	// the connected state even if the runner check or `--list` momentarily fail.
	const port = simulatorState.port;
	const previewLive = await probePreviewLive(previewUrlForPort(port));
	if (previewLive) {
		simulatorRuntime.consecutiveProbeFailures = 0;
		const parsed = await detectRunningPreview(port);
		markPreviewConnected(
			parsed ?? {
				url: previewUrlForPort(port),
				deviceName: simulatorState.deviceName,
				udid: simulatorState.udid,
			},
			port,
		);
		return getSimulatorStatus();
	}

	if (availability.setupStatus !== 'ready') {
		if (
			simulatorState.status === 'connected' ||
			simulatorState.status === 'starting'
		) {
			updateState({
				status: 'error',
				url: null,
				deviceName: null,
				udid: null,
				error: availability.setupMessage,
			});
		}
		return getSimulatorStatus();
	}

	// Preview is not reachable. Tolerate a few transient failures before tearing
	// down a connected preview, and never reset while the spawned process is
	// still alive (it may still be starting up).
	const wasActive =
		simulatorState.status === 'connected' ||
		simulatorState.status === 'starting';
	if (!wasActive) {
		simulatorRuntime.consecutiveProbeFailures = 0;
		return getSimulatorStatus();
	}

	if (simulatorRuntime.previewProcess) {
		// Process still running: keep waiting, don't count this as a teardown.
		return getSimulatorStatus();
	}

	simulatorRuntime.consecutiveProbeFailures += 1;
	if (simulatorRuntime.consecutiveProbeFailures < MAX_PROBE_FAILURES) {
		return getSimulatorStatus();
	}

	simulatorRuntime.consecutiveProbeFailures = 0;
	updateState({
		status: 'idle',
		url: null,
		deviceName: null,
		udid: null,
		error: null,
	});
	return getSimulatorStatus();
}

export { DEFAULT_PORT };
