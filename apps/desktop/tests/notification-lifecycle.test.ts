import { describe, expect, test } from 'bun:test';
import {
	createNotificationLifecycle,
	createNotificationRegistrationQueue,
} from '../src/lib/notification-lifecycle';
import type {
	NotificationSessionOpen,
	NotificationWindowContext,
} from '../src/lib/notification-routing';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const context: NotificationWindowContext = {
	workspace: {
		serverUrl: 'https://machine-a.test/',
		projectId: 'project-a',
		projectPath: '/project-a',
	},
	project: { path: '/project-a', name: 'A', lastOpened: '' },
	sessionId: 'session-a',
};
const payload: NotificationSessionOpen = {
	windowLabel: 'owner',
	workspace: context.workspace,
	sessionId: 'session-a',
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
	const calls: string[] = [];
	const errors: unknown[] = [];
	let current = true;
	let handler: ((payload: NotificationSessionOpen) => void) | undefined;
	const options = {
		windowLabel: 'owner',
		context,
		isCurrent: () => current,
		listen: async (callback: (payload: NotificationSessionOpen) => void) => {
			handler = callback;
			calls.push('listen');
			return () => calls.push('unlisten');
		},
		register: async (next: NotificationWindowContext | null) => {
			calls.push(next ? 'register' : 'unregister');
		},
		unminimize: async () => {
			calls.push('unminimize');
		},
		show: async () => {
			calls.push('show');
		},
		focus: async () => {
			calls.push('focus');
		},
		refresh: async () => {
			calls.push('refresh');
		},
		navigate: () => {
			calls.push('navigate');
		},
		onError: (error: unknown) => {
			errors.push(error);
		},
		enqueue: createNotificationRegistrationQueue(),
	};
	return {
		calls,
		errors,
		options,
		switchProject: () => {
			current = false;
		},
		emit: (next = payload) => handler?.(next),
	};
}

describe('notification activation lifecycle', () => {
	test('project switch during refresh prevents stale navigation', async () => {
		const h = harness();
		const refresh = deferred<void>();
		const lifecycle = createNotificationLifecycle({
			...h.options,
			refresh: async () => {
				h.calls.push('refresh');
				await refresh.promise;
			},
		});
		await lifecycle.ready;
		const activation = lifecycle.activate('session-a');
		await tick();
		expect(h.calls).toContain('refresh');
		h.switchProject();
		refresh.resolve();
		await activation;
		expect(h.calls).not.toContain('navigate');
		lifecycle.dispose();
		await tick();
		expect(h.errors).toEqual([]);
	});

	test('scope change during window operations prevents subsequent focus', async () => {
		const h = harness();
		const unminimize = deferred<void>();
		const lifecycle = createNotificationLifecycle({
			...h.options,
			unminimize: () => unminimize.promise,
		});
		await lifecycle.ready;
		const activation = lifecycle.activate('session-a');
		h.switchProject();
		unminimize.resolve();
		await activation;
		expect(h.calls).not.toContain('show');
		expect(h.calls).not.toContain('focus');
		expect(h.calls).not.toContain('navigate');
		lifecycle.dispose();
		await tick();
	});

	test('installs listener before publishing availability and handles activation during publication', async () => {
		const h = harness();
		const installed = deferred<() => void>();
		const lifecycle = createNotificationLifecycle({
			...h.options,
			listen: async (handler) => {
				await h.options.listen(handler);
				return installed.promise;
			},
			register: async (next) => {
				await h.options.register(next);
				if (next) h.emit();
			},
		});
		await tick();
		expect(h.calls).toEqual(['listen']);
		installed.resolve(() => h.calls.push('unlisten'));
		await lifecycle.ready;
		await tick();
		expect(h.calls.slice(0, 2)).toEqual(['listen', 'register']);
		expect(h.calls).toContain('navigate');
		lifecycle.dispose();
		await tick();
	});

	test('cleanup before listener setup completes never publishes stale availability', async () => {
		const h = harness();
		const installed = deferred<() => void>();
		const lifecycle = createNotificationLifecycle({
			...h.options,
			listen: async (handler) => {
				await h.options.listen(handler);
				return installed.promise;
			},
		});
		lifecycle.dispose();
		h.emit();
		installed.resolve(() => h.calls.push('unlisten'));
		await lifecycle.ready;
		await tick();
		expect(h.calls).toEqual(['listen', 'unlisten']);
	});

	test('pending registration cleanup completes before the next generation registers', async () => {
		const h = harness();
		const registration = deferred<void>();
		const first = createNotificationLifecycle({
			...h.options,
			register: async (next) => {
				h.calls.push(next ? 'register-old-start' : 'unregister-old');
				if (next) {
					await registration.promise;
					h.calls.push('register-old-end');
				}
			},
		});
		await tick();
		first.dispose();
		const next = harness();
		const second = createNotificationLifecycle({
			...next.options,
			enqueue: h.options.enqueue,
			register: async (value) => {
				h.calls.push(value ? 'register-new' : 'unregister-new');
			},
		});
		h.emit();
		await tick();
		expect(h.calls).not.toContain('register-new');
		registration.resolve();
		await Promise.all([first.ready, second.ready]);
		expect(h.calls).toEqual([
			'listen',
			'register-old-start',
			'unlisten',
			'register-old-end',
			'unregister-old',
			'register-new',
		]);
		expect(h.calls).not.toContain('focus');
		second.dispose();
		await tick();
		expect(h.calls.at(-1)).toBe('unregister-new');
	});
});
