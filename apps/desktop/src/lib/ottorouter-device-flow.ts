export interface DeviceFlowDeps {
	start: () => Promise<{
		sessionId: string;
		verificationUri: string;
		interval: number;
	}>;
	openVerification: (url: string) => Promise<void>;
	poll: (
		sessionId: string,
	) => Promise<{ status: 'pending' | 'complete' | 'error'; error?: string }>;
	sleep?: (ms: number) => Promise<void>;
	/** Returns true when the user cancelled the flow. Checked between polls. */
	isCancelled?: () => boolean;
	now?: () => number;
	timeoutMs?: number;
}

export type DeviceFlowResult =
	| { status: 'connected' }
	| { status: 'cancelled' }
	| { status: 'error'; error: string };

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * OttoRouter OAuth device flow: opens the verification page, then polls the
 * daemon until approval, error, expiry, or cancellation. Pure and
 * dependency-injected so the pending-state lifecycle is testable — callers
 * hold a persistent `waiting` UI until this resolves and must not fall back
 * to signed-out between polls.
 */
export async function runOttoRouterDeviceFlow(
	deps: DeviceFlowDeps,
): Promise<DeviceFlowResult> {
	const sleep =
		deps.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const now = deps.now ?? Date.now;
	const isCancelled = deps.isCancelled ?? (() => false);
	try {
		const flow = await deps.start();
		await deps.openVerification(flow.verificationUri);
		const deadline = now() + (deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		while (now() < deadline) {
			if (isCancelled()) return { status: 'cancelled' };
			await sleep(Math.max(flow.interval, 2) * 1000);
			if (isCancelled()) return { status: 'cancelled' };
			const result = await deps.poll(flow.sessionId);
			if (result.status === 'complete') return { status: 'connected' };
			if (result.status === 'error') {
				return {
					status: 'error',
					error: result.error || 'OttoRouter sign-in failed.',
				};
			}
		}
		return {
			status: 'error',
			error: 'OttoRouter sign-in timed out. Retry to start a new sign-in.',
		};
	} catch (cause) {
		return { status: 'error', error: String(cause) };
	}
}
