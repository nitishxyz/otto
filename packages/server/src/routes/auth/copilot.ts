import type { Hono } from 'hono';
import {
	authorizeCopilot,
	getAuth,
	pollForCopilotTokenOnce,
	readEnvKey,
	setAuth,
} from '@ottocode/sdk';
import { execFileSync } from 'node:child_process';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import {
	detectOAuthOrgRestriction,
	fetchCopilotModels,
	getGhImportCapability,
} from './service.ts';
import { copilotDeviceSessions } from './state.ts';

export function registerAuthCopilotRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/device/start',
			tags: ['auth'],
			operationId: 'startCopilotDeviceFlow',
			summary: 'Start Copilot device flow authentication',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									sessionId: {
										type: 'string',
									},
									userCode: {
										type: 'string',
									},
									verificationUri: {
										type: 'string',
									},
									interval: {
										type: 'integer',
									},
								},
								required: [
									'sessionId',
									'userCode',
									'verificationUri',
									'interval',
								],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const deviceData = await authorizeCopilot();
				const sessionId = crypto.randomUUID();
				copilotDeviceSessions.set(sessionId, {
					deviceCode: deviceData.deviceCode,
					interval: deviceData.interval,
					provider: 'copilot',
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
						: 'Failed to start Copilot device flow';
				logger.error('Copilot device flow start failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/device/poll',
			tags: ['auth'],
			operationId: 'pollCopilotDeviceFlow',
			summary: 'Poll Copilot device flow for completion',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								sessionId: {
									type: 'string',
								},
							},
							required: ['sessionId'],
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
									status: {
										type: 'string',
										enum: ['complete', 'pending', 'error'],
									},
									error: {
										type: 'string',
									},
								},
								required: ['status'],
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
				const { sessionId } = await c.req.json<{ sessionId: string }>();
				if (!sessionId || !copilotDeviceSessions.has(sessionId)) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const session = copilotDeviceSessions.get(sessionId);
				if (!session) {
					return c.json({ error: 'Session expired or invalid' }, 400);
				}
				const result = await pollForCopilotTokenOnce(session.deviceCode);
				if (result.status === 'complete') {
					copilotDeviceSessions.delete(sessionId);
					await setAuth(
						'copilot',
						{
							type: 'oauth',
							refresh: result.accessToken,
							access: result.accessToken,
							expires: 0,
						},
						undefined,
						'global',
					);
					return c.json({ status: 'complete' });
				}
				if (result.status === 'pending') {
					return c.json({ status: 'pending' });
				}
				if (result.status === 'error') {
					copilotDeviceSessions.delete(sessionId);
					return c.json({ status: 'error', error: result.error });
				}
				return c.json({ status: 'pending' });
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Poll failed';
				logger.error('Copilot device poll failed', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/copilot/methods',
			tags: ['auth'],
			operationId: 'getCopilotAuthMethods',
			summary: 'Get available Copilot auth methods',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									oauth: {
										type: 'boolean',
									},
									token: {
										type: 'boolean',
									},
									ghImport: {
										type: 'object',
										properties: {
											available: {
												type: 'boolean',
											},
											authenticated: {
												type: 'boolean',
											},
											reason: {
												type: 'string',
											},
										},
										required: ['available', 'authenticated'],
									},
								},
								required: ['oauth', 'token', 'ghImport'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			const ghImport = getGhImportCapability();
			return c.json({
				oauth: true,
				token: true,
				ghImport,
			});
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/token',
			tags: ['auth'],
			operationId: 'saveCopilotToken',
			summary: 'Save Copilot token after validating model access',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								token: {
									type: 'string',
								},
							},
							required: ['token'],
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
									source: {
										type: 'string',
										enum: ['token'],
									},
									modelCount: {
										type: 'integer',
									},
									hasGpt52Codex: {
										type: 'boolean',
									},
									sampleModels: {
										type: 'array',
										items: {
											type: 'string',
										},
									},
								},
								required: [
									'success',
									'provider',
									'source',
									'modelCount',
									'hasGpt52Codex',
									'sampleModels',
								],
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
				const { token } = await c.req.json<{ token: string }>();
				const sanitized = token?.trim();
				if (!sanitized) {
					return c.json({ error: 'Copilot token is required' }, 400);
				}

				const modelsResult = await fetchCopilotModels(sanitized);
				if (!modelsResult.ok) {
					return c.json(
						{
							error: `Invalid Copilot token: ${modelsResult.message}`,
						},
						400,
					);
				}

				await setAuth(
					'copilot',
					{
						type: 'oauth',
						refresh: sanitized,
						access: sanitized,
						expires: 0,
					},
					undefined,
					'global',
				);

				const models = Array.from(modelsResult.models).sort();
				return c.json({
					success: true,
					provider: 'copilot',
					source: 'token',
					modelCount: models.length,
					hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
					sampleModels: models.slice(0, 25),
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to save Copilot token';
				logger.error('Failed to save Copilot token', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/copilot/gh/import',
			tags: ['auth'],
			operationId: 'importCopilotTokenFromGh',
			summary: 'Import Copilot token from GitHub CLI (gh)',
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
									source: {
										type: 'string',
										enum: ['gh'],
									},
									modelCount: {
										type: 'integer',
									},
									hasGpt52Codex: {
										type: 'boolean',
									},
									sampleModels: {
										type: 'array',
										items: {
											type: 'string',
										},
									},
								},
								required: [
									'success',
									'provider',
									'source',
									'modelCount',
									'hasGpt52Codex',
									'sampleModels',
								],
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
				const ghImport = getGhImportCapability();
				if (!ghImport.available) {
					return c.json(
						{
							error: ghImport.reason || 'GitHub CLI is not available',
						},
						400,
					);
				}
				if (!ghImport.authenticated) {
					return c.json(
						{
							error: ghImport.reason || 'GitHub CLI is not authenticated',
						},
						400,
					);
				}

				const ghToken = execFileSync('gh', ['auth', 'token'], {
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				}).trim();
				if (!ghToken) {
					return c.json({ error: 'GitHub CLI returned an empty token' }, 400);
				}

				const modelsResult = await fetchCopilotModels(ghToken);
				if (!modelsResult.ok) {
					return c.json(
						{
							error: `Imported gh token is not valid for Copilot: ${modelsResult.message}`,
						},
						400,
					);
				}

				await setAuth(
					'copilot',
					{
						type: 'oauth',
						refresh: ghToken,
						access: ghToken,
						expires: 0,
					},
					undefined,
					'global',
				);

				const models = Array.from(modelsResult.models).sort();
				return c.json({
					success: true,
					provider: 'copilot',
					source: 'gh',
					modelCount: models.length,
					hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
					sampleModels: models.slice(0, 25),
				});
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to import GitHub CLI token';
				logger.error('Failed to import Copilot token from GitHub CLI', error);
				return c.json({ error: message }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/copilot/diagnostics',
			tags: ['auth'],
			operationId: 'getCopilotDiagnostics',
			summary: 'Get Copilot token diagnostics and model visibility',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									tokenSources: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												source: {
													type: 'string',
													enum: ['env', 'stored'],
												},
												configured: {
													type: 'boolean',
												},
												modelCount: {
													type: 'integer',
												},
												hasGpt52Codex: {
													type: 'boolean',
												},
												sampleModels: {
													type: 'array',
													items: {
														type: 'string',
													},
												},
												restrictedByOrgPolicy: {
													type: 'boolean',
												},
												restrictedOrg: {
													type: 'string',
												},
												restrictionMessage: {
													type: 'string',
												},
												error: {
													type: 'string',
												},
											},
											required: ['source', 'configured'],
										},
									},
									methods: {
										type: 'object',
										properties: {
											oauth: {
												type: 'boolean',
											},
											token: {
												type: 'boolean',
											},
											ghImport: {
												type: 'object',
												properties: {
													available: {
														type: 'boolean',
													},
													authenticated: {
														type: 'boolean',
													},
													reason: {
														type: 'string',
													},
												},
												required: ['available', 'authenticated'],
											},
										},
										required: ['oauth', 'token', 'ghImport'],
									},
								},
								required: ['tokenSources', 'methods'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = process.cwd();
				const entries: Array<{
					source: 'env' | 'stored';
					configured: boolean;
					modelCount?: number;
					hasGpt52Codex?: boolean;
					sampleModels?: string[];
					restrictedByOrgPolicy?: boolean;
					restrictedOrg?: string;
					restrictionMessage?: string;
					error?: string;
				}> = [];

				const envToken = readEnvKey('copilot');
				if (envToken) {
					const modelsResult = await fetchCopilotModels(envToken);
					if (modelsResult.ok) {
						const models = Array.from(modelsResult.models).sort();
						entries.push({
							source: 'env',
							configured: true,
							modelCount: models.length,
							hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
							sampleModels: models.slice(0, 25),
						});
					} else {
						entries.push({
							source: 'env',
							configured: true,
							error: modelsResult.message,
						});
					}
				} else {
					entries.push({ source: 'env', configured: false });
				}

				const storedAuth = await getAuth('copilot', projectRoot);
				if (storedAuth?.type === 'oauth') {
					const modelsResult = await fetchCopilotModels(storedAuth.refresh);
					const restriction = await detectOAuthOrgRestriction(
						storedAuth.refresh,
					);
					if (modelsResult.ok) {
						const models = Array.from(modelsResult.models).sort();
						entries.push({
							source: 'stored',
							configured: true,
							modelCount: models.length,
							hasGpt52Codex: modelsResult.models.has('gpt-5.2-codex'),
							sampleModels: models.slice(0, 25),
							restrictedByOrgPolicy: restriction.restricted,
							restrictedOrg: restriction.org,
							restrictionMessage: restriction.message,
						});
					} else {
						entries.push({
							source: 'stored',
							configured: true,
							error: modelsResult.message,
							restrictedByOrgPolicy: restriction.restricted,
							restrictedOrg: restriction.org,
							restrictionMessage: restriction.message,
						});
					}
				} else {
					entries.push({ source: 'stored', configured: false });
				}

				return c.json({
					tokenSources: entries,
					methods: {
						oauth: true,
						token: true,
						ghImport: getGhImportCapability(),
					},
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Failed to inspect Copilot';
				logger.error('Failed to build Copilot diagnostics', error);
				return c.json({ error: message }, 500);
			}
		},
	);
}
