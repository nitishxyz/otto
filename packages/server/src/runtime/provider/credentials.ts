import { AsyncLocalStorage } from 'node:async_hooks';
import {
	getAuth,
	getConfiguredProviderApiKey,
	type OttoConfig,
	type ProviderId,
} from '@ottocode/sdk';

export type RequestCredentials = Readonly<
	Partial<Record<ProviderId, { readonly apiKey: string }>>
>;
const credentials = new AsyncLocalStorage<RequestCredentials>();
const queuedCredentials = new WeakMap<object, RequestCredentials>();

/** Credentials live only in async context and an unserializable queue association. */
export function withRequestCredentials<T>(
	value: RequestCredentials,
	work: () => T,
): T {
	const snapshot = Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.map(([provider, entry]) => [
				provider,
				Object.freeze({ apiKey: entry?.apiKey ?? '' }),
			]),
	);
	return credentials.run(Object.freeze(snapshot), work);
}

export function getRequestApiKey(provider: ProviderId): string | undefined {
	return credentials.getStore()?.[provider]?.apiKey;
}

export async function getRunProviderAuth(
	provider: ProviderId,
	projectRoot: string,
) {
	const key = getRequestApiKey(provider);
	return key !== undefined
		? { type: 'api' as const, key }
		: getAuth(provider, projectRoot);
}

/** Resolves an API key directly instead of exporting stored credentials to process.env. */
export async function getRunProviderApiKey(
	cfg: OttoConfig,
	provider: ProviderId,
): Promise<string | undefined> {
	const auth = await getRunProviderAuth(provider, cfg.projectRoot);
	return auth?.type === 'api'
		? auth.key
		: getConfiguredProviderApiKey(cfg, provider);
}

export function captureQueuedCredentials(job: object): void {
	const value = credentials.getStore();
	if (value) queuedCredentials.set(job, value);
}

/** Runs queued work in its own context, never the preceding job's request context. */
export function withQueuedCredentials<T>(job: object, work: () => T): T {
	const value = queuedCredentials.get(job) ?? Object.freeze({});
	queuedCredentials.delete(job);
	return credentials.run(value, work);
}
