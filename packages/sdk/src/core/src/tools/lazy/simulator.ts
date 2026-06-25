import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { createToolError } from '../error.ts';

const DEFAULT_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
const LOG_TIMEOUT_MS = 2_000;
const DEFAULT_PREVIEW_PORT = 3200;
const DEFAULT_PREVIEW_URL = `http://localhost:${DEFAULT_PREVIEW_PORT}`;
const SCREENSHOT_ARTIFACTS_DIR = '.otto/artifacts/simulator';
const SCREENSHOT_MODEL_MAX_EDGE = 1024;
const SCREENSHOT_MODEL_JPEG_QUALITY = 70;
const HID_KEYBOARD_LEFT_GUI = 227;
const HID_KEYBOARD_V = 25;

let previewProcess: ChildProcess | null = null;
let previewStdout = '';
let previewStderr = '';
type ServeSimCommand = {
	command: string;
	argsPrefix: string[];
	cwd?: string;
	runner: string;
};

let serveSimCommand: ServeSimCommand | null = null;

const buttonNames = [
	'home',
	'swipe_home',
	'app_switcher',
	'lock',
	'siri',
	'side_button',
] as const;

const orientations = [
	'portrait',
	'portrait_upside_down',
	'landscape_left',
	'landscape_right',
] as const;

const caDebugOptions = [
	'blended',
	'copies',
	'misaligned',
	'offscreen',
	'slow-animations',
] as const;

const cameraSources = ['placeholder', 'webcam', 'file'] as const;

const mirrorModes = ['auto', 'on', 'off'] as const;

const permissionActions = ['grant', 'revoke', 'reset', 'list'] as const;

const permissionNames = [
	'all',
	'notifications',
	'push',
	'location',
	'location-always',
	'location-inuse',
	'camera',
	'microphone',
	'mic',
	'photos',
	'photo-library',
	'photo',
	'photos-add',
	'contacts',
	'calendar',
	'reminders',
	'motion',
	'media-library',
	'siri',
	'speech',
	'faceid',
	'user-tracking',
	'homekit',
] as const;

const simulatorActions = [
	'start',
	'status',
	'stop',
	'click',
	'gesture',
	'drag',
	'type',
	'paste',
	'button',
	'rotate',
	'ca_debug',
	'memory_warning',
	'camera_start',
	'camera_switch',
	'camera_mirror',
	'camera_status',
	'camera_stop',
	'camera_list_webcams',
	'permissions',
	'config',
	'accessibility_tree',
	'foreground',
	'take_screenshot',
	'launch',
	'terminate',
	'open_url',
	'list_apps',
	'logs',
] as const;

type ServeSimEntry = {
	device?: string;
	pid?: number;
	port?: number;
	url?: string;
	streamUrl?: string;
	wsUrl?: string;
};

type ExecResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type BunImageMetadata = {
	width?: number;
	height?: number;
	format?: string;
};

type BunImagePipeline = {
	metadata(): Promise<BunImageMetadata>;
	resize(
		width: number,
		height?: number,
		options?: {
			fit?: 'inside';
			withoutEnlargement?: boolean;
		},
	): BunImagePipeline;
	jpeg(options?: { quality?: number }): BunImagePipeline;
	bytes(): Promise<Uint8Array>;
};

type BunImageConstructor = new (
	input: string | ArrayBuffer | Uint8Array | Blob,
) => BunImagePipeline;

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

const simulatorInputSchema = z.object({
	action: z.enum(simulatorActions),
	device: z.string().optional(),
	x: z.number().min(0).max(1).optional(),
	y: z.number().min(0).max(1).optional(),
	startX: z.number().min(0).max(1).optional(),
	startY: z.number().min(0).max(1).optional(),
	endX: z.number().min(0).max(1).optional(),
	endY: z.number().min(0).max(1).optional(),
	gesture: z.unknown().optional(),
	text: z.string().optional(),
	name: z.enum(buttonNames).optional(),
	orientation: z.enum(orientations).optional(),
	caDebug: z.enum(caDebugOptions).optional(),
	enabled: z.boolean().optional(),
	cameraSource: z.enum(cameraSources).optional(),
	file: z.string().optional(),
	webcam: z.string().optional(),
	mirror: z.enum(mirrorModes).optional(),
	permissionAction: z.enum(permissionActions).optional(),
	permission: z.enum(permissionNames).optional(),
	value: z.string().optional(),
	bundleId: z.string().optional(),
	url: z.string().optional(),
	args: z.array(z.string()).optional(),
	outputPath: z.string().optional(),
	timeoutMs: z.number().min(250).max(10_000).optional(),
	durationMs: z.number().min(16).max(10_000).optional(),
	steps: z.number().int().min(2).max(240).optional(),
});

