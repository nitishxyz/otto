import { exchangeOpenAIWeb, exchangeWeb, logger, setAuth } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { oauthVerifiers } from '../state.ts';
import {
	htmlResponseSchema,
	oauthCallbackQuerySchema,
	providerParamsSchema,
} from './schemas.ts';
import { oauthErrorHtml, oauthExpiredHtml, oauthSuccessHtml } from './utils.ts';

export function registerOAuthCallbackRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/{provider}/oauth/callback',
			tags: ['auth'],
			operationId: 'oauthCallback',
			summary: 'OAuth callback handler',
			request: {
				params: providerParamsSchema,
				query: oauthCallbackQuerySchema,
			},
			responses: {
				'200': {
					description: 'HTML response',
					content: { 'text/html': { schema: htmlResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider');
				const code = c.req.query('code');
				const fragment = c.req.query('fragment');

				const cookies = c.req.header('Cookie') || '';
				const sessionMatch = cookies.match(/oauth_session=([^;]+)/);
				const sessionId = sessionMatch?.[1];

				if (!sessionId || !oauthVerifiers.has(sessionId)) {
					return c.html(oauthExpiredHtml());
				}

				const callbackEntry = oauthVerifiers.get(sessionId);
				if (!callbackEntry) return c.html(oauthExpiredHtml());
				const { verifier, callbackUrl } = callbackEntry;
				oauthVerifiers.delete(sessionId);

				if (provider === 'anthropic') {
					const fullCode = fragment ? `${code}#${fragment}` : (code ?? '');
					const tokens = await exchangeWeb(fullCode, verifier, callbackUrl);

					await setAuth(
						'anthropic',
						{
							type: 'oauth',
							refresh: tokens.refresh,
							access: tokens.access,
							expires: tokens.expires,
						},
						undefined,
						'global',
					);
				} else if (provider === 'openai') {
					const tokens = await exchangeOpenAIWeb(
						code ?? '',
						verifier,
						callbackUrl,
					);

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
				}

				return c.html(oauthSuccessHtml(provider));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Authentication failed';
				logger.error('OAuth callback failed', error);
				return c.html(oauthErrorHtml(c.req.param('provider'), message));
			}
		},
	);
}
