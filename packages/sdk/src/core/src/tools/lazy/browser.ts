import { tool, type Tool } from 'ai';
import { requestBrowserControl } from '../../../../browser-control.ts';
import { createToolError } from '../error.ts';
import {
	browserControlArgs,
	browserInputSchema,
	defaultTabId,
	validateBrowserUrl,
	waitForTimeoutMs,
	type BrowserInput,
} from './browser-command.ts';
import { prepareScreenshotForModel } from './screenshot-image.ts';

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

const DEFAULT_CONTROL_TIMEOUT_MS = 20_000;
const NAVIGATION_CONTROL_TIMEOUT_MS = 30_000;
const SCREENSHOT_CONTROL_TIMEOUT_MS = 30_000;
const WAIT_FOR_CONTROL_MARGIN_MS = 15_000;
const MAX_SCREENSHOT_BYTES = 24 * 1024 * 1024;
const SUPPORTED_SCREENSHOT_MEDIA_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
]);

const description = [
	'Open and control a page in Otto built-in browser.',
	'Use open first, then snapshot to read visible text and interactive elements; snapshot returns stable references such as @e1 that work as selectors for click, hover, type, press, scroll, and wait_for.',
	'screenshot returns the rendered page as an image for visual checks (macOS desktop app only).',
	'html returns the live DOM markup and find searches the rendered text and markup, so you can inspect the code actually running in the page.',
	'console lists captured console output and page errors; network lists fetch/XHR/resource requests.',
	'navigate/back/forward/reload/stop control navigation and wait for the next document to load.',
	'evaluate runs JavaScript and returns a serializable result.',
	'Desktop uses a native top-level webview; web clients can only automate same-origin iframe pages and cannot capture screenshots because browser security blocks cross-origin access.',
].join(' ');

function controlTimeoutMs(input: BrowserInput): number {
	switch (input.action) {
		case 'wait_for':
			return waitForTimeoutMs(input) + WAIT_FOR_CONTROL_MARGIN_MS;
		case 'navigate':
		case 'back':
		case 'forward':
		case 'reload':
			return NAVIGATION_CONTROL_TIMEOUT_MS;
		case 'screenshot':
			return SCREENSHOT_CONTROL_TIMEOUT_MS;
		default:
			return DEFAULT_CONTROL_TIMEOUT_MS;
	}
}

function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}

interface ScreenshotCapture {
	data: string;
	mediaType?: string;
	url?: string;
	title?: string;
}

function readScreenshotCapture(
	result: Record<string, unknown>,
): ScreenshotCapture | null {
	const data = result.data;
	if (typeof data !== 'string' || !data) return null;
	return {
		data,
		mediaType:
			typeof result.mediaType === 'string' ? result.mediaType : 'image/png',
		url: typeof result.url === 'string' ? result.url : undefined,
		title: typeof result.title === 'string' ? result.title : undefined,
	};
}

async function buildScreenshotResult(
	capture: ScreenshotCapture,
	tabId: string,
): Promise<Record<string, unknown>> {
	const mediaType = capture.mediaType ?? 'image/png';
	if (!SUPPORTED_SCREENSHOT_MEDIA_TYPES.has(mediaType)) {
		throw new Error(`Unsupported browser screenshot media type: ${mediaType}`);
	}
	if (capture.data.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4) {
		throw new Error('Browser screenshot exceeds the 24 MB size limit');
	}
	if (
		capture.data.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(capture.data)
	) {
		throw new Error('Browser screenshot is not valid base64 data');
	}
	const raw = Buffer.from(capture.data, 'base64');
	if (raw.byteLength === 0 || raw.byteLength > MAX_SCREENSHOT_BYTES) {
		throw new Error(
			'Browser screenshot is empty or exceeds the 24 MB size limit',
		);
	}
	const prepared = await prepareScreenshotForModel(new Uint8Array(raw), {
		mediaType,
	});
	return {
		ok: true,
		action: 'screenshot',
		tabId,
		url: capture.url,
		title: capture.title,
		message:
			'Browser screenshot captured and sent to the model; it is not stored on disk.',
		artifact: {
			kind: 'browser_screenshot',
			mediaType: prepared.mediaType,
			data: Buffer.from(prepared.data).toString('base64'),
			originalSize: raw.byteLength,
			transmittedSize: prepared.data.byteLength,
			compressed: prepared.compressed,
			width: prepared.width,
			height: prepared.height,
		},
	};
}

export function buildBrowserTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'browser',
		tool: tool({
			description,
			inputSchema: browserInputSchema,
			toModelOutput({ output }) {
				const result = output as {
					ok?: boolean;
					url?: string;
					artifact?: {
						kind?: string;
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
					image?.kind === 'browser_screenshot' &&
					typeof image.data === 'string' &&
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
								text: `Browser screenshot of ${result.url ?? 'the current page'} (${image.mediaType}${dimensions}${compressed}, ${image.transmittedSize ?? image.data.length} bytes sent to the model). Inspect the following image. If the image is unreadable, use browser snapshot or html instead of guessing from pixels.`,
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
			execute: async (
				input: BrowserInput,
				options?: { abortSignal?: AbortSignal },
			) => {
				try {
					if (options?.abortSignal?.aborted) {
						return createToolError(
							'Browser action was cancelled',
							'execution',
							{ action: input.action },
						);
					}
					const kind = input.kind ?? 'browser';
					if (input.action === 'open') {
						const url = validateBrowserUrl(input.url ?? '');
						const title =
							input.title ?? (kind === 'simulator' ? 'Simulator' : 'Browser');
						const tabId =
							input.tabId ??
							(input.newTab
								? `browser:agent:${crypto.randomUUID()}`
								: defaultTabId(kind));
						return {
							ok: true,
							action: 'open',
							url,
							title,
							kind,
							tabId,
							newTab: input.newTab ?? false,
							message: `Opened ${url} in Otto built-in browser preview`,
							hint: 'The preview loads the page asynchronously. Call snapshot (or screenshot) next; it waits for the page to be ready.',
						};
					}

					const tabId = input.tabId ?? defaultTabId(kind);
					const result = await requestBrowserControl(
						{
							projectRoot,
							tabId,
							action: input.action,
							args: browserControlArgs(input),
						},
						controlTimeoutMs(input),
						options?.abortSignal,
					);

					if (input.action === 'screenshot' && result.ok === true) {
						const capture = readScreenshotCapture(result);
						if (!capture) {
							return createToolError(
								'The browser preview returned an empty screenshot.',
								'execution',
								{ action: input.action, tabId },
							);
						}
						return await buildScreenshotResult(capture, tabId);
					}

					return { ...result, action: input.action, tabId };
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