type SimulatorInput =
	| { action: 'start'; device?: string }
	| { action: 'status'; device?: string }
	| { action: 'stop'; device?: string }
	| { action: 'click'; x: number; y: number; device?: string }
	| { action: 'gesture'; gesture: unknown; device?: string }
	| {
			action: 'drag';
			startX: number;
			startY: number;
			endX: number;
			endY: number;
			device?: string;
			durationMs?: number;
			steps?: number;
	  }
	| { action: 'type'; text: string; device?: string }
	| { action: 'paste'; text: string; device?: string }
	| { action: 'button'; name: (typeof buttonNames)[number]; device?: string }
	| {
			action: 'rotate';
			orientation: (typeof orientations)[number];
			device?: string;
	  }
	| {
			action: 'ca_debug';
			caDebug: (typeof caDebugOptions)[number];
			enabled: boolean;
			device?: string;
	  }
	| { action: 'memory_warning'; device?: string }
	| {
			action: 'camera_start';
			bundleId: string;
			cameraSource?: (typeof cameraSources)[number];
			file?: string;
			webcam?: string;
			mirror?: (typeof mirrorModes)[number];
			device?: string;
	  }
	| {
			action: 'camera_switch';
			cameraSource: (typeof cameraSources)[number];
			file?: string;
			webcam?: string;
			device?: string;
	  }
	| {
			action: 'camera_mirror';
			mirror: (typeof mirrorModes)[number];
			device?: string;
	  }
	| { action: 'camera_status'; device?: string }
	| { action: 'camera_stop'; device?: string }
	| { action: 'camera_list_webcams' }
	| {
			action: 'permissions';
			permissionAction: (typeof permissionActions)[number];
			permission?: (typeof permissionNames)[number];
			bundleId?: string;
			value?: string;
			device?: string;
	  }
	| { action: 'config'; device?: string }
	| { action: 'accessibility_tree'; device?: string }
	| { action: 'foreground'; device?: string }
	| { action: 'take_screenshot'; device?: string; outputPath?: string }
	| { action: 'launch'; device?: string; bundleId: string; args?: string[] }
	| { action: 'terminate'; device?: string; bundleId: string }
	| { action: 'open_url'; device?: string; url: string }
	| { action: 'list_apps'; device?: string; text?: string }
	| { action: 'logs'; device?: string; timeoutMs?: number };

function withDevice(args: string[], device?: string): string[] {
	return device ? [...args, '-d', device] : args;
}

function getBunImageConstructor(): BunImageConstructor | undefined {
	return (Bun as typeof Bun & { Image?: BunImageConstructor }).Image;
}

function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}

function requireNumber(value: number | undefined, name: string): number {
	if (typeof value === 'number') return value;
	throw new Error(`Missing required number field: ${name}`);
}

function requireString(value: string | undefined, name: string): string {
	if (typeof value === 'string') return value;
	throw new Error(`Missing required string field: ${name}`);
}

function parseSimulatorInput(
	input: z.infer<typeof simulatorInputSchema>,
): SimulatorInput {
	switch (input.action) {
		case 'click':
			return {
				action: 'click',
				x: requireNumber(input.x, 'x'),
				y: requireNumber(input.y, 'y'),
				device: input.device,
			};
		case 'gesture':
			return {
				action: 'gesture',
				gesture: input.gesture,
				device: input.device,
			};
		case 'drag':
			return {
				action: 'drag',
				startX: requireNumber(input.startX, 'startX'),
				startY: requireNumber(input.startY, 'startY'),
				endX: requireNumber(input.endX, 'endX'),
				endY: requireNumber(input.endY, 'endY'),
				device: input.device,
				durationMs: input.durationMs,
				steps: input.steps,
			};
		case 'type':
		case 'paste':
			return {
				action: input.action,
				text: requireString(input.text, 'text'),
				device: input.device,
			};
		case 'button':
			return {
				action: 'button',
				name: input.name ?? 'home',
				device: input.device,
			};
		case 'rotate':
			return {
				action: 'rotate',
				orientation: input.orientation ?? 'portrait',
				device: input.device,
			};
		case 'ca_debug':
			return {
				action: 'ca_debug',
				caDebug: input.caDebug ?? 'blended',
				enabled: input.enabled ?? true,
				device: input.device,
			};
		case 'camera_start':
			return {
				action: 'camera_start',
				bundleId: requireString(input.bundleId, 'bundleId'),
				cameraSource: input.cameraSource,
				file: input.file,
				webcam: input.webcam,
				mirror: input.mirror,
				device: input.device,
			};
		case 'camera_switch':
			return {
				action: 'camera_switch',
				cameraSource: input.cameraSource ?? 'placeholder',
				file: input.file,
				webcam: input.webcam,
				device: input.device,
			};
		case 'camera_mirror':
			return {
				action: 'camera_mirror',
				mirror: input.mirror ?? 'auto',
				device: input.device,
			};
		case 'permissions':
			return {
				action: 'permissions',
				permissionAction: input.permissionAction ?? 'list',
				permission: input.permission,
				bundleId: input.bundleId,
				value: input.value,
				device: input.device,
			};
		case 'take_screenshot':
			return {
				action: 'take_screenshot',
				device: input.device,
				outputPath: input.outputPath,
			};
		case 'launch':
			return {
				action: 'launch',
				device: input.device,
				bundleId: requireString(input.bundleId, 'bundleId'),
				args: input.args,
			};
		case 'terminate':
			return {
				action: 'terminate',
				device: input.device,
				bundleId: requireString(input.bundleId, 'bundleId'),
			};
		case 'open_url':
			return {
				action: 'open_url',
				device: input.device,
				url: requireString(input.url, 'url'),
			};
		case 'list_apps':
			return {
				action: 'list_apps',
				device: input.device,
				text: input.text,
			};
		case 'logs':
			return {
				action: 'logs',
				device: input.device,
				timeoutMs: input.timeoutMs,
			};
		default:
			return { action: input.action, device: input.device } as SimulatorInput;
	}
}

