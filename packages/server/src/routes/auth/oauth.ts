import { z } from '@hono/zod-openapi';
import {
	authorize,
	authorizeOpenAI,
	authorizeXai,
	authorizeWeb,
	exchange,
	exchangeOpenAIDeviceCode,
	exchangeOpenAI,
	exchangeOpenAIWeb,
	exchangeXai,
	exchangeWeb,
	logger,
	pollOpenAIDeviceCodeOnce,
	requestOpenAIDeviceCode,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { oauthVerifiers, openAIDeviceSessions } from './state.ts';

const errorResponseSchema = z.object({ error: z.string() });
const htmlResponseSchema = z.string();

const deviceStartResponseSchema = z.object({
	sessionId: z.string(),
	userCode: z.string(),
	verificationUri: z.string(),
	interval: z.number().int(),
});

const devicePollBodySchema = z.object({ sessionId: z.string() });
const devicePollResponseSchema = z.object({
	status: z.enum(['complete', 'pending', 'error']),
	error: z.string().optional(),
});

const providerParamsSchema = z.object({
	provider: z.string().openapi({ param: { name: 'provider', in: 'path' } }),
});

const oauthUrlBodySchema = z.object({
	mode: z.enum(['max', 'console']).optional().default('max'),
});

const oauthUrlResponseSchema = z.object({
	url: z.string(),
	sessionId: z.string(),
	provider: z.string(),
});

const oauthExchangeBodySchema = z.object({
	code: z.string(),
	sessionId: z.string(),
});

const oauthSuccessResponseSchema = z.object({
	success: z.boolean(),
	provider: z.string(),
});

const oauthStartQuerySchema = z.object({
	mode: z
		.enum(['max', 'console'])
		.optional()
		.default('max')
		.openapi({
			param: { name: 'mode', in: 'query' },
		}),
});

const oauthCallbackQuerySchema = z.object({
	code: z
		.string()
		.optional()
		.openapi({ param: { name: 'code', in: 'query' } }),
	fragment: z
		.string()
		.optional()
		.openapi({
			param: { name: 'fragment', in: 'query' },
		}),
});

function parseXaiAuthorizationCode(input: string): string {
	const trimmed = input.trim().replace(/^['"]|['"]$/g, '');
	try {
		const url = new URL(trimmed);
		return url.searchParams.get('code') || trimmed;
	} catch {}

	try {
		const params = new URLSearchParams(
			trimmed.startsWith('?') ? trimmed.slice(1) : trimmed,
		);
		return params.get('code') || trimmed;
	} catch {}

	return trimmed;
}

function closeOAuthCallback(close: (() => void) | undefined) {
	try {
		close?.();
	} catch {}
}

export function registerAuthOAuthRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/openai/device/start',
			tags: ['auth'],
			operationId: 'startOpenAIDeviceFlow',
			summary: 'Start OpenAI device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: deviceStartResponseSchema },
					},
				},
				'500': {
					description: 'Server Error',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const deviceData = await requestOpenAIDeviceCode();
				const sessionId = crypto.randomUUID();
				openAIDeviceSessions.set(sessionId, {
					deviceAuthId: deviceData.deviceAuthId,
					userCode: deviceData.userCode,
					interval: deviceData.interval,
					createdAt: Date.now(),
				});
				return c.json({
					sessionId,
					userCode: deviceData.userCode,
					verificationUri: deviceData.verificationUri,
					interval: deviceData.interval,
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to start OpenAI device flow';
				logger.error('OpenAI device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/openai/device/poll',
			tags: ['auth'],
			operationId: 'pollOpenAIDeviceFlow',
			summary: 'Poll OpenAI device flow for completion',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: devicePollBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: devicePollResponseSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = await c.req.json<{ sessionId: string }>();
				if (!sessionId || !openAIDeviceSessions.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const session = openAIDeviceSessions.get(sessionId);
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollOpenAIDeviceCodeOnce(
					session.deviceAuthId,
					session.userCode,
				);
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					openAIDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}

				const tokens = await exchangeOpenAIDeviceCode(
					result.code,
					result.codeVerifier,
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
				openAIDeviceSessions.delete(sessionId);
				return c.json({ status: 'complete' });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Poll failed';
				logger.error('OpenAI device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);

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
					const oauthResult = await authorizeXai();
					url = oauthResult.url;
					verifier = oauthResult.verifier;
					close = oauthResult.close;
					waitForXaiCallback = (sessionId) => {
						void (async () => {
							try {
								const code = await oauthResult.waitForCallback();
								const tokens = await exchangeXai(code, oauthResult.verifier);
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
									logger.error('xAI OAuth callback failed', error);
								}
							} finally {
								closeOAuthCallback(oauthResult.close);
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
				const provider = c.req.param('provider');
				const mode = c.req.query('mode') || 'max';
				const host = c.req.header('host') || 'localhost:3000';
				const protocol = c.req.header('x-forwarded-proto') || 'http';

				let url: string;
				let verifier: string;
				let callbackUrl = '';

				if (provider === 'anthropic') {
					callbackUrl = `${protocol}://${host}/v1/auth/${provider}/oauth/callback`;
					const result = authorizeWeb(mode as 'max' | 'console', callbackUrl);
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
					const oauthResult = await authorizeXai();
					void (async () => {
						try {
							const code = await oauthResult.waitForCallback();
							oauthResult.close();
							const tokens = await exchangeXai(code, oauthResult.verifier);
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
							logger.error('xAI OAuth callback failed', error);
							oauthResult.close();
						}
					})();

					return c.redirect(oauthResult.url);
				} else {
					return c.json(
						{ error: 'OAuth not supported for this provider' },
						400,
					);
				}

				const sessionId = crypto.randomUUID();
				oauthVerifiers.set(sessionId, {
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
					return c.html(
						'<html><body><h1>Session expired</h1><p>Please close this window and try again.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>',
					);
				}

				const callbackEntry = oauthVerifiers.get(sessionId);
				if (!callbackEntry) {
					return c.html(
						'<html><body><h1>Session expired</h1><p>Please close this window and try again.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>',
					);
				}
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

				return c.html(`
				<html>
					<head>
						<title>Connected!</title>
						<style>
							body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
							.container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
							.checkmark { font-size: 4rem; margin-bottom: 1rem; }
							h1 { margin: 0 0 0.5rem 0; }
							p { margin: 0; opacity: 0.9; }
						</style>
					</head>
					<body>
						<div class="container">
							<div class="checkmark">✓</div>
							<h1>Connected!</h1>
							<p>You can close this window.</p>
						</div>
						<script>
							if (window.opener) window.opener.postMessage({ type: 'oauth-success', provider: '${provider}' }, '*');
							setTimeout(() => window.close(), 1500);
						</script>
					</body>
				</html>
			`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Authentication failed';
				logger.error('OAuth callback failed', error);
				return c.html(`
				<html>
					<head>
						<title>Error</title>
						<style>
							body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; }
							.container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
							.icon { font-size: 4rem; margin-bottom: 1rem; }
							h1 { margin: 0 0 0.5rem 0; }
							p { margin: 0; opacity: 0.9; }
						</style>
					</head>
					<body>
						<div class="container">
							<div class="icon">✗</div>
							<h1>Error</h1>
							<p>${message}</p>
						</div>
						<script>
							if (window.opener) window.opener.postMessage({ type: 'oauth-error', provider: '${c.req.param('provider')}', error: '${message}' }, '*');
							setTimeout(() => window.close(), 3000);
						</script>
					</body>
				</html>
			`);
			}
		},
	);
}
