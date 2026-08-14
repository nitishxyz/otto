import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createMachineAccountStore } from '../src/lib/machine-account-store';
import type { MachineDeviceState } from '../src/lib/machine-api';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

const CONNECTED: MachineDeviceState = {
	configured: true,
	devices: [
		{ deviceId: 'shared-device', machineId: 'remote-1', hostname: 'studio' },
	],
};

describe('shared machine account store', () => {
	test('initial mount stays unknown (no signed-out flash) until the daemon answers', async () => {
		const pending = deferred<MachineDeviceState>();
		let calls = 0;
		const store = createMachineAccountStore(() => {
			calls += 1;
			return pending.promise;
		});

		const refreshed = store.refresh();
		expect(store.getSnapshot()).toEqual({ state: null, loading: true });
		expect(store.getSnapshot().state?.configured).not.toBe(false);

		pending.resolve(CONNECTED);
		await refreshed;
		expect(store.getSnapshot()).toEqual({ state: CONNECTED, loading: false });
		expect(calls).toBe(1);
	});

	test('concurrent refreshes share one in-flight request (no request storm)', async () => {
		const pending = deferred<MachineDeviceState>();
		let calls = 0;
		const store = createMachineAccountStore(() => {
			calls += 1;
			return pending.promise;
		});

		const first = store.refresh();
		const second = store.refresh();
		const third = store.refresh();
		expect(second).toBe(first);
		expect(third).toBe(first);

		pending.resolve(CONNECTED);
		await first;
		expect(calls).toBe(1);

		await store.refresh();
		expect(calls).toBe(2);
	});

	test('refreshFresh after auth change never resolves with pre-auth in-flight data', async () => {
		const first = deferred<MachineDeviceState>();
		let calls = 0;
		const store = createMachineAccountStore(() => {
			calls += 1;
			return calls === 1 ? first.promise : Promise.resolve(CONNECTED);
		});

		// Interval poll starts before the user approves the device flow.
		const stalePoll = store.refresh();
		// Auth completes; a plain refresh would dedupe into the stale poll.
		const fresh = store.refreshFresh();

		first.resolve({ configured: false, devices: [] });
		await stalePoll;
		await fresh;

		expect(calls).toBe(2);
		expect(store.getSnapshot().state).toEqual(CONNECTED);
	});

	test('refreshFresh without an in-flight request performs a single fetch', async () => {
		let calls = 0;
		const store = createMachineAccountStore(() => {
			calls += 1;
			return Promise.resolve(CONNECTED);
		});
		await store.refreshFresh();
		expect(calls).toBe(1);
		expect(store.getSnapshot().state).toEqual(CONNECTED);
	});

	test('all subscribers observe the same snapshot (header and Machines stay in sync)', async () => {
		let next: MachineDeviceState = CONNECTED;
		const store = createMachineAccountStore(() => Promise.resolve(next));
		const seen: Array<{ header: boolean | null; machines: boolean | null }> =
			[];
		const record = () => {
			const state = store.getSnapshot().state;
			seen.push({
				header: state?.configured ?? null,
				machines: state?.configured ?? null,
			});
		};
		store.subscribe(record);
		store.subscribe(record);

		await store.refresh();
		next = { configured: false, devices: [] };
		await store.refresh();

		const settled = seen.filter((entry) => entry.header !== null);
		expect(settled.at(0)).toEqual({ header: true, machines: true });
		expect(settled.at(-1)).toEqual({ header: false, machines: false });
		for (const entry of seen) {
			expect(entry.header).toBe(entry.machines);
		}
	});

	test('fetch failure maps to a daemon-unavailable signed-out state', async () => {
		const store = createMachineAccountStore(() =>
			Promise.reject(new Error('daemon down')),
		);
		await store.refresh();
		const snapshot = store.getSnapshot();
		expect(snapshot.loading).toBe(false);
		expect(snapshot.state?.configured).toBe(false);
		expect(snapshot.state?.error).toContain('daemon');
	});
});

describe('landing header account lifecycle wiring', () => {
	test('landing loads account state on mount, not behind the Machines tab gate', async () => {
		const hook = await readFile('src/hooks/useMachineDevices.ts', 'utf8');
		expect(hook).toContain('useSyncExternalStore');
		expect(hook).toContain('machineAccountStore.refresh()');
		expect(hook).toContain("addEventListener('focus'");
		expect(hook).toContain("addEventListener('visibilitychange'");
		expect(hook).toContain('setInterval');
		expect(hook).toContain('MACHINE_AUTH_CHANGED_EVENT');

		const picker = await readFile('src/components/ProjectPicker.tsx', 'utf8');
		expect(picker).toContain('useMachineDevices()');
		// The header renders a checking state before the first daemon answer.
		expect(picker).toContain('initializing={machineState === null}');
		// No picker-local fetching or focus listeners that could duplicate polls.
		expect(picker).not.toContain('loadMachineDevices');
		expect(picker).not.toContain("addEventListener('focus'");
	});
});
