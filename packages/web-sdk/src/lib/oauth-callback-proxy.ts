import { startOAuthCallbackProxy } from '@ottocode/api';
import { getClientDaemonContext, getRuntimeProjectContext } from './config';
import { getBaseUrl } from './api-client/utils';
import { getOwnerSessionToken } from './owner-auth';

export interface LoopbackOAuthFlow {
	authUrl?: string;
	flowId?: string;
	callbackUrl?: string;
	callbackMode?: 'daemon-loopback' | 'client-relay';
}

export interface LoopbackOAuthProxyResult {
	proxied: boolean;
	opened: boolean;
}

function isLoopbackCallback(callbackUrl: string): boolean {
	const url = new URL(callbackUrl);
	return (
		url.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	);
}

/** Starts the local CLI daemon's callback relay for a daemon-owned OAuth flow. */
export async function startLoopbackOAuthProxy(
	flow: LoopbackOAuthFlow,
): Promise<LoopbackOAuthProxyResult> {
	if (flow.callbackMode === 'daemon-loopback') {
		return { proxied: false, opened: false };
	}
	if (!flow.authUrl || !flow.flowId || !flow.callbackUrl) {
		return { proxied: false, opened: false };
	}
	if (!isLoopbackCallback(flow.callbackUrl)) {
		return { proxied: false, opened: false };
	}

	const clientDaemon = getClientDaemonContext();
	if (!clientDaemon) {
		throw new Error(
			'This OAuth server requires a localhost callback. Open it from an Otto client with a local CLI daemon.',
		);
	}
	const runtime = getRuntimeProjectContext();
	const remoteToken = getOwnerSessionToken() ?? runtime?.serverToken;
	if (!remoteToken) {
		throw new Error('The target daemon OAuth credential is unavailable.');
	}

	const response = await startOAuthCallbackProxy({
		baseURL: clientDaemon.baseUrl,
		headers: { 'X-Otto-Server-Token': clientDaemon.token },
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
		throw new Error(
			error.error ?? 'Failed to start the local OAuth callback proxy',
		);
	}
	return {
		proxied: true,
		opened: Boolean(response.data?.opened),
	};
}
