import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tool, type Tool } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import { z } from 'zod/v3';
import DESCRIPTION from './simulator.txt' with { type: 'text' };
import { createToolError } from '../error.ts';
import { enqueueBrowserPanelCommand } from '../../browser-panel/commands.ts';

const DEFAULT_PORT = 3200;
const SCREENSHOT_PREVIEW_MAX_DIMENSION = 512;
const SCREENSHOT_PREVIEW_JPEG_QUALITY = 60;
let activePreviewUrl: string | null = null;
let previewProcess: ChildProcess | null = null;
let previewStdout = '';
let previewStderr = '';
let cleanupHandlersRegistered = false;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function runServeSim(args: string[]): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('bunx', ['serve-sim', ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

function cleanupPreviewProcess() {
	if (!previewProcess) return;
	previewProcess.kill();
	previewProcess = null;
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

async function killProcessOnPort(port: number) {
	const result = await runCommand('lsof', ['-ti', `:${port}`]);
	const pids = result.stdout
		.split('\n')
		.map((pid) => pid.trim())
		.filter(Boolean);
	for (const pid of pids) {
		spawn('kill', [pid], { stdio: 'ignore' });
	}
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

function startPreviewProcess(args: string[]) {
	previewStdout = '';
	previewStderr = '';
	const child = spawn('bunx', ['serve-sim', ...args], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	previewProcess = child;
	child.stdout?.setEncoding('utf8');
	child.stderr?.setEncoding('utf8');
	child.stdout?.on('data', (chunk) => {
		previewStdout += chunk;
	});
	child.stderr?.on('data', (chunk) => {
		previewStderr += chunk;
	});
	child.on('close', () => {
		previewProcess = null;
	});
}

async function waitForPreview(port: number, timeoutMs = 3500) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (!previewProcess) break;
		const url = extractPreviewUrl(previewStdout, port);
		if (url !== `http://localhost:${port}`) return url;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return extractPreviewUrl(previewStdout, port);
}

function findUrl(text: string): string | null {
	const match = text.match(/https?:\/\/[^\s"']+/);
	return match?.[0] ?? null;
}

function parseJsonLines(text: string): unknown[] {
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

function extractPreviewUrl(stdout: string, port: number) {
	const directUrl = findUrl(stdout);
	if (directUrl) return directUrl;
	for (const value of parseJsonLines(stdout)) {
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
			for (const key of ['url', 'previewUrl', 'preview']) {
				if (typeof item[key] === 'string') return item[key];
			}
		}
	}
	return `http://localhost:${port}`;
}

function commandResponse(
	result: CommandResult,
	extra: Record<string, unknown> = {},
) {
	return {
		ok: result.exitCode === 0,
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		...extra,
	};
}

function getSimctlTarget(device?: string) {
	return device?.trim() || 'booted';
}

function defaultScreenshotPath() {
	return `/tmp/otto-simulator-${Date.now()}.png`;
}

async function readScreenshotImage(path: string) {
	let data = await readFile(path);
	let inlinePath = path;
	const previewPath = `/tmp/otto-simulator-preview-${Date.now()}.jpg`;
	const result = await runCommand('sips', [
		'-Z',
		String(SCREENSHOT_PREVIEW_MAX_DIMENSION),
		'-s',
		'format',
		'jpeg',
		'-s',
		'formatOptions',
		String(SCREENSHOT_PREVIEW_JPEG_QUALITY),
		path,
		'--out',
		previewPath,
	]);
	if (result.exitCode === 0) {
		const previewData = await readFile(previewPath);
		if (previewData.byteLength < data.byteLength) {
			data = previewData;
			inlinePath = previewPath;
		}
	}
	return {
		data: data.toString('base64'),
		mimeType: inlinePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
		path: inlinePath,
		fullSizePath: path,
		approxBytes: data.byteLength,
	};
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSwipeGesture(direction: string) {
	const gestures = {
		left: {
			start: { x: 0.82, y: 0.5 },
			end: { x: 0.18, y: 0.5 },
		},
		right: {
			start: { x: 0.18, y: 0.5 },
			end: { x: 0.82, y: 0.5 },
		},
		up: {
			start: { x: 0.5, y: 0.82 },
			end: { x: 0.5, y: 0.18 },
		},
		down: {
			start: { x: 0.5, y: 0.18 },
			end: { x: 0.5, y: 0.82 },
		},
	} as const;
	return gestures[direction as keyof typeof gestures];
}

async function sendServeSimTouch(touch: unknown, device: string | undefined) {
	const args = ['gesture', JSON.stringify(touch), '--quiet'];
	if (device) args.push('-d', device);
	return runServeSim(args);
}

export function buildSimulatorTool(): { name: string; tool: Tool } {
	const simulator = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			operation: z
				.enum([
					'start',
					'list',
					'stop',
					'button',
					'gesture',
					'swipe',
					'rotate',
					'logs',
					'launch',
					'terminate',
					'open_url',
					'screenshot',
					'install',
					'memory_warning',
					'ca_debug',
				])
				.describe('Operation to perform'),
			port: z
				.number()
				.int()
				.positive()
				.default(DEFAULT_PORT)
				.optional()
				.describe('For start: preview server port'),
			device: z
				.string()
				.optional()
				.describe('Optional simulator device name or UDID'),
			button: z
				.string()
				.default('home')
				.optional()
				.describe('For button: button name, defaults to home'),
			gesture: z
				.unknown()
				.optional()
				.describe('For gesture: serve-sim gesture JSON payload'),
			direction: z
				.enum(['left', 'right', 'up', 'down'])
				.optional()
				.describe('For swipe: direction to swipe'),
			durationMs: z
				.number()
				.int()
				.positive()
				.default(450)
				.optional()
				.describe('For swipe: gesture duration in milliseconds'),
			orientation: z
				.enum([
					'portrait',
					'portrait_upside_down',
					'landscape_left',
					'landscape_right',
				])
				.optional()
				.describe('For rotate: simulator orientation'),
			previewUrl: z
				.string()
				.optional()
				.describe('For logs: override serve-sim preview URL'),
			bundleId: z
				.string()
				.optional()
				.describe('For launch/terminate: app bundle identifier'),
			appPath: z
				.string()
				.optional()
				.describe('For install: path to a .app bundle'),
			url: z.string().optional().describe('For open_url: URL to open'),
			args: z
				.array(z.string())
				.optional()
				.describe('For launch: optional app arguments'),
			screenshotPath: z
				.string()
				.optional()
				.describe('For screenshot: output PNG path'),
			caDebugOption: z
				.enum([
					'blended',
					'copies',
					'misaligned',
					'offscreen',
					'slow-animations',
				])
				.optional()
				.describe('For ca_debug: CoreAnimation debug option'),
			enabled: z
				.boolean()
				.optional()
				.describe('For ca_debug: enable or disable the selected option'),
		}),
		toModelOutput({ output }): ToolResultOutput {
			const result = output as {
				ok?: boolean;
				message?: string;
				error?: string;
				images?: Array<{ data: string; mimeType: string }>;
			};
			if (result.images && result.images.length > 0) {
				const parts: Array<
					| { type: 'text'; text: string }
					| { type: 'image-data'; data: string; mediaType: string }
				> = [];
				const text = result.ok ? result.message : result.error;
				if (text) parts.push({ type: 'text', text });
				for (const image of result.images) {
					parts.push({
						type: 'image-data',
						data: image.data,
						mediaType: image.mimeType,
					});
				}
				return { type: 'content', value: parts } as ToolResultOutput;
			}

			return {
				type: 'json',
				value: result as unknown as import('@ai-sdk/provider').JSONValue,
			};
		},
		execute: async (params) => {
			try {
				if (process.platform !== 'darwin') {
					return createToolError(
						'simulator tool requires macOS with Xcode command line tools',
					);
				}

				switch (params.operation) {
					case 'start': {
						const port = params.port ?? DEFAULT_PORT;
						if (previewProcess && activePreviewUrl) {
							enqueueBrowserPanelCommand({
								type: 'open',
								url: activePreviewUrl,
								title: 'iOS Simulator',
								kind: 'simulator',
							});
							return commandResponse(
								{ exitCode: 0, stdout: previewStdout, stderr: previewStderr },
								{
									previewUrl: activePreviewUrl,
									openedInBrowserPanel: true,
									message: `serve-sim is already running at ${activePreviewUrl} and was opened in the Browser panel`,
								},
							);
						}
						await killProcessOnPort(port);
						registerCleanupHandlers();
						const args = ['--port', String(port)];
						if (params.device) args.push(params.device);
						startPreviewProcess(args);
						activePreviewUrl = await waitForPreview(port);
						if (!previewProcess) {
							return createToolError(
								previewStderr || previewStdout || 'Failed to start serve-sim',
							);
						}
						enqueueBrowserPanelCommand({
							type: 'open',
							url: activePreviewUrl,
							title: 'iOS Simulator',
							kind: 'simulator',
						});
						return commandResponse(
							{ exitCode: 0, stdout: previewStdout, stderr: previewStderr },
							{
								previewUrl: activePreviewUrl,
								openedInBrowserPanel: true,
								message: `serve-sim started at ${activePreviewUrl} and was opened in the Browser panel`,
							},
						);
					}

					case 'list': {
						const result = await runServeSim(['--list', '--quiet']);
						if (result.exitCode === 0) {
							activePreviewUrl = extractPreviewUrl(
								result.stdout,
								params.port ?? DEFAULT_PORT,
							);
						}
						return commandResponse(result, { previewUrl: activePreviewUrl });
					}

					case 'stop': {
						cleanupPreviewProcess();
						const args = ['--kill', '--quiet'];
						if (params.device) args.push(params.device);
						const result = await runServeSim(args);
						if (result.exitCode === 0) activePreviewUrl = null;
						return commandResponse(result);
					}

					case 'button': {
						const args = ['button', params.button ?? 'home', '--quiet'];
						if (params.device) args.push('-d', params.device);
						return commandResponse(await runServeSim(args));
					}

					case 'gesture': {
						if (params.gesture === undefined) {
							return createToolError(
								'gesture is required for gesture operation',
							);
						}
						const args = ['gesture', JSON.stringify(params.gesture), '--quiet'];
						if (params.device) args.push('-d', params.device);
						return commandResponse(await runServeSim(args));
					}

					case 'swipe': {
						if (!params.direction) {
							return createToolError(
								'direction is required for swipe operation',
							);
						}
						const swipe = buildSwipeGesture(params.direction);
						if (!swipe) {
							return createToolError(
								`Unsupported swipe direction: ${params.direction}`,
							);
						}
						const durationMs = params.durationMs ?? 450;
						const midpoint = {
							x: (swipe.start.x + swipe.end.x) / 2,
							y: (swipe.start.y + swipe.end.y) / 2,
						};
						const results: CommandResult[] = [];
						results.push(
							await sendServeSimTouch(
								{ type: 'begin', ...swipe.start },
								params.device,
							),
						);
						await wait(Math.max(50, Math.floor(durationMs / 3)));
						results.push(
							await sendServeSimTouch(
								{ type: 'move', ...midpoint },
								params.device,
							),
						);
						await wait(Math.max(50, Math.floor(durationMs / 3)));
						results.push(
							await sendServeSimTouch(
								{ type: 'move', ...swipe.end },
								params.device,
							),
						);
						await wait(Math.max(50, Math.floor(durationMs / 3)));
						results.push(
							await sendServeSimTouch(
								{ type: 'end', ...swipe.end },
								params.device,
							),
						);
						return {
							ok: results.every((result) => result.exitCode === 0),
							direction: params.direction,
							durationMs,
							results,
						};
					}

					case 'rotate': {
						if (!params.orientation) {
							return createToolError(
								'orientation is required for rotate operation',
							);
						}
						const args = ['rotate', params.orientation, '--quiet'];
						if (params.device) args.push('-d', params.device);
						return commandResponse(await runServeSim(args));
					}

					case 'logs': {
						const previewUrl = params.previewUrl ?? activePreviewUrl;
						if (!previewUrl) {
							return createToolError(
								'No active preview URL. Run simulator start or provide previewUrl.',
							);
						}
						const logsUrl = new URL('/logs', previewUrl).toString();
						const response = await fetch(logsUrl);
						return {
							ok: response.ok,
							url: logsUrl,
							logs: await response.text(),
						};
					}

					case 'launch': {
						if (!params.bundleId) {
							return createToolError(
								'bundleId is required for launch operation',
							);
						}
						const result = await runCommand('xcrun', [
							'simctl',
							'launch',
							getSimctlTarget(params.device),
							params.bundleId,
							...(params.args ?? []),
						]);
						return commandResponse(result, {
							bundleId: params.bundleId,
						});
					}

					case 'terminate': {
						if (!params.bundleId) {
							return createToolError(
								'bundleId is required for terminate operation',
							);
						}
						const result = await runCommand('xcrun', [
							'simctl',
							'terminate',
							getSimctlTarget(params.device),
							params.bundleId,
						]);
						return commandResponse(result, {
							bundleId: params.bundleId,
						});
					}

					case 'open_url': {
						if (!params.url) {
							return createToolError('url is required for open_url operation');
						}
						const result = await runCommand('xcrun', [
							'simctl',
							'openurl',
							getSimctlTarget(params.device),
							params.url,
						]);
						return commandResponse(result, { url: params.url });
					}

					case 'screenshot': {
						const screenshotPath =
							params.screenshotPath ?? defaultScreenshotPath();
						const result = await runCommand('xcrun', [
							'simctl',
							'io',
							getSimctlTarget(params.device),
							'screenshot',
							screenshotPath,
						]);
						if (result.exitCode !== 0) {
							return commandResponse(result, { screenshotPath });
						}
						const image = await readScreenshotImage(screenshotPath);
						return commandResponse(result, {
							screenshotPath,
							images: [image],
							artifact: {
								kind: 'image',
								path: screenshotPath,
								mimeType: image.mimeType,
							},
						});
					}

					case 'install': {
						if (!params.appPath) {
							return createToolError(
								'appPath is required for install operation',
							);
						}
						const result = await runCommand('xcrun', [
							'simctl',
							'install',
							getSimctlTarget(params.device),
							params.appPath,
						]);
						return commandResponse(result, { appPath: params.appPath });
					}

					case 'memory_warning': {
						const args = ['memory-warning', '--quiet'];
						if (params.device) args.push('-d', params.device);
						return commandResponse(await runServeSim(args));
					}

					case 'ca_debug': {
						if (!params.caDebugOption || params.enabled === undefined) {
							return createToolError(
								'caDebugOption and enabled are required for ca_debug operation',
							);
						}
						const args = [
							'ca-debug',
							params.caDebugOption,
							params.enabled ? 'on' : 'off',
							'--quiet',
						];
						if (params.device) args.push('-d', params.device);
						return commandResponse(await runServeSim(args));
					}
				}
			} catch (error) {
				return createToolError(
					`Simulator operation failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	});

	return { name: 'simulator', tool: simulator };
}
