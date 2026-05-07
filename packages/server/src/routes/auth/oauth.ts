import type { Hono } from 'hono';
import {
	authorize,
	authorizeOpenAIWeb,
	authorizeWeb,
	exchange,
	exchangeOpenAIWeb,
	exchangeWeb,
	setAuth,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { oauthVerifiers } from './state.ts';

export function registerAuthOAuthRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}/oauth/url',
			tags: ['auth'],
			operationId: 'getOAuthUrl',
			summary: 'Get OAuth authorization URL',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								mode: {
									type: 'string',
									enum: ['max', 'console'],
									default: 'max',
								},
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									url: {
										type: 'string',
									},
									sessionId: {
										type: 'string',
									},
									provider: {
										type: 'string',
									},
								},
								required: ['url', 'sessionId', 'provider'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
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

				if (provider === 'anthropic') {
					const result = await authorize(mode);
					url = result.url;
					verifier = result.verifier;
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
				});

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

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/{provider}/oauth/exchange',
			tags: ['auth'],
			operationId: 'exchangeOAuthCode',
			summary: 'Exchange OAuth code for tokens',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								code: {
									type: 'string',
								},
								sessionId: {
									type: 'string',
								},
							},
							required: ['code', 'sessionId'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									provider: {
										type: 'string',
									},
								},
								required: ['success', 'provider'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/{provider}/oauth/start',
			tags: ['auth'],
			operationId: 'startOAuth',
			summary: 'Start OAuth flow with redirect',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'mode',
					required: false,
					schema: {
						type: 'string',
						enum: ['max', 'console'],
						default: 'max',
					},
				},
			],
			responses: {
				'302': {
					description: 'Redirect to OAuth provider',
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
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
					callbackUrl = `${protocol}://${host}/v1/auth/${provider}/oauth/callback`;
					const result = authorizeOpenAIWeb(callbackUrl);
					url = result.url;
					verifier = result.verifier;
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/{provider}/oauth/callback',
			tags: ['auth'],
			operationId: 'oauthCallback',
			summary: 'OAuth callback handler',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'code',
					required: false,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'fragment',
					required: false,
					schema: {
						type: 'string',
					},
				},
			],
			responses: {
				'200': {
					description: 'HTML response',
					content: {
						'text/html': {
							schema: {
								type: 'string',
							},
						},
					},
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
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
								color: white;
							}
							.container {
								text-align: center;
								padding: 2rem;
								background: rgba(255,255,255,0.1);
								border-radius: 16px;
								backdrop-filter: blur(10px);
							}
							.checkmark {
								font-size: 4rem;
								margin-bottom: 1rem;
							}
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
							if (window.opener) {
								window.opener.postMessage({ type: 'oauth-success', provider: '${provider}' }, '*');
							}
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
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
								color: white;
							}
							.container {
								text-align: center;
								padding: 2rem;
								background: rgba(255,255,255,0.1);
								border-radius: 16px;
								backdrop-filter: blur(10px);
							}
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
							if (window.opener) {
								window.opener.postMessage({ type: 'oauth-error', provider: '${c.req.param('provider')}', error: '${message}' }, '*');
							}
							setTimeout(() => window.close(), 3000);
						</script>
					</body>
				</html>
			`);
			}
		},
	);
}
