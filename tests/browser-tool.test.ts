import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverProjectTools } from '@ottocode/sdk';
import {
	markBrowserViewerSeen,
	requestBrowserControl,
	submitBrowserControlResult,
	waitForBrowserControlCommand,
} from '@ottocode/sdk/browser-control';
import {
	browserControlArgs,
	browserInputSchema,
} from '../packages/sdk/src/core/src/tools/lazy/browser-command';
import {
	actionScript,
	pageStateScript,
	scrollIntoViewScript,
} from '../packages/web-sdk/src/lib/browser/page-scripts';
import { BROWSER_RECORDER_SCRIPT } from '../packages/web-sdk/src/lib/browser/recorder-script';

const onePixelPngBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUdGqwAAAABJRU5ErkJggg==';

async function withProject<T>(run: (root: string) => Promise<T>): Promise<T> {
	const root = await mkdtemp(join(tmpdir(), 'otto-browser-tool-'));
	try {
		return await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function routeCommand(
	projectRoot: string,
	tabId: string,
	result: Record<string, unknown>,
) {
	const command = await waitForBrowserControlCommand(projectRoot, tabId, 500);
	expect(command).not.toBeNull();
	expect(
		submitBrowserControlResult(projectRoot, command?.id ?? '', result),
	).toBe(true);
	return command;
}

describe('browser tool arguments', () => {
	it('applies defaults for inspection actions', () => {
		expect(browserControlArgs({ action: 'tabs' })).toEqual({});
		expect(browserControlArgs({ action: 'console' })).toEqual({
			level: 'all',
			limit: 50,
		});
		expect(browserControlArgs({ action: 'network', query: 'api' })).toEqual({
			query: 'api',
			limit: 50,
		});
		expect(browserControlArgs({ action: 'find', query: 'Sign in' })).toEqual({
			query: 'Sign in',
			limit: 20,
		});
		expect(browserControlArgs({ action: 'html' })).toEqual({
			selector: undefined,
			maxLength: 40_000,
		});
	});

	it('accepts text or selector for wait_for and rejects empty conditions', () => {
		expect(browserControlArgs({ action: 'wait_for', text: 'Loaded' })).toEqual({
			selector: undefined,
			text: 'Loaded',
			timeoutMs: 5_000,
		});
		expect(() => browserControlArgs({ action: 'wait_for' })).toThrow(
			/selector or text/,
		);
	});

	it('requires a selector for pointer actions', () => {
		expect(() => browserControlArgs({ action: 'hover' })).toThrow(
			/Missing required string field: selector/,
		);
		expect(browserControlArgs({ action: 'download', selector: '@e2' })).toEqual(
			{
				selector: '@e2',
			},
		);
		expect(() => browserControlArgs({ action: 'download' })).toThrow(
			/Missing required string field: selector/,
		);
	});

	it('rejects tab IDs that could overwrite non-browser viewer tabs', () => {
		expect(
			browserInputSchema.safeParse({
				action: 'open',
				url: 'https://example.com',
				tabId: 'file:README.md',
			}).success,
		).toBe(false);
		expect(
			browserInputSchema.safeParse({
				action: 'open',
				url: 'https://example.com',
				tabId: 'browser:agent:test',
			}).success,
		).toBe(true);
		expect(
			browserInputSchema.safeParse({
				action: 'open',
				url: 'https://example.com',
				tabId: 'browser:agent:a?b',
			}).success,
		).toBe(false);
	});
});

describe('browser page scripts', () => {
	const commands = [
		{ action: 'snapshot', args: {} },
		{ action: 'html', args: { selector: '@e2', maxLength: 5_000 } },
		{ action: 'find', args: { query: 'button"x', limit: 5 } },
		{ action: 'console', args: { level: 'error', limit: 10 } },
		{ action: 'network', args: { query: '/api', limit: 10 } },
		{ action: 'click', args: { selector: '@e1' } },
		{ action: 'download', args: { selector: '@e2' } },
		{ action: 'hover', args: { selector: '.menu' } },
		{ action: 'type', args: { selector: '#name', text: 'Ada' } },
		{ action: 'press', args: { key: 'Enter' } },
		{ action: 'scroll', args: { x: 0, y: 400 } },
		{ action: 'wait_for', args: { text: 'Done', timeoutMs: 1_000 } },
		{ action: 'evaluate', args: { script: 'document.title' } },
		{ action: 'navigate', args: { url: 'https://example.com/' } },
	];

	it('generates syntactically valid page scripts', () => {
		for (const command of commands) {
			const source = actionScript({ id: 'c', tabId: 't', ...command });
			expect(() => new Function(source)).not.toThrow();
		}
		expect(() => new Function(pageStateScript)).not.toThrow();
		expect(() => new Function(scrollIntoViewScript('@e3'))).not.toThrow();
		expect(() => new Function(BROWSER_RECORDER_SCRIPT)).not.toThrow();
	});

	it('reports new-tab and download link outcomes', () => {
		class FakeElement {
			readonly isConnected = true;
			readonly tagName = 'A';
			readonly innerText = 'Resource';
			readonly value = '';
			readonly disabled = false;
			clicks = 0;
			private clickListener?: (event: { preventDefault(): void }) => void;

			constructor(
				readonly href: string,
				private readonly attributes: Record<string, string>,
			) {}

			getAttribute(name: string): string | null {
				return this.attributes[name] ?? null;
			}
			hasAttribute(name: string): boolean {
				return name in this.attributes;
			}
			closest(selector: string) {
				return selector === 'a[href]' ? this : null;
			}
			addEventListener(
				type: string,
				listener: (event: { preventDefault(): void }) => void,
			) {
				if (type === 'click') this.clickListener = listener;
			}
			removeEventListener(type: string) {
				if (type === 'click') this.clickListener = undefined;
			}
			getBoundingClientRect() {
				return { left: 0, top: 0, width: 100, height: 30 };
			}
			scrollIntoView() {}
			dispatchEvent() {}
			focus() {}
			click() {
				this.clicks += 1;
				this.clickListener?.({ preventDefault() {} });
			}
		}

		class FakeInputElement extends FakeElement {}
		class FakeTextAreaElement extends FakeElement {}
		class FakeSelectElement extends FakeElement {}
		class FakeEvent {
			constructor(
				readonly type: string,
				readonly options?: Record<string, unknown>,
			) {}
		}

		const run = (element: FakeElement, action: 'click' | 'download') => {
			const originalOpen = () => null;
			const environment = {
				window: { open: originalOpen },
				document: {
					activeElement: null,
					title: 'Links',
					readyState: 'complete',
					querySelector: () => element,
				},
				location: { href: 'https://example.com/' },
				HTMLElement: FakeElement,
				HTMLInputElement: FakeInputElement,
				HTMLTextAreaElement: FakeTextAreaElement,
				HTMLSelectElement: FakeSelectElement,
				PointerEvent: FakeEvent,
				MouseEvent: FakeEvent,
			};
			const names = Object.keys(environment);
			const execute = new Function(
				...names,
				`return ${actionScript({ id: action, tabId: 't', action, args: { selector: '#link' } })};`,
			);
			const result = JSON.parse(
				String(execute(...Object.values(environment))),
			) as Record<string, unknown>;
			expect(environment.window.open).toBe(originalOpen);
			return result;
		};

		const popup = new FakeElement('https://example.com/docs', {
			href: '/docs',
			target: '_blank',
		});
		expect(run(popup, 'click')).toMatchObject({
			ok: true,
			newTab: { url: 'https://example.com/docs' },
		});

		const download = new FakeElement('https://example.com/report.csv', {
			href: '/report.csv',
			download: 'report.csv',
		});
		expect(run(download, 'download')).toMatchObject({
			ok: true,
			download: {
				url: 'https://example.com/report.csv',
				filename: 'report.csv',
			},
		});
		expect(popup.clicks).toBe(1);
		expect(download.clicks).toBe(1);
	});

	it('installs the recorder before reading console and network state', () => {
		const consoleScript = actionScript({
			id: 'c',
			tabId: 't',
			action: 'console',
			args: { level: 'all', limit: 5 },
		});
		expect(consoleScript).toContain('__ottoBrowserRecorder');
		expect(consoleScript.startsWith(BROWSER_RECORDER_SCRIPT)).toBe(true);
	});

	it('records network resources without replacing page request APIs', () => {
		expect(BROWSER_RECORDER_SCRIPT).toContain('new PerformanceObserver');
		expect(BROWSER_RECORDER_SCRIPT).not.toContain('window.fetch =');
		expect(BROWSER_RECORDER_SCRIPT).not.toContain(
			'XMLHttpRequest.prototype.open =',
		);
		expect(BROWSER_RECORDER_SCRIPT).not.toContain('XHR.prototype.open =');
	});

	it('keeps snapshot references isolated from page-controlled attributes', () => {
		class FakeElement {
			readonly isConnected = true;
			readonly tagName = 'BUTTON';
			readonly innerText: string;
			readonly value = '';
			readonly disabled = false;
			clicks = 0;

			constructor(
				label: string,
				private readonly attributes: Record<string, string> = {},
			) {
				this.innerText = label;
			}

			getAttribute(name: string): string | null {
				return this.attributes[name] ?? null;
			}

			getBoundingClientRect() {
				return { left: 0, top: 0, width: 100, height: 30 };
			}

			scrollIntoView() {}
			dispatchEvent() {}
			focus() {}
			click() {
				this.clicks += 1;
			}
		}

		class FakeInputElement extends FakeElement {}
		class FakeTextAreaElement extends FakeElement {}
		class FakeSelectElement extends FakeElement {}
		class FakeEvent {
			constructor(
				readonly type: string,
				readonly options?: Record<string, unknown>,
			) {}
		}

		const trusted = new FakeElement('Trusted button', {
			'data-otto-ref': 'e1',
		});
		const attacker = new FakeElement('Attacker button', {
			'data-otto-ref': 'e1',
		});
		let selectorQueries = 0;
		const document = {
			activeElement: null,
			body: { innerText: 'Test page' },
			documentElement: { scrollHeight: 800 },
			title: 'Test',
			readyState: 'complete',
			querySelectorAll: () => [trusted],
			querySelector: () => {
				selectorQueries += 1;
				return attacker;
			},
		};
		const environment = {
			window: {},
			document,
			location: { href: 'https://example.com/' },
			HTMLElement: FakeElement,
			HTMLInputElement: FakeInputElement,
			HTMLTextAreaElement: FakeTextAreaElement,
			HTMLSelectElement: FakeSelectElement,
			getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
			innerWidth: 1200,
			innerHeight: 800,
			scrollY: 0,
			PointerEvent: FakeEvent,
			MouseEvent: FakeEvent,
		};
		const run = (script: string): unknown => {
			const names = Object.keys(environment);
			const execute = new Function(...names, `return ${script};`);
			return execute(...Object.values(environment));
		};
		const referenceChannel = 'integrity-test';
		const snapshot = JSON.parse(
			String(
				run(
					actionScript(
						{ id: 'snapshot', tabId: 't', action: 'snapshot', args: {} },
						referenceChannel,
					),
				),
			),
		) as { elements: Array<{ ref: string }> };
		expect(snapshot.elements[0]?.ref).toBe('@e1');

		const clicked = JSON.parse(
			String(
				run(
					actionScript(
						{
							id: 'click',
							tabId: 't',
							action: 'click',
							args: { selector: '@e1' },
						},
						referenceChannel,
					),
				),
			),
		) as { ok: boolean; name: string };
		expect(clicked).toMatchObject({ ok: true, name: 'Trusted button' });
		expect(trusted.clicks).toBe(1);
		expect(attacker.clicks).toBe(0);
		expect(selectorQueries).toBe(0);

		const wrongChannel = JSON.parse(
			String(
				run(
					actionScript(
						{
							id: 'wrong-channel',
							tabId: 't',
							action: 'click',
							args: { selector: '@e1' },
						},
						'other-channel',
					),
				),
			),
		) as { ok: boolean; error: string };
		expect(wrongChannel).toEqual({
			ok: false,
			error: 'Element not found: @e1',
		});
		expect(trusted.clicks).toBe(1);
	});
});

describe('browser tool routing', () => {
	it('lists connected browser tabs with their current metadata', async () => {
		await withProject(async (projectRoot) => {
			markBrowserViewerSeen(projectRoot, 'browser:browser', {
				url: 'https://example.com/docs',
				title: 'Documentation',
				kind: 'browser',
			});
			markBrowserViewerSeen(projectRoot, 'browser:simulator', {
				url: 'http://localhost:3200/',
				title: 'Simulator',
				kind: 'simulator',
			});

			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const result = await lazyToolsRecord.browser?.execute?.({
				action: 'tabs',
			});

			expect(result).toMatchObject({
				ok: true,
				action: 'tabs',
				count: 2,
				tabs: [
					{
						tabId: 'browser:browser',
						url: 'https://example.com/docs',
						title: 'Documentation',
						kind: 'browser',
					},
					{
						tabId: 'browser:simulator',
						url: 'http://localhost:3200/',
						title: 'Simulator',
						kind: 'simulator',
					},
				],
			});
		});
	});

	it('removes queued commands when execution is cancelled', async () => {
		await withProject(async (projectRoot) => {
			const abortController = new AbortController();
			const resultPromise = requestBrowserControl(
				{
					projectRoot,
					tabId: 'browser:test-cancel',
					action: 'click',
					args: { selector: '@e1' },
				},
				5_000,
				abortController.signal,
			);
			abortController.abort();

			expect(await resultPromise).toEqual({
				ok: false,
				error: 'Browser action was cancelled',
			});
			expect(
				await waitForBrowserControlCommand(
					projectRoot,
					'browser:test-cancel',
					10,
				),
			).toBeNull();
		});
	});

	it('returns console entries collected by the viewer', async () => {
		await withProject(async (projectRoot) => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const resultPromise = lazyToolsRecord.browser?.execute?.({
				action: 'console',
				tabId: 'browser:test-console',
				level: 'error',
			});

			const command = await routeCommand(projectRoot, 'browser:test-console', {
				ok: true,
				messages: [{ level: 'error', text: 'boom' }],
			});
			expect(command).toMatchObject({
				action: 'console',
				args: { level: 'error', limit: 50 },
			});
			expect(await resultPromise).toMatchObject({
				ok: true,
				action: 'console',
				tabId: 'browser:test-console',
				messages: [{ level: 'error', text: 'boom' }],
			});
		});
	});

	it('rejects unsupported screenshot media types', async () => {
		await withProject(async (projectRoot) => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const browserTool = lazyToolsRecord.browser;
			const resultPromise = browserTool?.execute?.({
				action: 'screenshot',
				tabId: 'browser:test-invalid-shot',
			});

			await routeCommand(projectRoot, 'browser:test-invalid-shot', {
				ok: true,
				data: onePixelPngBase64,
				mediaType: 'image/svg+xml',
			});

			expect(await resultPromise).toMatchObject({
				ok: false,
				errorType: 'execution',
			});
		});
	});

	it('rejects malformed screenshot data', async () => {
		await withProject(async (projectRoot) => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const resultPromise = lazyToolsRecord.browser?.execute?.({
				action: 'screenshot',
				tabId: 'browser:test-malformed-shot',
			});

			await routeCommand(projectRoot, 'browser:test-malformed-shot', {
				ok: true,
				data: 'not base64',
				mediaType: 'image/png',
			});

			expect(await resultPromise).toMatchObject({
				ok: false,
				error: 'Browser screenshot is not valid base64 data',
				errorType: 'execution',
			});
		});
	});

	it('turns viewer screenshots into model image content', async () => {
		await withProject(async (projectRoot) => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const browserTool = lazyToolsRecord.browser;
			const resultPromise = browserTool?.execute?.({
				action: 'screenshot',
				tabId: 'browser:test-shot',
			});

			await routeCommand(projectRoot, 'browser:test-shot', {
				ok: true,
				data: onePixelPngBase64,
				mediaType: 'image/png',
				url: 'http://localhost:3000/',
				title: 'Local app',
			});

			const result = (await resultPromise) as {
				ok: boolean;
				url: string;
				artifact: { kind: string; mediaType: string; data: string };
			};
			expect(result.ok).toBe(true);
			expect(result.url).toBe('http://localhost:3000/');
			expect(result.artifact.kind).toBe('browser_screenshot');
			expect(result.artifact.data.length).toBeGreaterThan(0);

			const modelOutput = await browserTool?.toModelOutput?.({
				toolCallId: 'call-1',
				input: { action: 'screenshot' },
				output: result,
			});
			expect(modelOutput).toHaveProperty('type', 'content');
			expect(
				(modelOutput as { value: Array<{ type: string }> }).value.some(
					(part) => part.type === 'image-data',
				),
			).toBe(true);
		});
	});

	it('keeps non-screenshot results as json output', async () => {
		await withProject(async (projectRoot) => {
			const { lazyToolsRecord } = await discoverProjectTools(projectRoot);
			const browserTool = lazyToolsRecord.browser;
			const modelOutput = await browserTool?.toModelOutput?.({
				toolCallId: 'call-2',
				input: { action: 'snapshot' },
				output: { ok: true, text: 'hello' },
			});
			expect(modelOutput).toEqual({
				type: 'json',
				value: { ok: true, text: 'hello' },
			});
		});
	});
});
