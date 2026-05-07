import type { Hono } from 'hono';
import {
	ensureOttoRouterWallet,
	getOttoRouterWallet,
	importWallet,
	setAuth,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

export function registerAuthWalletRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/ottorouter/setup',
			tags: ['auth'],
			operationId: 'setupOttoRouterWallet',
			summary: 'Setup or ensure OttoRouter wallet',
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
									publicKey: {
										type: 'string',
									},
									isNew: {
										type: 'boolean',
									},
								},
								required: ['success', 'publicKey', 'isNew'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = process.cwd();
				const existing = await getOttoRouterWallet(projectRoot);
				const wallet = await ensureOttoRouterWallet(projectRoot);

				return c.json({
					success: true,
					publicKey: wallet.publicKey,
					isNew: !existing,
				});
			} catch (error) {
				logger.error('Failed to setup OttoRouter wallet', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/ottorouter/import',
			tags: ['auth'],
			operationId: 'importOttoRouterWallet',
			summary: 'Import OttoRouter wallet from private key',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								privateKey: {
									type: 'string',
								},
							},
							required: ['privateKey'],
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
									publicKey: {
										type: 'string',
									},
								},
								required: ['success', 'publicKey'],
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
				const { privateKey } = await c.req.json<{ privateKey: string }>();

				if (!privateKey) {
					return c.json({ error: 'Private key required' }, 400);
				}

				try {
					const wallet = importWallet(privateKey);
					await setAuth(
						'ottorouter',
						{ type: 'wallet', secret: privateKey },
						undefined,
						'global',
					);

					return c.json({
						success: true,
						publicKey: wallet.publicKey,
					});
				} catch {
					return c.json({ error: 'Invalid private key format' }, 400);
				}
			} catch (error) {
				logger.error('Failed to import OttoRouter wallet', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/ottorouter/export',
			tags: ['auth'],
			operationId: 'exportOttoRouterWallet',
			summary: 'Export OttoRouter wallet private key',
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
									publicKey: {
										type: 'string',
									},
									privateKey: {
										type: 'string',
									},
								},
								required: ['success', 'publicKey', 'privateKey'],
							},
						},
					},
				},
				'404': {
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
				const projectRoot = process.cwd();
				const wallet = await getOttoRouterWallet(projectRoot);

				if (!wallet) {
					return c.json({ error: 'OttoRouter wallet not configured' }, 404);
				}

				return c.json({
					success: true,
					publicKey: wallet.publicKey,
					privateKey: wallet.privateKey,
				});
			} catch (error) {
				logger.error('Failed to export OttoRouter wallet', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
