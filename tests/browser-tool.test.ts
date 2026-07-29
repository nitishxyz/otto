import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverProjectTools } from '@ottocode/sdk';
import {
	submitBrowserControlResult,
	waitForBrowserControlCommand,
} from '@ottocode/sdk/browser-control';
import { browserControlArgs } from '../packages/sdk/src/core/src/tools/lazy/browser-command';
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

	it('resolves snapshot references through data attributes', () => {
		const script = actionScript({
			id: 'c',
			tabId: 't',
			action: 'click',
			args: { selector: '@e7' },
		});
		expect(script).toContain('data-otto-ref');
		expect(script).toContain('"@e7"');
	});
});

describe('browser tool routing', () => {
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
