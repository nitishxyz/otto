import type { Hono } from 'hono';
import {
	catalog,
	getAllAuth,
	getOnboardingComplete,
	getOttoRouterWallet,
	loadConfig,
	type ProviderId,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getProviderDetails } from '../config/utils.ts';
import { getGhImportCapability } from './service.ts';

export function registerAuthStatusRoutes(app: Hono) {
	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									onboardingComplete: {
										type: 'boolean',
									},
									ottorouter: {
										type: 'object',
										properties: {
											configured: {
												type: 'boolean',
											},
											publicKey: {
												type: 'string',
											},
										},
										required: ['configured'],
									},
									providers: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												configured: {
													type: 'boolean',
												},
												type: {
													type: 'string',
													enum: ['api', 'oauth', 'wallet'],
												},
												label: {
													type: 'string',
												},
												supportsOAuth: {
													type: 'boolean',
												},
												supportsToken: {
													type: 'boolean',
												},
												supportsGhImport: {
													type: 'boolean',
												},
												modelCount: {
													type: 'integer',
												},
												costRange: {
													type: 'object',
													nullable: true,
													properties: {
														min: {
															type: 'number',
														},
														max: {
															type: 'number',
														},
													},
													required: ['min', 'max'],
												},
											},
											required: [
												'configured',
												'label',
												'supportsOAuth',
												'modelCount',
											],
										},
									},
									defaults: {
										type: 'object',
										properties: {
											agent: {
												type: 'string',
											},
											provider: {
												type: 'string',
											},
											model: {
												type: 'string',
											},
										},
									},
								},
								required: ['onboardingComplete', 'ottorouter', 'providers'],
							},
						},
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