function getAgiBinDir() {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

const SERVE_SIM_PACKAGE = 'serve-sim@latest';

function executableName(name: string): string {
	return process.platform === 'win32' ? `${name}.exe` : name;
}

function findExecutable(name: string): string | null {
	const binary = executableName(name);
	const pathDirs = (process.env.PATH || '').split(
		process.platform === 'win32' ? ';' : ':',
	);
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const candidates = [
		...pathDirs.map((dir) => join(dir, binary)),
		...(home ? [join(home, '.bun', 'bin', binary)] : []),
		join('/opt', 'homebrew', 'bin', binary),
		join('/usr', 'local', 'bin', binary),
		join('/usr', 'bin', binary),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveConfiguredServeSim(): ServeSimCommand | null {
	const configured = process.env.OTTO_SERVE_SIM_BIN?.trim();
	if (!configured) return null;
	const command = isAbsolute(configured) ? configured : configured;
	return existsSync(command) || !isAbsolute(command)
		? { command, argsPrefix: [], cwd: dirname(command), runner: 'custom' }
		: null;
}

function resolvePackageRunner(): ServeSimCommand | null {
	const bun = findExecutable('bun');
	if (bun) {
		return {
			command: bun,
			argsPrefix: ['x', SERVE_SIM_PACKAGE],
			runner: 'bun x serve-sim@latest',
		};
	}

	const npx = findExecutable('npx');
	if (npx) {
		return {
			command: npx,
			argsPrefix: ['--yes', SERVE_SIM_PACKAGE],
			runner: 'npx --yes serve-sim@latest',
		};
	}

	return null;
}

function resolvePathServeSim(): ServeSimCommand | null {
	const serveSim = findExecutable('serve-sim');
	if (!serveSim) return null;
	return {
		command: serveSim,
		argsPrefix: [],
		cwd: dirname(serveSim),
		runner: serveSim,
	};
}

function resolveLegacyServeSim(): ServeSimCommand | null {
	const installedBin = join(getAgiBinDir(), executableName('serve-sim'));
	if (!existsSync(installedBin)) return null;
	return {
		command: installedBin,
		argsPrefix: [],
		cwd: dirname(installedBin),
		runner: installedBin,
	};
}

function findServeSimCommand(): ServeSimCommand {
	if (serveSimCommand) return serveSimCommand;

	const resolved =
		resolveConfiguredServeSim() ??
		resolvePackageRunner() ??
		resolvePathServeSim() ??
		resolveLegacyServeSim();
	if (resolved) {
		serveSimCommand = resolved;
		return resolved;
	}

	throw new Error(
		'serve-sim requires Bun or npm. Install Bun or Node.js, then try the simulator tool again.',
	);
}

function serveSimSpawnArgs(args: string[]) {
	const resolvedCommand = findServeSimCommand();
	return {
		command: resolvedCommand.command,
		args: [...resolvedCommand.argsPrefix, ...args],
		cwd: resolvedCommand.cwd,
	};
}

async function execServeSim(args: string[]): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const resolved = serveSimSpawnArgs(args);
		const child = spawn(resolved.command, resolved.args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: resolved.cwd,
		});
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`serve-sim timed out after ${DEFAULT_TIMEOUT_MS}ms`));
		}, DEFAULT_TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on('close', (exitCode) => {
			clearTimeout(timeout);
			resolve({ exitCode: exitCode ?? 0, stdout, stderr });
		});
	});
}

async function runCommand(
	command: string,
	args: string[],
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`${command} timed out after ${DEFAULT_TIMEOUT_MS}ms`));
		}, DEFAULT_TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on('close', (exitCode) => {
			clearTimeout(timeout);
			resolve({ exitCode: exitCode ?? 0, stdout, stderr });
		});
	});
}

