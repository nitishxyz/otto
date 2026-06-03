import { z } from '@hono/zod-openapi';
import {
	catalog,
	getAllAuth,
	getOnboardingComplete,
	getOttoRouterWallet,
	loadConfig,
	logger,
	type ProviderId,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getProviderDetails } from '../config/utils.ts';
import { getGhImportCapability } from './service.ts';

const authStatusProviderSchema = z.object({
	configured: z.boolean(),
	type: z.enum(['api', 'oauth', 'wallet']).optional(),
	label: z.string(),
	supportsOAuth: z.boolean(),
	supportsToken: z.boolean().optional(),
	supportsGhImport: z.boolean().optional(),
	custom: z.boolean().optional(),
	modelCount: z.number().int(),
	costRange: z
		.object({
			min: z.number(),
			max: z.number(),
		})
		.optional(),
});

const authStatusResponseSchema = z.object({
	onboardingComplete: z.boolean(),
	ottorouter: z.object({
		configured: z.boolean(),
		publicKey: z.string().optional(),
	}),
	providers: z.record(z.string(), authStatusProviderSchema),
	defaults: z.record(z.string(), z.unknown()).optional(),
});

export function registerAuthStatusRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/auth/status',
			tags: ['auth'],
			operationId: 'getAuthStatus',
			summary: 'Get auth status for all providers',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: authStatusResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = process.cwd();
				const auth = await getAllAuth(projectRoot);
				const cfg = await loadConfig(projectRoot);
				const onboardingComplete = await getOnboardingComplete(projectRoot);
				const ottorouterWallet = await getOttoRouterWallet(projectRoot);
				const ghImportCapability = getGhImportCapability();

				const providers: Record<
					string,
					{
						configured: boolean;
						type?: 'api' | 'oauth' | 'wallet';
						label: string;
						supportsOAuth: boolean;
						supportsToken?: boolean;
						supportsGhImport?: boolean;
						custom?: boolean;
						modelCount: number;
						costRange?: { min: number; max: number };
					}
				> = {};

				for (const [id, entry] of Object.entries(catalog)) {
					const providerAuth = auth[id as ProviderId];
					const models = entry.models || [];
					const costs = models
						.map((m) => m.cost?.input)
						.filter((c): c is number => c !== undefined);

					providers[id] = {
						configured: !!providerAuth,
						type: providerAuth?.type,
						label: entry.label || id,
						supportsOAuth:
							id === 'anthropic' || id === 'openai' || id === 'copilot',
						supportsToken: id === 'copilot',
						supportsGhImport:
							id === 'copilot' ? ghImportCapability.available : false,
						modelCount: models.length,
						costRange:
							costs.length > 0
								? {
										min: Math.min(...costs),
										max: Math.max(...costs),
									}
								: undefined,
					};
				}

				const providerDetails = await getProviderDetails(undefined, cfg);
				for (const detail of providerDetails) {
					if (!detail.custom || providers[detail.id]) continue;
					providers[detail.id] = {
						configured: detail.authorized,
						type: detail.authType,
						label: detail.label,
						supportsOAuth: false,
						custom: true,
						modelCount: detail.modelCount,
					};
				}

				return c.json({
					onboardingComplete,
					ottorouter: ottorouterWallet
						? {
								configured: true,
								publicKey: ottorouterWallet.publicKey,
							}
						: {
								configured: false,
							},
					providers,
					defaults: cfg.defaults,
				});
			} catch (error) {
				logger.error('Failed to get auth status', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
