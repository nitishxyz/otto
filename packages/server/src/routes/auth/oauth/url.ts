import { authorize, authorizeXaiDevice, logger, setAuth } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { oauthVerifiers } from '../state.ts';
import {
	errorResponseSchema,
	oauthUrlBodySchema,
	oauthUrlResponseSchema,
	providerParamsSchema,
} from './schemas.ts';

export function registerOAuthUrlRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}/oauth/url',
			tags: ['auth'],
			operationId: 'getOAuthUrl',
			summary: 'Get OAuth authorization URL',
			request: {
				params: providerParamsSchema,
				body: {
					required: false,
					content: { 'application/json': { schema: oauthUrlBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: oauthUrlResponseSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider');
				const body = await c.req
					.json<{ mode?: string }>()
					.catch(() => undefined);
				const mode: 'max' | 'console' =
					body?.mode === 'console' ? 'console' : 'max';

				let url: string;
				let verifier: string;
				let close: (() => void) | undefined;
				let waitForXaiCallback: ((sessionId: string) => void) | undefined;

				if (provider === 'anthropic') {
					const result = await authorize(mode);
					url = result.url;
					verifier = result.verifier;
				} else if (provider === 'xai') {
					const oauthResult = await authorizeXaiDevice();
					url =
						oauthResult.verificationUriComplete || oauthResult.verificationUri;
					verifier = oauthResult.userCode;
					waitForXaiCallback = (sessionId) => {
						void (async () => {
							try {
								const tokens = await oauthResult.waitForTokens();
								await setAuth(
									'xai',
									{
										type: 'oauth',
										refresh: tokens.refresh,
										access: tokens.access,
										expires: tokens.expires,
										idToken: tokens.idToken,
										scopes: tokens.scopes,
									},
									undefined,
									'global',
								);
							} catch (error) {
								if (oauthVerifiers.has(sessionId)) {
									logger.error('xAI device authorization failed', error);
								}
							} finally {
								oauthVerifiers.delete(sessionId);
							}
						})();
					};
				} else if (provider === 'openai') {
					return c.json(
						{
							error:
								'OpenAI OAuth requires localhost callback. Use the redirect flow instead.',
						},
						400,
					);
				} else {
					return c.json(
						{
							error: `OAuth not supported for provider: ${provider}. Copilot uses device flow — use /v1/auth/copilot/device/start instead.`,
						},
						400,
					);
				}

				const sessionId = crypto.randomUUID();
				oauthVerifiers.set(sessionId, {
					verifier,
					provider,
					createdAt: Date.now(),
					callbackUrl: '',
					close,
				});
				waitForXaiCallback?.(sessionId);

				return c.json({ url, sessionId, provider });
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'OAuth initialization failed';
				logger.error('OAuth URL generation failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
