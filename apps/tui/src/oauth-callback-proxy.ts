import { startOAuthCallbackProxy } from '@ottocode/api';
import { getBaseUrl, getProjectContext } from './api.ts';
import { discoverLocalDaemon } from './daemon.ts';

interface OAuthFlow {
	authUrl?: string;
	flowId?: string;
	callbackUrl?: string;
	callbackMode?: 'daemon-loopback' | 'client-relay';
}

function isLoopbackCallback(callbackUrl: string): boolean {
	const url = new URL(callbackUrl);
	return (
		url.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	);
}

export async function startLocalOAuthCallbackProxy(
	flow: OAuthFlow,
): Promise<boolean> {
	if (flow.callbackMode === 'daemon-loopback') return false;
	if (!flow.authUrl || !flow.flowId || !flow.callbackUrl) return false;
	if (!isLoopbackCallback(flow.callbackUrl)) return false;

	const localDaemon = await discoverLocalDaemon();
	if (!localDaemon) {
		throw new Error('Local Otto daemon is unavailable for the OAuth callback.');
	}
	const remoteToken = getProjectContext().authToken;
	if (!remoteToken)
		throw new Error('Target daemon authorization is unavailable.');

	const response = await startOAuthCallbackProxy({
		baseURL: localDaemon.baseUrl,
		headers: { 'X-Otto-Server-Token': localDaemon.token },
		body: {
			authorizationUrl: flow.authUrl,
			callbackUrl: flow.callbackUrl,
			remoteBaseUrl: getBaseUrl(),
			remoteFlowId: flow.flowId,
			remoteToken,
		},
	});
	if (response.error) {
		const error = response.error as { error?: string };
		throw new Error(error.error ?? 'Failed to start OAuth callback proxy');
	}
	return Boolean(response.data?.opened);
}
