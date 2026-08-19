import {
	authorizeOpenAI,
	authorizeWeb,
	authorizeXaiDevice,
	exchangeOpenAI,
	logger,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { oauthVerifiers } from '../state.ts';
import {
	errorResponseSchema,
	oauthStartQuerySchema,
	providerParamsSchema,
} from './schemas.ts';

export function registerOAuthStartRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/{provider}/oauth/start',
			tags: ['auth'],
			operationId: 'startOAuth',
			summary: 'Start OAuth flow with redirect',
			request: {
				params: providerParamsSchema,
				query: oauthStartQuerySchema,
			},
			responses: {
				'302': { description: 'Redirect to OAuth provider' },
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { provider } = c.req.valid('param');
				const { mode } = c.req.valid('query');
				const host = c.req.header('host') || 'localhost:3000';
				const protocol = c.req.header('x-forwarded-proto') || 'http';

				let url: string;
				let verifier: string;
				let callbackUrl = '';

				if (provider === 'anthropic') {
					callbackUrl = `${protocol}://${host}/v1/auth/${provider}/oauth/callback`;
					const result = authorizeWeb(mode, callbackUrl);
					url = result.url;
					verifier = result.verifier;
				} else if (provider === 'openai') {
					const oauthResult = await authorizeOpenAI();
					void (async () => {
						try {
							const code = await oauthResult.waitForCallback();
							oauthResult.close();
							const tokens = await exchangeOpenAI(code, oauthResult.verifier);
							await setAuth(
								'openai',
								{
									type: 'oauth',
									refresh: tokens.refresh,
									access: tokens.access,
									expires: tokens.expires,
									accountId: tokens.accountId,
									idToken: tokens.idToken,
								},
								undefined,
								'global',
							);
						} catch (error) {
							logger.error('OpenAI OAuth callback failed', error);
							oauthResult.close();
						}
					})();

					return c.redirect(oauthResult.url);
				} else if (provider === 'xai') {
					const oauthResult = await authorizeXaiDevice();
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
							logger.error('xAI device authorization failed', error);
						}
					})();

					return c.redirect(
						oauthResult.verificationUriComplete || oauthResult.verificationUri,
					);
				} else {
					return c.json(
						{ error: 'OAuth not supported for this provider' },
						400,
					);
				}

				const sessionId = crypto.randomUUID();
				oauthVerifiers.create(sessionId, {
					verifier,
					provider,
					createdAt: Date.now(),
					callbackUrl,
				});

				c.header(
					'Set-Cookie',
					`oauth_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
				);

				return c.redirect(url);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'OAuth initialization failed';
				logger.error('OAuth start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
