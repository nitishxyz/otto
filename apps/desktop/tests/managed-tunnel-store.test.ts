import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
	createManagedTunnelStore,
	toManagedTunnelActionError,
	toManagedTunnelStatus,
} from '../src/lib/managed-tunnel-store';

const CONNECTED_STATUS = {
	mode: 'managed',
	scope: 'remote-control',
	projectId: null,
	status: 'connected',
	url: 'https://abc.ottorouter.org',
	error: null,
	binaryInstalled: true,
	isRunning: true,
	hostname: 'abc.ottorouter.org',
	ottorouterConnected: true,
};

function makeApi(overrides?: {
	start?: () => Promise<{ data?: unknown; error?: unknown }>;
	stop?: () => Promise<{ data?: unknown; error?: unknown }>;
	status?: () => Promise<{ data?: unknown; error?: unknown }>;
}) {
	const calls = { status: 0, start: 0, stop: 0 };
	const api = {
		status: () => {
			calls.status += 1;
			return (
				overrides?.status?.() ?? Promise.resolve({ data: CONNECTED_STATUS })
			);
		},
		start: () => {
			calls.start += 1;
			return overrides?.start?.() ?? Promise.resolve({ data: { ok: true } });
		},
		stop: () => {
			calls.stop += 1;
			return overrides?.stop?.() ?? Promise.resolve({ data: { ok: true } });
		},
	};
	return { api, calls };
}

describe('managed tunnel status mapping', () => {
	test('maps daemon statuses onto Off/Starting/Online/Error', () => {
		expect(toManagedTunnelStatus({ status: 'idle' }).state).toBe('off');
		expect(toManagedTunnelStatus({ status: 'starting' }).state).toBe(
			'starting',
		);
		expect(toManagedTunnelStatus({ status: 'connected' }).state).toBe('online');
		expect(toManagedTunnelStatus({ status: 'error' }).state).toBe('error');
		expect(toManagedTunnelStatus(undefined).state).toBe('off');
	});

	test('keeps hostname and ottorouter prerequisite from the payload', () => {
		const status = toManagedTunnelStatus(CONNECTED_STATUS);
		expect(status.hostname).toBe('abc.ottorouter.org');
		expect(status.url).toBe('https://abc.ottorouter.org');
		expect(status.ottorouterConnected).toBe(true);
	});
});

describe('managed tunnel action errors', () => {
	test('ottorouter_not_connected maps to a clear prerequisite message', () => {
		const message = toManagedTunnelActionError({
			ok: false,
			code: 'ottorouter_not_connected',
			error: 'Connect OttoRouter before starting a managed tunnel',
		});
		expect(message).toBe('Connect OttoRouter before enabling remote access.');
		expect(message).not.toContain('TypeError');
	});

	test('falls back to typed body error, then a generic daemon message', () => {
		expect(toManagedTunnelActionError({ error: 'binary missing' })).toBe(
			'binary missing',
		);
		expect(toManagedTunnelActionError(undefined)).toContain(
			'managed tunnel request failed',
		);
	});
});

describe('managed tunnel store flows', () => {
	test('enable calls start exactly once and refreshes status after', async () => {
		const { api, calls } = makeApi();
		const store = createManagedTunnelStore(api);
		await store.enable();
		expect(calls.start).toBe(1);
		expect(calls.status).toBe(1);
		expect(store.getSnapshot().status?.state).toBe('online');
		expect(store.getSnapshot().actionError).toBeNull();
	});

	test('pending action blocks double enable/disable', async () => {
		let releaseStart!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const { api, calls } = makeApi({
			start: () => gate.then(() => ({ data: { ok: true } })),
		});
		const store = createManagedTunnelStore(api);
		const first = store.enable();
		const second = store.enable();
		const third = store.disable();
		releaseStart();
		await Promise.all([first, second, third]);
		expect(calls.start).toBe(1);
		expect(calls.stop).toBe(0);
	});

	test('disable stops the managed remote-control tunnel', async () => {
		const { api, calls } = makeApi({
			status: () =>
				Promise.resolve({
					data: { ...CONNECTED_STATUS, status: 'idle', hostname: null },
				}),
		});
		const store = createManagedTunnelStore(api);
		await store.disable();
		expect(calls.stop).toBe(1);
		expect(store.getSnapshot().status?.state).toBe('off');
	});

	test('start failure surfaces the typed error and keeps the panel usable', async () => {
		const { api } = makeApi({
			start: () =>
				Promise.resolve({
					error: { ok: false, code: 'ottorouter_not_connected' },
				}),
		});
		const store = createManagedTunnelStore(api);
		await store.enable();
		expect(store.getSnapshot().actionError).toBe(
			'Connect OttoRouter before enabling remote access.',
		);
		expect(store.getSnapshot().pending).toBeNull();
	});

	test('concurrent status refreshes share one request', async () => {
		let resolveStatus!: (value: { data: unknown }) => void;
		const pending = new Promise<{ data: unknown }>((resolve) => {
			resolveStatus = resolve;
		});
		const { api, calls } = makeApi({ status: () => pending });
		const store = createManagedTunnelStore(api);
		const first = store.refresh();
		const second = store.refresh();
		expect(second).toBe(first);
		resolveStatus({ data: CONNECTED_STATUS });
		await first;
		expect(calls.status).toBe(1);
	});

	test('status transport failure maps to an error state, not a thrown TypeError', async () => {
		const { api } = makeApi({
			status: () => Promise.reject(new TypeError('fetch failed')),
		});
		const store = createManagedTunnelStore(api);
		await store.refresh();
		const status = store.getSnapshot().status;
		expect(status?.state).toBe('error');
		expect(status?.error).not.toContain('TypeError');
	});
});

describe('local tunnel panel wiring', () => {
	test('panel renders above remote machines and uses the generated client', async () => {
		const picker = await readFile('src/components/ProjectPicker.tsx', 'utf8');
		const panelIndex = picker.indexOf('<LocalTunnelPanel');
		const launcherIndex = picker.indexOf('<MachineLauncher');
		expect(panelIndex).toBeGreaterThan(-1);
		expect(launcherIndex).toBeGreaterThan(panelIndex);

		const store = await readFile('src/lib/managed-tunnel-store.ts', 'utf8');
		expect(store).toContain("from '@ottocode/api'");
		expect(store).toContain("mode: 'managed'");
		expect(store).toContain("scope: 'remote-control'");
		expect(store).not.toContain('fetch(');

		const panel = await readFile('src/components/LocalTunnelPanel.tsx', 'utf8');
		expect(panel).toContain('Connect OttoRouter');
		expect(panel).not.toContain("mode: 'quick'");
	});
});
