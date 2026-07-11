import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolveMachinesAuthView } from '../src/lib/ottorouter-actions';
import { runOttoRouterDeviceFlow } from '../src/lib/ottorouter-device-flow';

function makeDeps(
	polls: Array<{ status: 'pending' | 'complete' | 'error'; error?: string }>,
	overrides?: { isCancelled?: () => boolean; timeoutMs?: number },
) {
	let pollIndex = 0;
	const opened: string[] = [];
	let clock = 0;
	return {
		opened,
		deps: {
			start: async () => ({
				sessionId: 'session-1',
				verificationUri: 'https://ottorouter.org/verify',
				interval: 2,
			}),
			openVerification: async (url: string) => {
				opened.push(url);
			},
			poll: async () => polls[Math.min(pollIndex++, polls.length - 1)],
			sleep: async () => {
				clock += 2000;
			},
			now: () => clock,
			timeoutMs: overrides?.timeoutMs ?? 60_000,
			isCancelled: overrides?.isCancelled,
		},
	};
}

describe('OttoRouter device flow lifecycle', () => {
	test('stays pending across polls and resolves connected on approval', async () => {
		const { deps, opened } = makeDeps([
			{ status: 'pending' },
			{ status: 'pending' },
			{ status: 'complete' },
		]);
		const result = await runOttoRouterDeviceFlow(deps);
		expect(result).toEqual({ status: 'connected' });
		expect(opened).toEqual(['https://ottorouter.org/verify']);
	});

	test('poll error resolves to an actionable error, not a throw', async () => {
		const { deps } = makeDeps([
			{ status: 'pending' },
			{ status: 'error', error: 'access_denied' },
		]);
		const result = await runOttoRouterDeviceFlow(deps);
		expect(result).toEqual({ status: 'error', error: 'access_denied' });
	});

	test('expiry resolves to a retryable timeout error', async () => {
		const { deps } = makeDeps([{ status: 'pending' }], { timeoutMs: 5_000 });
		const result = await runOttoRouterDeviceFlow(deps);
		expect(result.status).toBe('error');
		if (result.status === 'error') {
			expect(result.error).toContain('timed out');
			expect(result.error).toContain('Retry');
		}
	});

	test('cancellation stops polling and resolves cancelled', async () => {
		let polls = 0;
		let cancelled = false;
		const result = await runOttoRouterDeviceFlow({
			start: async () => ({
				sessionId: 's',
				verificationUri: 'https://x',
				interval: 2,
			}),
			openVerification: async () => {},
			poll: async () => {
				polls += 1;
				cancelled = true;
				return { status: 'pending' };
			},
			sleep: async () => {},
			isCancelled: () => cancelled,
			timeoutMs: 60_000,
		});
		expect(result).toEqual({ status: 'cancelled' });
		expect(polls).toBe(1);
	});
});

describe('pending state survives account refreshes', () => {
	test('refresh returning disconnected during the flow keeps the waiting view', () => {
		// Browser is open, poll pending; a focus refresh reports configured:false.
		expect(
			resolveMachinesAuthView({
				configured: false,
				initializing: false,
				phase: 'pending',
			}),
		).toBe('waiting');
		// Even a refresh caught mid-initialization cannot flash Connect.
		expect(
			resolveMachinesAuthView({
				configured: false,
				initializing: true,
				phase: 'pending',
			}),
		).toBe('waiting');
	});

	test('approval flips to connected; expiry/error lands on actionable state', () => {
		expect(
			resolveMachinesAuthView({
				configured: true,
				initializing: false,
				phase: 'idle',
			}),
		).toBe('connected');
		expect(
			resolveMachinesAuthView({
				configured: false,
				initializing: false,
				phase: 'error',
			}),
		).toBe('auth-error');
		expect(
			resolveMachinesAuthView({
				configured: false,
				initializing: false,
				phase: 'idle',
			}),
		).toBe('connect');
	});
});

describe('waiting UI wiring (static)', () => {
	test('Machines panel shows persistent waiting state with a single Cancel', async () => {
		const launcher = await readFile(
			'src/components/MachineLauncher.tsx',
			'utf8',
		);
		expect(launcher).toContain('Waiting for authorization...');
		expect(launcher).toContain("authPhase === 'pending'");
		expect(launcher).toContain('onCancelConnect');
		expect(launcher).toContain('Cancel');
		// The Connect panel is suppressed while pending, so no Connect flash.
		expect(launcher).toContain("authPhase !== 'pending' && !configured");

		const control = await readFile(
			'src/components/OttoRouterAccountControl.tsx',
			'utf8',
		);
		expect(control).toContain('runOttoRouterDeviceFlow');
		expect(control).toContain('cancel');
	});
});
