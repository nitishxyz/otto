import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import { normalizeThemeId, themeIds } from '@ottocode/themes';
import type { Hono } from 'hono';
import type { EmbeddedAppConfig } from '../../index.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { isHiddenAgent } from '../../runtime/agent/registry.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProject } from '../project-context.ts';
import {
	discoverAllAgents,
	getAuthorizedProviders,
	getDefault,
	getProviderDetails,
} from './utils.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const providerDetailSchema = z.object({
	id: z.string(),
	label: z.string(),
	source: z.enum(['built-in', 'custom']),
	enabled: z.boolean(),
	authorized: z.boolean(),
	custom: z.boolean().optional(),
	compatibility: z.string().nullable().optional(),
	family: z.string().nullable().optional(),
	baseURL: z.string().nullable().optional(),
	apiKeyEnv: z.string().nullable().optional(),
	hasApiKey: z.boolean().optional(),
	allowAnyModel: z.boolean().optional(),
	modelCount: z.number().int().optional(),
	authType: z.string().nullable().optional(),
});

const configDefaultsSchema = z.object({
	agent: z.string(),
	provider: z.string(),
	model: z.string(),
	toolApproval: z.enum(['auto', 'dangerous', 'all', 'yolo']).optional(),
	guidedMode: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	reasoningLevel: z
		.enum(['minimal', 'low', 'medium', 'high', 'max', 'xhigh'])
		.optional(),
	theme: z.enum(themeIds).optional(),
	tuiTheme: z.string().min(1).optional(),
	vimMode: z.boolean().optional(),
	compactThread: z.boolean().optional(),
	fontFamily: z.string().optional(),
	smartEdges: z.boolean().optional(),
	threadNavigatorRail: z.boolean().optional(),
	releaseToSend: z.boolean().optional(),
	fullWidthContent: z.boolean().optional(),
	notificationsEnabled: z.boolean().optional(),
	dictationKeywords: z
		.array(
			z.object({
				keyword: z.string(),
				aliases: z.array(z.string()).optional(),
			}),
		)
		.optional(),
	dictationExcludedProjectKeywords: z.array(z.string()).optional(),
	dictationSmartFormatting: z.boolean().optional(),
	autoCompactThresholdTokens: z.number().int().nullable().optional(),
	coAuthorCommits: z.boolean().optional(),
});

const configResponseSchema = z.object({
	agents: z.array(z.string()),
	providers: z.array(z.string()),
	providerDetails: z.array(providerDetailSchema),
	defaults: configDefaultsSchema,
});

export function registerMainConfigRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config',
			tags: ['config'],
			operationId: 'getConfig',
			summary: 'Get full configuration',
			description: 'Returns agents, authorized providers, models, and defaults',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: configResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const { cfg } = await resolveRequestProject(c);
				const embeddedConfig = (
					c as unknown as {
						get: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
					}
				).get('embeddedConfig');

				let allAgents: string[];

				if (embeddedConfig?.agents) {
					const embeddedAgents = Object.keys(embeddedConfig.agents).filter(
						(name) => !isHiddenAgent(name),
					);
					const fileAgents = await discoverAllAgents(cfg.projectRoot);
					allAgents = Array.from(
						new Set([...embeddedAgents, ...fileAgents]),
					).sort();
				} else {
					allAgents = await discoverAllAgents(cfg.projectRoot);
				}

				const authorizedProviders = await getAuthorizedProviders(
					embeddedConfig,
					cfg,
				);
				const providerDetails = await getProviderDetails(embeddedConfig, cfg);

				const defaults = {
					agent: getDefault(
						embeddedConfig?.agent,
						embeddedConfig?.defaults?.agent,
						cfg.defaults.agent,
					),
					provider: getDefault(
						embeddedConfig?.provider,
						embeddedConfig?.defaults?.provider,
						cfg.defaults.provider,
					),
					model: getDefault(
						embeddedConfig?.model,
						embeddedConfig?.defaults?.model,
						cfg.defaults.model,
					),
					toolApproval: getDefault(
						undefined,
						embeddedConfig?.defaults?.toolApproval,
						cfg.defaults.toolApproval,
					) as 'auto' | 'dangerous' | 'all' | 'yolo',
					guidedMode: cfg.defaults.guidedMode ?? false,
					reasoningText: cfg.defaults.reasoningText ?? true,
					reasoningLevel: cfg.defaults.reasoningLevel ?? 'high',
					theme: normalizeThemeId(
						getDefault(
							undefined,
							embeddedConfig?.defaults?.theme,
							cfg.defaults.theme,
						),
					),
					tuiTheme:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.tuiTheme,
							cfg.defaults.tuiTheme,
						) ?? 'tokyo-night',
					vimMode:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.vimMode,
							cfg.defaults.vimMode,
						) ?? false,
					compactThread:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.compactThread,
							cfg.defaults.compactThread,
						) ?? true,
					fontFamily:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.fontFamily,
							cfg.defaults.fontFamily,
						) ?? 'IBM Plex Mono',
					smartEdges:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.smartEdges,
							cfg.defaults.smartEdges,
						) ?? true,
					threadNavigatorRail:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.threadNavigatorRail,
							cfg.defaults.threadNavigatorRail,
						) ?? true,
					releaseToSend:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.releaseToSend,
							cfg.defaults.releaseToSend,
						) ?? false,
					fullWidthContent:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.fullWidthContent,
							cfg.defaults.fullWidthContent,
						) ?? false,
					notificationsEnabled: getDefault(
						undefined,
						embeddedConfig?.defaults?.notificationsEnabled,
						cfg.defaults.notificationsEnabled,
					),
					dictationKeywords:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.dictationKeywords,
							cfg.defaults.dictationKeywords,
						) ?? [],
					dictationExcludedProjectKeywords:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.dictationExcludedProjectKeywords,
							cfg.defaults.dictationExcludedProjectKeywords,
						) ?? [],
					dictationSmartFormatting:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.dictationSmartFormatting,
							cfg.defaults.dictationSmartFormatting,
						) ?? true,
					autoCompactThresholdTokens:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.autoCompactThresholdTokens,
							cfg.defaults.autoCompactThresholdTokens,
						) ?? null,
					coAuthorCommits:
						getDefault(
							undefined,
							embeddedConfig?.defaults?.coAuthorCommits,
							cfg.defaults.coAuthorCommits,
						) ?? false,
				};

				return c.json({
					agents: allAgents,
					providers: authorizedProviders,
					providerDetails,
					defaults,
				});
			} catch (error) {
				logger.error('Failed to load config', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
