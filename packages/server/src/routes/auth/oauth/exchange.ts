import { exchange, exchangeXai, logger, setAuth } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { oauthVerifiers } from '../state.ts';
import {
	errorResponseSchema,
	oauthExchangeBodySchema,
	oauthSuccessResponseSchema,
	providerParamsSchema,
} from './schemas.ts';
import { closeOAuthCallback, parseXaiAuthorizationCode } from './utils.ts';

export function registerOAuthExchangeRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}/oauth/exchange',
			tags: ['auth'],
			operationId: 'exchangeOAuthCode',
			summary: 'Exchange OAuth code for tokens',
			request: {
				params: providerParamsSchema,
				body: {
					required: true,
					content: { 'application/json': { schema: oauthExchangeBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: oauthSuccessResponseSchema },
					},
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
				const { code, sessionId } = await c.req.json<{
					code: string;
					sessionId: string;
				}>();

				if (!code || !sessionId) {
					return c.json({ error: 'Code and sessionId required' }, 400);
				}

				if (!oauthVerifiers.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}

				const verifierEntry = oauthVerifiers.get(sessionId);
				if (!verifierEntry) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const { verifier } = verifierEntry;
				closeOAuthCallback(verifierEntry.close);
				oauthVerifiers.delete(sessionId);

				if (provider === 'anthropic') {
					const tokens = await exchange(code, verifier);
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
					return c.json({ error: 'Use redirect flow for OpenAI' }, 400);
				} else if (provider === 'xai') {
					const tokens = await exchangeXai(
						parseXaiAuthorizationCode(code),
						verifier,
					);
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
				} else {
					return c.json({ error: 'Unknown provider' }, 400);
				}

				return c.json({ success: true, provider });
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Token exchange failed';
				logger.error('OAuth exchange failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
