import { afterEach, describe, expect, test } from 'bun:test';

const originalWindow = globalThis.window;

afterEach(() => {
	Object.defineProperty(globalThis, 'window', {
		value: originalWindow,
		configurable: true,
		writable: true,
	});
});

describe('desktop daemon API bootstrap', () => {
	test('never falls back to localhost:9100 before daemon registration', async () => {
		Object.defineProperty(globalThis, 'window', {
			value: {
				__TAURI_INTERNALS__: {},
				location: { search: '' },
				localStorage: { getItem: () => null },
			},
			configurable: true,
			writable: true,
		});
		const config = await import(
			`../../../packages/web-sdk/src/lib/config.ts?desktop=${Date.now()}`
		);
		expect(config.getRuntimeApiBaseUrl()).toBe('');
		expect(config.getRuntimeApiBaseUrl()).not.toContain('localhost:9100');
	});

	test('uses the daemon registration URL once desktop configures it', async () => {
		Object.defineProperty(globalThis, 'window', {
			value: {
				__TAURI_INTERNALS__: {},
				OTTO_SERVER_URL: 'http://127.0.0.1:47477',
				location: { search: '' },
				localStorage: { getItem: () => null },
			},
			configurable: true,
			writable: true,
		});
		const config = await import(
			`../../../packages/web-sdk/src/lib/config.ts?daemon=${Date.now()}`
		);
		expect(config.getRuntimeApiBaseUrl()).toBe('http://127.0.0.1:47477');
	});
});
