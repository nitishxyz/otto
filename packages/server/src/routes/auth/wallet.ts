import { z } from '@hono/zod-openapi';
import {
	ensureOttoRouterWallet,
	getOttoRouterWallet,
	importWallet,
	logger,
	setAuth,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const setupWalletResponseSchema = z.object({
	success: z.boolean(),
	publicKey: z.string(),
	isNew: z.boolean(),
});

const importWalletBodySchema = z.object({
	privateKey: z.string(),
});

const importWalletResponseSchema = z.object({
	success: z.boolean(),
	publicKey: z.string(),
});

const exportWalletResponseSchema = z.object({
	success: z.boolean(),
	publicKey: z.string(),
	privateKey: z.string(),
});

const walletErrorSchema = z.object({
	error: z.string(),
});

export function registerAuthWalletRoutes(app: Hono) {
	zodOpenApiRoute(
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
						'application/json': { schema: setupWalletResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/auth/ottorouter/import',
			tags: ['auth'],
			operationId: 'importOttoRouterWallet',
			summary: 'Import OttoRouter wallet from private key',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: importWalletBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: importWalletResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: walletErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const { privateKey } = importWalletBodySchema.parse(await c.req.json());

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

	zodOpenApiRoute(
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
						'application/json': { schema: exportWalletResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: walletErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
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
