import { z } from '@hono/zod-openapi';
import {
	hasConfiguredProvider,
	loadConfig,
	loadGlobalConfig,
	logger,
	setConfig,
	type ProviderId,
	type ReasoningLevel,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { normalizeThemeId, themeIds, type ThemeId } from '@ottocode/themes';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getProjectManager } from '../../runtime/projects/manager.ts';
import {
	hasRequestProjectContext,
	resolveRequestProjectRoot,
} from '../project-context.ts';

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

const toolApprovalSchema = z.enum(['auto', 'dangerous', 'all', 'yolo']);
const reasoningLevelSchema = z.enum([
	'minimal',
	'low',
	'medium',
	'high',
	'max',
	'xhigh',
]);
const themeSchema = z.enum(themeIds);
const tuiThemeSchema = z.string().min(1);

const defaultsUpdateBodySchema = z.object({
	agent: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	toolApproval: toolApprovalSchema.optional(),
	guidedMode: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	reasoningLevel: reasoningLevelSchema.optional(),
	theme: themeSchema.optional(),
	tuiTheme: tuiThemeSchema.optional(),
	vimMode: z.boolean().optional(),
	compactThread: z.boolean().optional(),
	fontFamily: z.string().optional(),
	smartEdges: z.boolean().optional(),
	threadNavigatorRail: z.boolean().optional(),
	releaseToSend: z.boolean().optional(),
	fullWidthContent: z.boolean().optional(),
	notificationsEnabled: z.boolean().optional(),
	autoCompactThresholdTokens: z.number().int().nullable().optional(),
	coAuthorCommits: z.boolean().optional(),
	scope: z.enum(['global', 'local']).optional().default('global'),
});

const defaultsSchema = z.object({
	agent: z.string(),
	provider: z.string(),
	model: z.string(),
	toolApproval: toolApprovalSchema.optional(),
	guidedMode: z.boolean().optional(),
	reasoningText: z.boolean().optional(),
	reasoningLevel: reasoningLevelSchema.optional(),
	theme: themeSchema.optional(),
	tuiTheme: tuiThemeSchema.optional(),
	vimMode: z.boolean().optional(),
	compactThread: z.boolean().optional(),
	fontFamily: z.string().optional(),
	smartEdges: z.boolean().optional(),
	threadNavigatorRail: z.boolean().optional(),
	releaseToSend: z.boolean().optional(),
	fullWidthContent: z.boolean().optional(),
	notificationsEnabled: z.boolean().optional(),
	autoCompactThresholdTokens: z.number().int().nullable().optional(),
	coAuthorCommits: z.boolean().optional(),
});

const updateDefaultsResponseSchema = z.object({
	success: z.boolean(),
	defaults: defaultsSchema,
});

export function registerDefaultsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/config/defaults',
			tags: ['config'],
			operationId: 'updateDefaults',
			summary: 'Update default configuration',
			description: 'Update the default agent, provider, and/or model',
			request: {
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: defaultsUpdateBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: updateDefaultsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json<{
					agent?: string;
					provider?: string;
					model?: string;
					toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
					guidedMode?: boolean;
					reasoningText?: boolean;
					reasoningLevel?: ReasoningLevel;
					theme?: ThemeId | 'light' | 'dark';
					tuiTheme?: string;
					vimMode?: boolean;
					compactThread?: boolean;
					fontFamily?: string;
					smartEdges?: boolean;
					threadNavigatorRail?: boolean;
					releaseToSend?: boolean;
					fullWidthContent?: boolean;
					notificationsEnabled?: boolean;
					autoCompactThresholdTokens?: number | null;
					coAuthorCommits?: boolean;
					scope?: 'global' | 'local';
				}>();

				const scope = body.scope || 'global';
				const hasProjectContext = hasRequestProjectContext(c);
				if (scope === 'local' && !hasProjectContext) {
					return c.json(
						{ error: 'Local defaults require an explicit project context.' },
						400,
					);
				}
				const projectRoot =
					scope === 'local' ? await resolveRequestProjectRoot(c) : undefined;
				const cfg = projectRoot
					? await loadConfig(projectRoot)
					: await loadGlobalConfig();
				const updates: Partial<{
					agent: string;
					provider: ProviderId;
					model: string;
					toolApproval: 'auto' | 'dangerous' | 'all' | 'yolo';
					guidedMode: boolean;
					reasoningText: boolean;
					reasoningLevel: ReasoningLevel;
					theme: ThemeId;
					tuiTheme: string;
					vimMode: boolean;
					compactThread: boolean;
					fontFamily: string;
					smartEdges: boolean;
					threadNavigatorRail: boolean;
					releaseToSend: boolean;
					fullWidthContent: boolean;
					notificationsEnabled: boolean;
					autoCompactThresholdTokens: number | null;
					coAuthorCommits: boolean;
				}> = {};

				if (body.agent) updates.agent = body.agent;
				if (body.provider) {
					if (!hasConfiguredProvider(cfg, body.provider)) {
						return c.json({ error: `Invalid provider: ${body.provider}` }, 400);
					}
					updates.provider = body.provider as ProviderId;
				}
				if (body.model) updates.model = body.model;
				if (body.toolApproval) updates.toolApproval = body.toolApproval;
				if (body.guidedMode !== undefined) updates.guidedMode = body.guidedMode;
				if (body.reasoningText !== undefined)
					updates.reasoningText = body.reasoningText;
				if (body.reasoningLevel) updates.reasoningLevel = body.reasoningLevel;
				if (body.theme) {
					updates.theme = normalizeThemeId(body.theme);
				}
				if (body.tuiTheme !== undefined) {
					const tuiTheme = body.tuiTheme.trim();
					if (tuiTheme) updates.tuiTheme = tuiTheme;
				}
				if (body.vimMode !== undefined) updates.vimMode = body.vimMode;
				if (body.compactThread !== undefined)
					updates.compactThread = body.compactThread;
				if (body.fontFamily !== undefined) {
					const fontFamily = body.fontFamily.trim();
					if (fontFamily) updates.fontFamily = fontFamily;
				}
				if (body.smartEdges !== undefined) updates.smartEdges = body.smartEdges;
				if (body.threadNavigatorRail !== undefined)
					updates.threadNavigatorRail = body.threadNavigatorRail;
				if (body.releaseToSend !== undefined)
					updates.releaseToSend = body.releaseToSend;
				if (body.fullWidthContent !== undefined)
					updates.fullWidthContent = body.fullWidthContent;
				if (body.notificationsEnabled !== undefined)
					updates.notificationsEnabled = body.notificationsEnabled;
				if (body.autoCompactThresholdTokens !== undefined) {
					const threshold = body.autoCompactThresholdTokens;
					if (threshold === null) {
						updates.autoCompactThresholdTokens = null;
					} else if (Number.isFinite(threshold) && threshold > 0) {
						updates.autoCompactThresholdTokens = Math.floor(threshold);
					}
				}
				if (body.coAuthorCommits !== undefined)
					updates.coAuthorCommits = body.coAuthorCommits;

				await setConfig(scope, updates, projectRoot);

				const nextCfg = projectRoot
					? ((await getProjectManager().refreshProjectConfig(projectRoot)) ??
						(await loadConfig(projectRoot)))
					: await loadGlobalConfig();

				return c.json({
					success: true,
					defaults: nextCfg.defaults,
				});
			} catch (error) {
				logger.error('Failed to update defaults', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
