import { expect, test } from 'bun:test';
import {
	ShellExecution,
	type ShellOutcome,
} from '../packages/sdk/src/core/src/tools/shell/engine.ts';
import type { ShellProcess } from '../packages/sdk/src/core/src/tools/shell/transport.ts';

function transport(usesPty = false) {
	let close: (code: number | null, signal?: NodeJS.Signals | null) => void =
		() => {};
	let output: (text: string) => void = () => {};
	let error: (value: Error) => void = () => {};
	const signals: string[] = [];
	let cleaned = 0;
	const proc: ShellProcess = {
		usesPty,
		write: (value) => {
			signals.push(value);
		},
		destroyInput: () => {},
		kill: (signal) => {
			signals.push(signal);
		},
		onStdout: (listener) => {
			output = listener;
		},
		onStderr: () => {},
		onClose: (listener) => {
			close = listener;
		},
		onError: (listener) => {
			error = listener;
		},
		cleanup: () => {
			cleaned++;
		},
	};
	return {
		proc,
		signals,
		close: (code: number | null) => close(code),
		output: (text: string) => output(text),
		error: (value: Error) => error(value),
		cleaned: () => cleaned,
	};
}

async function collect(execution: ShellExecution<ShellOutcome>) {
	const results: ShellOutcome[] = [];
	for await (const event of execution.stream())
		if ('result' in event) results.push(event.result);
	return results;
}

const defaults = {
	timeout: 0,
	outputMode: 'full' as const,
	tailLines: 10,
	maxOutputBytes: 100,
	format: (outcome: ShellOutcome) => outcome,
};

test('shared engine settles spawn errors once and does not start an aborted process', async () => {
	const controller = new AbortController();
	controller.abort();
	let spawns = 0;
	const execution = new ShellExecution({
		...defaults,
		abortSignal: controller.signal,
		spawn: () => {
			spawns++;
			throw new Error('synthetic spawn failure');
		},
	});
	execution.start();
	expect(await collect(execution)).toMatchObject([{ reason: 'abort' }]);
	expect(spawns).toBe(0);
	const failed = new ShellExecution({
		...defaults,
		spawn: () => {
			throw new Error('synthetic spawn failure');
		},
	});
	failed.start();
	expect(await collect(failed)).toMatchObject([
		{ reason: 'execution', error: { message: 'synthetic spawn failure' } },
	]);
});

test('detached engine retains capture, deadline and single completion after consumer cancellation', async () => {
	const fake = transport();
	const controller = new AbortController();
	const completed: ShellOutcome[] = [];
	const execution = new ShellExecution({
		...defaults,
		timeout: 20,
		abortSignal: controller.signal,
		spawn: () => fake.proc,
		onComplete: (_result, outcome) => {
			completed.push(outcome);
		},
	});
	execution.start();
	expect(execution.detach((outcome) => outcome)).toBe(true);
	expect(execution.detach((outcome) => outcome)).toBe(false);
	await collect(execution);
	controller.abort();
	expect(fake.signals).toEqual([]);
	fake.output('x'.repeat(300));
	await Bun.sleep(40);
	expect(fake.signals).toEqual(['SIGTERM']);
	fake.close(null);
	fake.error(new Error('late error'));
	expect(completed).toMatchObject([
		{
			reason: 'timeout',
			stdout: 'x'.repeat(100),
			metadata: { stdoutOriginalBytes: 300, stdoutShownBytes: 100 },
		},
	]);
	expect(completed).toHaveLength(1);
	expect(fake.cleaned()).toBe(1);
});

test('PTY cancellation escalates interrupt through SIGTERM to SIGKILL', async () => {
	const fake = transport(true);
	const execution = new ShellExecution({ ...defaults, spawn: () => fake.proc });
	execution.start();
	execution.cancel();
	execution.cancel();
	await Bun.sleep(1300);
	expect(fake.signals).toEqual(['\x03', 'SIGTERM', 'SIGKILL']);
	fake.close(null);
	expect(await collect(execution)).toMatchObject([{ reason: 'abort' }]);
	expect(fake.cleaned()).toBe(1);
});
