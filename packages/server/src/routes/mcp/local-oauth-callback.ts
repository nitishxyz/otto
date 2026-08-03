import { startOAuthLoopbackCallback } from '../oauth-callback-proxy.ts';
import { completeMCPAuthFlow } from './service/auth.ts';

/** Receives an MCP OAuth callback directly on the target local daemon. */
export async function startLocalMCPAuthCallback(options: {
	flowId: string;
	callbackUrl: string;
}): Promise<void> {
	await startOAuthLoopbackCallback({
		callbackUrl: options.callbackUrl,
		successMessage: 'This machine is configured. You can close this window.',
		complete: async (callback) => {
			const result = await completeMCPAuthFlow({
				flowId: options.flowId,
				...callback,
			});
			if (!result.ok) throw new Error(result.body.error);
		},
	});
}

/** Selects direct local receipt or client relay for an MCP OAuth response. */
export async function configureMCPAuthCallback<T extends object>(
	body: T,
	tunneled: boolean,
): Promise<T & { callbackMode?: string }> {
	const callback = body as T & { flowId?: string; callbackUrl?: string };
	if (!callback.flowId || !callback.callbackUrl) return body;
	if (tunneled) return { ...body, callbackMode: 'client-relay' };
	await startLocalMCPAuthCallback({
		flowId: callback.flowId,
		callbackUrl: callback.callbackUrl,
	});
	return { ...body, callbackMode: 'daemon-loopback' };
}