async function runCommandWithInput(
	command: string,
	args: string[],
	input: string,
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`${command} timed out after ${DEFAULT_TIMEOUT_MS}ms`));
		}, DEFAULT_TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on('close', (exitCode) => {
			clearTimeout(timeout);
			resolve({ exitCode: exitCode ?? 0, stdout, stderr });
		});
		child.stdin.end(input);
	});
}

type KeyboardEventPayload = {
	type: 'down' | 'up';
	usage: number;
};

async function sendKeyboardEvents(
	wsUrl: string,
	events: KeyboardEventPayload[],
	delayMs = 12,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(wsUrl);
		socket.binaryType = 'arraybuffer';
		socket.onopen = async () => {
			try {
				for (const event of events) {
					const encoded = new TextEncoder().encode(JSON.stringify(event));
					const payload = new Uint8Array(1 + encoded.length);
					payload[0] = 6;
					payload.set(encoded, 1);
					socket.send(payload);
					await new Promise((done) => setTimeout(done, delayMs));
				}
				setTimeout(() => {
					socket.close();
					resolve();
				}, 50);
			} catch (error) {
				socket.close();
				reject(error);
			}
		};
		socket.onerror = () =>
			reject(new Error(`WebSocket connection failed: ${wsUrl}`));
	});
}

type TouchEventPayload = {
	subtype: 0 | 1 | 2;
	x: number;
	y: number;
	seq: number;
};

function encodeTouchEvent(event: TouchEventPayload): Uint8Array {
	const buffer = new ArrayBuffer(12);
	const view = new DataView(buffer);
	view.setUint8(0, 0x10);
	view.setUint8(1, event.subtype);
	view.setFloat32(2, event.x, true);
	view.setFloat32(6, event.y, true);
	view.setUint16(10, event.seq, true);
	return new Uint8Array(buffer);
}

async function sendTouchEvents(
	wsUrl: string,
	events: TouchEventPayload[],
	delayMs: number,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(wsUrl);
		socket.binaryType = 'arraybuffer';
		socket.onopen = async () => {
			try {
				for (const event of events) {
					socket.send(encodeTouchEvent(event));
					await new Promise((done) => setTimeout(done, delayMs));
				}
				setTimeout(() => {
					socket.close();
					resolve();
				}, 50);
			} catch (error) {
				socket.close();
				reject(error);
			}
		};
		socket.onerror = () =>
			reject(new Error(`WebSocket connection failed: ${wsUrl}`));
	});
}

async function runDragAction(
	input: Extract<SimulatorInput, { action: 'drag' }>,
) {
	const stream = await ensureStream(input.device);
	if (!stream.wsUrl) {
		return createToolError(
			'No serve-sim WebSocket URL found for drag action',
			'execution',
			{ action: 'drag' },
		);
	}

	const steps = input.steps ?? 24;
	const durationMs = input.durationMs ?? 350;
	const delayMs = Math.max(1, Math.round(durationMs / steps));
	const events: TouchEventPayload[] = [
		{ subtype: 0, x: input.startX, y: input.startY, seq: 0 },
	];
	for (let step = 1; step < steps; step++) {
		const t = step / steps;
		events.push({
			subtype: 1,
			x: input.startX + (input.endX - input.startX) * t,
			y: input.startY + (input.endY - input.startY) * t,
			seq: step,
		});
	}
	events.push({
		subtype: 2,
		x: input.endX,
		y: input.endY,
		seq: steps,
	});

	await sendTouchEvents(stream.wsUrl, events, delayMs);
	return {
		ok: true,
		method: 'websocket_drag',
		steps,
		durationMs,
		stream,
	};
}

function parseJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function listStreams(device?: string): Promise<ServeSimEntry[]> {
	const result = await execServeSim(
		device ? ['--list', '-q', device] : ['--list', '-q'],
	);
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr.trim() || result.stdout.trim() || 'serve-sim --list failed',
		);
	}
	const parsed = parseJson<ServeSimEntry[] | ServeSimEntry>(
		result.stdout.trim(),
	);
	if (!parsed) return [];
	return Array.isArray(parsed) ? parsed : [parsed];
}

async function resolveDeviceTarget(
	device?: string,
): Promise<string | undefined> {
	const requested = device?.trim();
	if (!requested) return undefined;
	try {
		const streams = await listStreams(requested);
		const resolved = streams.find((stream) => stream.device)?.device;
		return resolved ?? requested;
	} catch {
		return requested;
	}
}

async function getSimctlTarget(device?: string): Promise<string> {
	return (await resolveDeviceTarget(device)) ?? 'booted';
}

async function ensureStream(device?: string): Promise<ServeSimEntry> {
	const existing = await listStreams(device);
	const first = existing[0];
	if (first?.streamUrl || first?.url) return first;
	const result = await execServeSim(
		device ? ['--detach', '-q', device] : ['--detach', '-q'],
	);
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr.trim() || result.stdout.trim() || 'serve-sim start failed',
		);
	}
	const parsed = parseJson<ServeSimEntry>(result.stdout.trim());
	if (!parsed) throw new Error('serve-sim returned invalid JSON');
	return parsed;
}

