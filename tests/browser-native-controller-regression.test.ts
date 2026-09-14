import { describe, expect, it } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { executeCommand } from '../packages/web-sdk/src/lib/browser/controller';
import {
	nativeEvaluationScript,
	pageStateScript,
} from '../packages/web-sdk/src/lib/browser/page-scripts';

const command = (action: string, args: Record<string, unknown> = {}) => ({
	id: 'native',
	tabId: 'browser:test',
	action,
	args,
});
const ready = { ok: true, readyState: 'complete', url: 'https://example.test' };

describe('native browser controller integration', () => {
	it('gates native-only capabilities and never recreates native popups as tabs', async () => {
		const bridge = await readFile(
			new URL('../apps/desktop/src/lib/native-browser.ts', import.meta.url),
			'utf8',
		);
		for (const capability of ['nativeInput', 'asyncEvaluation', 'screenshot']) {
			expect(bridge).toContain(
				`${capability}: navigator.platform.startsWith('Mac')`,
			);
		}
		const viewer = await readFile(
			new URL(
				'../packages/web-sdk/src/components/browser/BrowserViewerPanel.tsx',
				import.meta.url,
			),
			'utf8',
		);
		expect(viewer).not.toContain('nativeBridge.subscribeNewTab(tab.id');
		expect(viewer).toContain('nativeBridge?.capabilities?.nativeInput');
		expect(viewer).toContain('nativeBridge?.capabilities?.asyncEvaluation');
		expect(viewer).toContain('nativeBridge?.capabilities?.screenshot');
	});

	it('returns and awaits the generated async expression without nested eval', async () => {
		const context = createContext(
			{ location: { href: ready.url }, Node: class {} },
			{ codeGeneration: { strings: false } },
		);
		runInContext('window = globalThis', context);
		const source = nativeEvaluationScript(
			command('evaluate', { script: 'await Promise.resolve(42)' }),
		);
		expect(source.startsWith('return (')).toBe(true);
		const value = await runInContext(
			`(async function() { ${source} })()`,
			context,
		);
		expect(JSON.parse(value)).toMatchObject({ ok: true, value: 42 });
		expect(
			Object.keys(context).some((key) =>
				key.startsWith('__ottoBrowserEvaluation:'),
			),
		).toBe(false);
	});

	it('prefers native evaluation and does not poll fallback state', async () => {
		let calls = 0;
		const result = await executeCommand(
			command('evaluate', { script: 'Promise.resolve(8)' }),
			{
				execute: async (script) => {
					expect(script).toBe(pageStateScript);
					return ready;
				},
				executeAsync: async (body) => {
					calls++;
					expect(body.startsWith('return (')).toBe(true);
					return JSON.stringify({ ok: true, value: 8 });
				},
			},
			'channel',
		);
		expect(calls).toBe(1);
		expect(result.value).toBe(8);
	});

	it.each(['click', 'hover', 'press', 'download'])(
		'dispatches %s natively without synthetic action scripts',
		async (action) => {
			const inputs: unknown[] = [];
			const result = await executeCommand(
				command(action, { selector: '@e1', key: 'Backspace' }),
				{
					execute: async (script) => {
						if (script === pageStateScript) return ready;
						expect(script).not.toContain('element.click()');
						return { ok: true, x: 12, y: 34 };
					},
					input: async (input) => {
						inputs.push(input);
					},
				},
				'channel',
			);
			expect(result).toMatchObject({ ok: true, inputMode: 'native' });
			expect(inputs).toEqual([
				action === 'press'
					? { type: 'key', key: 'Backspace' }
					: { type: action === 'hover' ? 'hover' : 'click', x: 12, y: 34 },
			]);
		},
	);

	it('propagates native hover failure without synthetic fallback', async () => {
		const result = await executeCommand(
			command('hover'),
			{
				execute: async (script) =>
					script === pageStateScript ? ready : { ok: true, x: 1, y: 1 },
				input: async () => {
					throw new Error('CSS :hover not confirmed');
				},
			},
			'channel',
		);
		expect(result).toEqual({ ok: false, error: 'CSS :hover not confirmed' });
	});
});
