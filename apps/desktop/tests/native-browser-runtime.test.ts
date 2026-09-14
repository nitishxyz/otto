import { describe, expect, test } from 'bun:test';
import type { EventCallback, EventName } from '@tauri-apps/api/event';
import { observeNativeBrowserMetadata } from '../src/lib/native-browser-metadata';
import { waitForBrowserWindow } from '../src/lib/native-browser-window';
import type { NativeBrowserNavigationEvent } from '../src/lib/native-browser';

function windowEvents() {
	const handlers = new Map<string, EventCallback<unknown>>();
	return {
		once<T>(name: EventName, callback: EventCallback<T>) {
			handlers.set(name, callback as EventCallback<unknown>);
			return Promise.resolve(() => {
				handlers.delete(name);
			});
		},
		emit(name: string, payload: unknown = null) {
			handlers.get(name)?.({ event: name, id: 1, payload });
		},
		handlers,
	};
}

async function until(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(2);
	}
	throw new Error('Condition was not reached');
}

describe('native browser lifecycle', () => {
	test('opening waits for creation and removes both listeners', async () => {
		const window = windowEvents();
		let resolved = false;
		const opening = waitForBrowserWindow(window).then(() => {
			resolved = true;
		});
		await Bun.sleep(0);
		expect(resolved).toBe(false);
		window.emit('tauri://created');
		await opening;
		expect(resolved).toBe(true);
		expect(window.handlers.size).toBe(0);
	});

	test('creation failures reject instead of reporting success', async () => {
		const window = windowEvents();
		const opening = waitForBrowserWindow(window);
		window.emit('tauri://error', 'creation denied');
		await expect(opening).rejects.toThrow('creation denied');
		expect(window.handlers.size).toBe(0);
	});

	test('listener registration failures reject and clean late registrations', async () => {
		let cleaned = false;
		const opening = waitForBrowserWindow({
			once: (name) =>
				name === 'tauri://created'
					? Promise.reject(new Error('listen failed'))
					: Promise.resolve(() => {
							cleaned = true;
						}),
		});
		await expect(opening).rejects.toThrow('listen failed');
		expect(cleaned).toBe(true);
	});

	test('metadata detects same-document URL and title changes, deduplicates, and stops', async () => {
		let metadata = {
			url: 'https://example.com/start',
			title: 'Start',
			loading: false,
		};
		const events: NativeBrowserNavigationEvent[] = [];
		let samples = 0;
		const stop = observeNativeBrowserMetadata(
			'tab',
			async () => {
				samples++;
				return metadata;
			},
			(event) => events.push(event),
			2,
		);
		try {
			await until(() => events.length === 1);
			await until(() => samples >= 3);
			expect(events).toHaveLength(1);
			metadata = {
				...metadata,
				url: 'https://example.com/next',
				title: 'Next',
			};
			await until(() => events.length === 2);
			expect(events[1]).toEqual({ id: 'tab', ...metadata });
		} finally {
			stop();
		}
		const stoppedAt = samples;
		await Bun.sleep(10);
		expect(samples).toBe(stoppedAt);
	});

	test('metadata recovers after mount errors and ignores in-flight results after unsubscribe', async () => {
		const events: NativeBrowserNavigationEvent[] = [];
		let samples = 0;
		let resolve: ((value: unknown) => void) | undefined;
		const stop = observeNativeBrowserMetadata(
			'tab',
			async () => {
				if (++samples === 1) throw new Error('not mounted');
				return new Promise((done) => {
					resolve = done;
				});
			},
			(event) => events.push(event),
			2,
		);
		try {
			await until(() => resolve !== undefined);
			await Bun.sleep(10);
			expect(samples).toBe(2);
		} finally {
			stop();
		}
		resolve?.({ url: 'https://example.com/', title: 'Late', loading: false });
		await Bun.sleep(0);
		expect(events).toHaveLength(0);
	});
});