async function canReach(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 500);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok || response.status < 500;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForPreviewUrl(timeoutMs = 4000): Promise<string | null> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await canReach(DEFAULT_PREVIEW_URL)) return DEFAULT_PREVIEW_URL;
		if (
			previewProcess?.exitCode !== null &&
			previewProcess?.exitCode !== undefined
		)
			return null;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return (await canReach(DEFAULT_PREVIEW_URL)) ? DEFAULT_PREVIEW_URL : null;
}

async function ensurePreviewServer(): Promise<string> {
	if (await canReach(DEFAULT_PREVIEW_URL)) return DEFAULT_PREVIEW_URL;
	if (!previewProcess || previewProcess.exitCode !== null) {
		previewStdout = '';
		previewStderr = '';
		const resolved = serveSimSpawnArgs([
			'--port',
			String(DEFAULT_PREVIEW_PORT),
		]);
		previewProcess = spawn(resolved.command, resolved.args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: resolved.cwd,
		});
		previewProcess.stdout?.setEncoding('utf8');
		previewProcess.stderr?.setEncoding('utf8');
		previewProcess.stdout?.on('data', (chunk) => {
			previewStdout += chunk;
		});
		previewProcess.stderr?.on('data', (chunk) => {
			previewStderr += chunk;
		});
		previewProcess.on('close', () => {
			previewProcess = null;
		});
	}

	const url = await waitForPreviewUrl();
	if (!url) {
		throw new Error(
			previewStderr || previewStdout || 'serve-sim preview failed to start',
		);
	}
	return url;
}

async function fetchJson(url: string): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok)
			throw new Error(`${response.status} ${response.statusText}`);
		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchTextFor(url: string, timeoutMs: number): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return await response.text();
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') return '';
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
	const output = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
	for (
		let index = 0;
		index <= haystack.byteLength - needle.byteLength;
		index++
	) {
		let matched = true;
		for (let needleIndex = 0; needleIndex < needle.byteLength; needleIndex++) {
			if (haystack[index + needleIndex] !== needle[needleIndex]) {
				matched = false;
				break;
			}
		}
		if (matched) return index;
	}
	return -1;
}

function findJpegEnd(bytes: Uint8Array, startIndex: number): number {
	for (let index = startIndex + 2; index < bytes.byteLength - 1; index++) {
		if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
			return index + 2;
		}
	}
	return -1;
}

async function fetchFirstMjpegFrame(url: string): Promise<Uint8Array> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok)
			throw new Error(`${response.status} ${response.statusText}`);
		const reader = response.body?.getReader();
		if (!reader) throw new Error('serve-sim response did not include a body');

		const chunks: Uint8Array[] = [];
		let totalLength = 0;
		const headerDelimiter = new TextEncoder().encode('\r\n\r\n');
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			totalLength += value.byteLength;
			const bytes = concatBytes(chunks, totalLength);
			const headerEnd = indexOfBytes(bytes, headerDelimiter);
			if (headerEnd >= 0) {
				const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
				const lengthMatch = headerText.match(/content-length:\s*(\d+)/i);
				if (lengthMatch?.[1]) {
					const frameStart = headerEnd + headerDelimiter.byteLength;
					const frameLength = Number(lengthMatch[1]);
					const frameEnd = frameStart + frameLength;
					if (bytes.byteLength >= frameEnd) {
						return bytes.slice(frameStart, frameEnd);
					}
				}

				const frameStart = indexOfBytes(bytes, new Uint8Array([0xff, 0xd8]));
				if (frameStart >= 0) {
					const frameEnd = findJpegEnd(bytes, frameStart);
					if (frameEnd >= 0) return bytes.slice(frameStart, frameEnd);
				}
			}
		}
		throw new Error('serve-sim stream ended before a complete frame was read');
	} finally {
		clearTimeout(timeout);
	}
}

async function prepareScreenshotForModel(bytes: Uint8Array): Promise<{
	data: Uint8Array;
	mediaType: string;
	compressed: boolean;
	width?: number;
	height?: number;
}> {
	const ImageCtor = getBunImageConstructor();
	if (!ImageCtor) {
		return { data: bytes, mediaType: 'image/jpeg', compressed: false };
	}

	try {
		const image = new ImageCtor(bytes);
		const metadata = await image.metadata();
		const width = metadata.width;
		const height = metadata.height;
		if (!width || !height) {
			return { data: bytes, mediaType: 'image/jpeg', compressed: false };
		}

		const longestEdge = Math.max(width, height);
		if (longestEdge <= SCREENSHOT_MODEL_MAX_EDGE) {
			return {
				data: bytes,
				mediaType: 'image/jpeg',
				compressed: false,
				width,
				height,
			};
		}

		const scale = SCREENSHOT_MODEL_MAX_EDGE / longestEdge;
		const targetWidth = Math.max(1, Math.round(width * scale));
		const targetHeight = Math.max(1, Math.round(height * scale));
		const compressed = await image
			.resize(targetWidth, targetHeight, {
				fit: 'inside',
				withoutEnlargement: true,
			})
			.jpeg({ quality: SCREENSHOT_MODEL_JPEG_QUALITY })
			.bytes();

		return {
			data: compressed,
			mediaType: 'image/jpeg',
			compressed: true,
			width: targetWidth,
			height: targetHeight,
		};
	} catch {
		return { data: bytes, mediaType: 'image/jpeg', compressed: false };
	}
}

