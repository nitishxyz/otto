import { APIError } from '../../../runtime/errors/api-error.ts';
import type { ExpiringSessionStore } from '../expiring-session-store.ts';

export interface DeviceStartResponse {
	sessionId: string;
	userCode: string;
	verificationUri: string;
	interval: number;
}

export type DevicePollResult<T> =
	| { status: 'pending' }
	| { status: 'error'; error: string }
	| { status: 'complete'; value: T };

export interface DeviceFlowAdapter<TSession, TComplete> {
	start(): Promise<{
		session: TSession;
		userCode: string;
		verificationUri: string;
		interval: number;
	}>;
	poll(session: TSession): Promise<DevicePollResult<TComplete>>;
	complete(value: TComplete): Promise<void>;
}

export async function startDeviceFlow<TSession, TComplete>(
	store: ExpiringSessionStore<TSession>,
	adapter: DeviceFlowAdapter<TSession, TComplete>,
	createId: () => string = () => crypto.randomUUID(),
): Promise<DeviceStartResponse> {
	const started = await adapter.start();
	const sessionId = createId();
	store.create(sessionId, started.session);
	return {
		sessionId,
		userCode: started.userCode,
		verificationUri: started.verificationUri,
		interval: started.interval,
	};
}

export async function pollDeviceFlow<TSession, TComplete>(
	store: ExpiringSessionStore<TSession>,
	adapter: DeviceFlowAdapter<TSession, TComplete>,
	sessionId: string,
): Promise<
	{ status: 'pending' | 'complete' } | { status: 'error'; error: string }
> {
	const session = store.get(sessionId);
	if (!session) throw new APIError('Session expired or invalid', 400);
	const result = await adapter.poll(session);
	if (result.status === 'pending') return { status: 'pending' };
	if (result.status === 'error') {
		store.delete(sessionId);
		return result;
	}
	await adapter.complete(result.value);
	store.delete(sessionId);
	return { status: 'complete' };
}
