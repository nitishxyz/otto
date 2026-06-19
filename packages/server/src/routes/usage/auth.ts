import type { getAllAuth, ProviderId } from '@ottocode/sdk';
import type { AuthBucket, AuthKind } from './types.ts';

export function resolveAuthKind(
	provider: string,
	currentAuth: Awaited<ReturnType<typeof getAllAuth>>,
): AuthKind {
	// OttoRouter is its own subscription/credits-based service.
	if (provider === 'ottorouter') return 'subscription';
	// Copilot is subscription-based (GitHub Copilot).
	if (provider === 'copilot') return 'subscription';

	const auth = currentAuth[provider as ProviderId];
	if (!auth) return 'unknown';
	if (auth.type === 'oauth') return 'oauth';
	if (auth.type === 'api') return 'api';
	if ((auth as { type?: string }).type === 'wallet') return 'wallet';
	return 'unknown';
}

export function bucketAuth(kind: AuthKind): AuthBucket {
	if (kind === 'oauth') return 'oauth';
	if (kind === 'subscription' || kind === 'wallet') return 'subscription';
	return 'api';
}