function buildScreenshotArtifactPath(
	projectRoot: string,
	outputPath?: string,
): {
	relativePath: string;
	absPath: string;
} {
	const requestedName = outputPath?.trim()
		? basename(outputPath.trim())
		: `screenshot-${Date.now()}-${randomUUID()}.jpg`;
	const extension = extname(requestedName).toLowerCase();
	const fileName = extension
		? requestedName
		: `${requestedName || `screenshot-${randomUUID()}`}.jpg`;
	const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
	const relativePath = `${SCREENSHOT_ARTIFACTS_DIR}/${safeName}`;
	return {
		relativePath,
		absPath: join(projectRoot, relativePath),
	};
}

function getStreamUrl(entry: ServeSimEntry): string {
	if (entry.streamUrl) {
		const url = new URL(entry.streamUrl);
		return url.origin;
	}
	throw new Error('No serve-sim streamUrl found. Start the simulator first.');
}

function getPreviewUrl(entry: ServeSimEntry): string {
	if (entry.url) return entry.url.replace(/\/$/, '');
	throw new Error('No serve-sim preview url found. Start the simulator first.');
}

async function runCliAction(args: string[]) {
	const result = await execServeSim(args);
	if (result.exitCode !== 0) {
		return createToolError(
			result.stderr.trim() ||
				result.stdout.trim() ||
				'serve-sim command failed',
			'execution',
			{ args },
		);
	}
	return {
		ok: true,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

function buildCameraStartArgs(
	input: Extract<SimulatorInput, { action: 'camera_start' }>,
): string[] {
	const args = ['camera', input.bundleId];
	if (input.cameraSource === 'file') {
		args.push('--file', requireString(input.file, 'file'));
	} else if (input.cameraSource === 'webcam') {
		args.push('--webcam');
		if (input.webcam?.trim()) args.push(input.webcam.trim());
	}
	if (input.mirror) args.push('--mirror', input.mirror);
	return withDevice(args, input.device);
}

function buildCameraSwitchArgs(
	input: Extract<SimulatorInput, { action: 'camera_switch' }>,
): string[] {
	const args = ['camera', 'switch', input.cameraSource];
	if (input.cameraSource === 'file') {
		args.push(requireString(input.file, 'file'));
	} else if (input.cameraSource === 'webcam' && input.webcam?.trim()) {
		args.push(input.webcam.trim());
	}
	return withDevice(args, input.device);
}

function buildPermissionsArgs(
	input: Extract<SimulatorInput, { action: 'permissions' }>,
): string[] {
	const args = ['permissions', input.permissionAction];
	if (input.permissionAction === 'list') {
		if (input.bundleId?.trim()) args.push(input.bundleId.trim());
		args.push('-q');
		return withDevice(args, input.device);
	}

	args.push(requireString(input.permission, 'permission'));
	args.push(requireString(input.bundleId, 'bundleId'));
	if (input.value?.trim()) args.push('--value', input.value.trim());
	return withDevice(args, input.device);
}

function shouldPasteForText(text: string): boolean {
	return text.length > 8 || /[:/.?#&=%]/.test(text);
}

async function pasteTextIntoFocusedField(
	text: string,
	device?: string,
): Promise<ExecResult & { method: 'paste' }> {
	const target = await getSimctlTarget(device);
	const pbcopy = await runCommandWithInput(
		'xcrun',
		['simctl', 'pbcopy', target],
		text,
	);
	if (pbcopy.exitCode !== 0) return { ...pbcopy, method: 'paste' };
	const stream = await ensureStream(device);
	if (!stream.wsUrl) {
		return {
			exitCode: 1,
			stdout: pbcopy.stdout,
			stderr: 'No serve-sim WebSocket URL found for paste action',
			method: 'paste',
		};
	}
	await sendKeyboardEvents(stream.wsUrl, [
		{ type: 'down', usage: HID_KEYBOARD_LEFT_GUI },
		{ type: 'down', usage: HID_KEYBOARD_V },
		{ type: 'up', usage: HID_KEYBOARD_V },
		{ type: 'up', usage: HID_KEYBOARD_LEFT_GUI },
	]);
	return {
		exitCode: 0,
		stdout: pbcopy.stdout,
		stderr: pbcopy.stderr,
		method: 'paste',
	};
}

async function runTextInputAction(text: string, device?: string) {
	if (shouldPasteForText(text)) {
		const result = await pasteTextIntoFocusedField(text, device);
		if (result.exitCode !== 0) {
			return createToolError(
				result.stderr.trim() ||
					result.stdout.trim() ||
					'simulator paste failed',
				'execution',
				{ method: 'paste' },
			);
		}
		return {
			ok: true,
			method: 'paste',
			stdout: result.stdout.trim(),
			stderr: result.stderr.trim(),
		};
	}

	const typeDevice = await resolveDeviceTarget(device);
	const result = await execServeSim(withDevice(['type', text], typeDevice));
	if (result.exitCode !== 0) {
		return createToolError(
			result.stderr.trim() || result.stdout.trim() || 'serve-sim type failed',
			'execution',
			{ method: 'type' },
		);
	}
	return {
		ok: true,
		method: 'type',
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

export function buildSimulatorTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'simulator',
		tool: tool({
			description:
				'Control an Apple Simulator through serve-sim and simctl. Coordinates are normalized 0..1. Use click for taps, drag for reliable swipes/drags over one WebSocket, gesture for raw serve-sim gesture JSON, take_screenshot/config/accessibility_tree/foreground/logs for inspection, launch/terminate/open_url/list_apps for app control, camera_* for camera injection, ca_debug/memory_warning/permissions for simulator testing, and stop when done. Prefer this tool over shell for simulator operations after the serve-sim stream is running.',
			inputSchema: simulatorInputSchema,
			toModelOutput({ output }) {
				const result = output as {
					ok?: boolean;
					path?: string;
					artifact?: {
						data?: string;
						mediaType?: string;
						transmittedSize?: number;
						compressed?: boolean;
						width?: number;
						height?: number;
					};
				};
				const image = result.artifact;
				if (
					result.ok === true &&
					typeof image?.data === 'string' &&
					typeof image.mediaType === 'string'
				) {
					const dimensions =
						typeof image.width === 'number' && typeof image.height === 'number'
							? `, ${image.width}x${image.height}`
							: '';
					const compressed = image.compressed ? ', compressed' : '';
					return {
						type: 'content',
						value: [
							{
								type: 'text',
								text: `Simulator screenshot captured from ${result.path ?? 'current screen'} (${image.mediaType}${dimensions}${compressed}, ${image.transmittedSize ?? image.data.length} bytes sent to the model). Inspect the following image content.`,
							},
							{
								type: 'image-data',
								data: image.data,
								mediaType: image.mediaType,
							},
						],
					};
				}
				return { type: 'json', value: toJsonValue(output) };
			},
			execute: async (rawInput) => {
				const input = parseSimulatorInput(rawInput);
				try {
					switch (input.action) {
						case 'start': {
							const previewUrl = await ensurePreviewServer();
							const stream = await ensureStream(input.device);
							return {
								ok: true,
								stream,
								previewUrl,
								message: `Simulator preview available at ${previewUrl}`,
							};
						}
						case 'status': {
							const streams = await listStreams(input.device);
							const previewUrl = (await canReach(DEFAULT_PREVIEW_URL))
								? DEFAULT_PREVIEW_URL
								: undefined;
							return { ok: true, streams, count: streams.length, previewUrl };
						}
						case 'stop':
							return runCliAction(
								input.device ? ['--kill', input.device] : ['--kill'],
							);
						case 'click': {
							const clickDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(
									['tap', String(input.x), String(input.y)],
									clickDevice,
								),
							);
						}
						case 'gesture': {
							const gestureDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(
									['gesture', JSON.stringify(input.gesture)],
									gestureDevice,
								),
							);
						}
						case 'drag': {
							return runDragAction(input);
						}
						case 'type': {
							return runTextInputAction(input.text, input.device);
						}
						case 'paste': {
							const result = await pasteTextIntoFocusedField(
								input.text,
								input.device,
							);
							if (result.exitCode !== 0) {
								return createToolError(
									result.stderr.trim() ||
										result.stdout.trim() ||
										'simulator paste failed',
									'execution',
									{ method: 'paste' },
								);
							}
							return {
								ok: true,
								method: 'paste',
								stdout: result.stdout.trim(),
								stderr: result.stderr.trim(),
							};
						}
						case 'button': {
							const buttonDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(['button', input.name], buttonDevice),
							);
						}
						case 'rotate': {
							const rotateDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(['rotate', input.orientation], rotateDevice),
							);
						}
						case 'ca_debug': {
							const caDebugDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(
									['ca-debug', input.caDebug, input.enabled ? 'on' : 'off'],
									caDebugDevice,
								),
							);
						}
						case 'memory_warning': {
							const memoryDevice = await resolveDeviceTarget(input.device);
							return runCliAction(withDevice(['memory-warning'], memoryDevice));
						}
						case 'camera_start': {
							const cameraDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								buildCameraStartArgs({ ...input, device: cameraDevice }),
							);
						}
						case 'camera_switch': {
							const cameraDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								buildCameraSwitchArgs({ ...input, device: cameraDevice }),
							);
						}
						case 'camera_mirror': {
							const cameraDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(['camera', 'mirror', input.mirror], cameraDevice),
							);
						}
						case 'camera_status': {
							const cameraDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(['camera', 'status', '-q'], cameraDevice),
							);
						}
						case 'camera_stop': {
							const cameraDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								withDevice(['camera', '--stop-webcam'], cameraDevice),
							);
						}
						case 'camera_list_webcams': {
							return runCliAction(['camera', '--list-webcams']);
						}
						case 'permissions': {
							const permissionsDevice = await resolveDeviceTarget(input.device);
							return runCliAction(
								buildPermissionsArgs({ ...input, device: permissionsDevice }),
							);
						}
						case 'config': {
							const stream = await ensureStream(input.device);
							const config = await fetchJson(`${getStreamUrl(stream)}/config`);
							return { ok: true, config, stream };
						}
						case 'accessibility_tree': {
							const stream = await ensureStream(input.device);
							const tree = await fetchJson(`${getStreamUrl(stream)}/ax`);
							return { ok: true, accessibilityTree: tree, stream };
						}
						case 'foreground': {
							const stream = await ensureStream(input.device);
							const foreground = await fetchJson(
								`${getStreamUrl(stream)}/foreground`,
							);
							return { ok: true, foreground, stream };
						}
						case 'take_screenshot': {
							const stream = await ensureStream(input.device);
							const bytes = await fetchFirstMjpegFrame(
								`${getStreamUrl(stream)}/stream.mjpeg?raw=1`,
							);
							const screenshot = await prepareScreenshotForModel(bytes);
							const { relativePath, absPath } = buildScreenshotArtifactPath(
								projectRoot,
								input.outputPath,
							);
							await mkdir(join(projectRoot, SCREENSHOT_ARTIFACTS_DIR), {
								recursive: true,
							});
							await writeFile(absPath, bytes);
							return {
								ok: true,
								path: relativePath,
								message: `Simulator screenshot stored in Otto artifacts at ${relativePath}`,
								artifact: {
									kind: 'simulator_screenshot',
									path: relativePath,
									mediaType: screenshot.mediaType,
									data: Buffer.from(screenshot.data).toString('base64'),
									originalSize: bytes.byteLength,
									transmittedSize: screenshot.data.byteLength,
									compressed: screenshot.compressed,
									width: screenshot.width,
									height: screenshot.height,
								},
								stream,
							};
						}
						case 'launch': {
							const result = await runCommand('xcrun', [
								'simctl',
								'launch',
								await getSimctlTarget(input.device),
								input.bundleId,
								...(input.args ?? []),
							]);
							return {
								ok: result.exitCode === 0,
								exitCode: result.exitCode,
								bundleId: input.bundleId,
								stdout: result.stdout.trim(),
								stderr: result.stderr.trim(),
							};
						}
						case 'terminate': {
							const result = await runCommand('xcrun', [
								'simctl',
								'terminate',
								await getSimctlTarget(input.device),
								input.bundleId,
							]);
							return {
								ok: result.exitCode === 0,
								exitCode: result.exitCode,
								bundleId: input.bundleId,
								stdout: result.stdout.trim(),
								stderr: result.stderr.trim(),
							};
						}
						case 'open_url': {
							const result = await runCommand('xcrun', [
								'simctl',
								'openurl',
								await getSimctlTarget(input.device),
								input.url,
							]);
							return {
								ok: result.exitCode === 0,
								exitCode: result.exitCode,
								url: input.url,
								stdout: result.stdout.trim(),
								stderr: result.stderr.trim(),
							};
						}
						case 'list_apps': {
							const result = await runCommand('xcrun', [
								'simctl',
								'listapps',
								await getSimctlTarget(input.device),
							]);
							const filter = input.text?.trim().toLowerCase();
							const stdout = filter
								? result.stdout
										.split('\n')
										.filter((line) => line.toLowerCase().includes(filter))
										.join('\n')
								: result.stdout;
							return {
								ok: result.exitCode === 0,
								exitCode: result.exitCode,
								stdout: stdout.trim(),
								stderr: result.stderr.trim(),
							};
						}
						case 'logs': {
							const stream = await ensureStream(input.device);
							const logs = await fetchTextFor(
								`${getPreviewUrl(stream)}/.sim/logs`,
								input.timeoutMs ?? LOG_TIMEOUT_MS,
							);
							return { ok: true, logs, stream };
						}
					}
				} catch (error) {
					return createToolError(
						error instanceof Error ? error.message : String(error),
						'execution',
						{ action: input.action },
					);
				}
			},
		}),
	};
}
