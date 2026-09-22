import { z } from '@hono/zod-openapi';
import {
	JUDGE_DEFAULT_BASE_URL,
	JUDGE_DEFAULT_MODEL,
	JUDGE_DEFAULT_PRELOAD_THRESHOLD,
	JUDGE_DEFAULT_TIMEOUT_MS,
	JUDGE_ENV_VAR,
	JUDGE_PROVIDER_ID,
	clearMCPToolClassifications,
	getAuth,
	loadConfig,
	logger,
	readJudgeEnvKey,
	removeAuth,
	setAuth,
	writeJudgeSettings,
} from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getProjectManager } from '../../runtime/projects/manager.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description: 'Project root override.',
		}),
});

const judgeMcpSettingsSchema = z.object({
	classifyTools: z.boolean(),
	preloadTools: z.boolean(),
	preloadThreshold: z.number().min(0).max(1),
});

const judgeSettingsSchema = z.object({
	enabled: z.boolean(),
	provider: z.literal(JUDGE_PROVIDER_ID),
	baseURL: z.string(),
	model: z.string(),
	timeoutMs: z.number().int().positive(),
	mcp: judgeMcpSettingsSchema,
});

const judgeCredentialSchema = z.object({
	configured: z.boolean(),
	source: z.enum(['env', 'stored', 'none']),
	envVar: z.string(),
});

const judgeResponseSchema = z.object({
	settings: judgeSettingsSchema,
	credential: judgeCredentialSchema,
	defaults: z.object({
		baseURL: z.string(),
		model: z.string(),
		timeoutMs: z.number().int(),
		preloadThreshold: z.number(),
	}),
});

const judgeUpdateSchema = z.object({
	enabled: z.boolean().optional(),
	baseURL: z.string().optional(),
	model: z.string().optional(),
	timeoutMs: z.number().int().positive().optional(),
	mcp: judgeMcpSettingsSchema.partial().optional(),
	/** Set a new API key; empty string clears the stored credential. */
	apiKey: z.string().optional(),
});

const mutationResponseSchema = judgeResponseSchema.extend({
	success: z.boolean(),
});

async function buildJudgeResponse(projectRoot: string) {
	const cfg = await loadConfig(projectRoot);
	const judge = cfg.judge ?? {};
	const stored = await getAuth(JUDGE_PROVIDER_ID, projectRoot);
	const source = readJudgeEnvKey()
		? ('env' as const)
		: stored?.type === 'api' && stored.key
			? ('stored' as const)
			: ('none' as const);
	return {
		settings: {
			enabled: judge.enabled ?? true,
			provider: JUDGE_PROVIDER_ID,
			baseURL:
				judge.baseURL?.trim().replace(/\/+$/, '') || JUDGE_DEFAULT_BASE_URL,
			model: judge.model?.trim() || JUDGE_DEFAULT_MODEL,
			timeoutMs: judge.timeoutMs ?? JUDGE_DEFAULT_TIMEOUT_MS,
			mcp: {
				classifyTools: judge.mcp?.classifyTools ?? true,
				preloadTools: judge.mcp?.preloadTools ?? true,
				preloadThreshold:
					judge.mcp?.preloadThreshold ?? JUDGE_DEFAULT_PRELOAD_THRESHOLD,
			},
		},
		credential: {
			configured: source !== 'none',
			source,
			envVar: JUDGE_ENV_VAR,
		},
		defaults: {
			baseURL: JUDGE_DEFAULT_BASE_URL,
			model: JUDGE_DEFAULT_MODEL,
			timeoutMs: JUDGE_DEFAULT_TIMEOUT_MS,
			preloadThreshold: JUDGE_DEFAULT_PRELOAD_THRESHOLD,
		},
	};
}

export function registerJudgeRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/config/judge',
			tags: ['config'],
			operationId: 'getJudgeConfig',
			summary: 'Get judge (TypeSafe) settings and credential status',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'Judge settings',
					content: { 'application/json': { schema: judgeResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				return c.json(await buildJudgeResponse(projectRoot));
			} catch (error) {
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/config/judge',
			tags: ['config'],
			operationId: 'updateJudgeConfig',
			summary: 'Update judge settings or credential',
			request: {
				query: projectQuerySchema,
				body: {
					required: true,
					content: { 'application/json': { schema: judgeUpdateSchema } },
				},
			},
			responses: {
				'200': {
					description: 'Updated judge settings',
					content: { 'application/json': { schema: mutationResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const { apiKey, ...settings } = c.req.valid('json');

				if (apiKey !== undefined) {
					const trimmed = apiKey.trim();
					if (trimmed) {
						await setAuth(
							JUDGE_PROVIDER_ID,
							{ type: 'api', key: trimmed },
							projectRoot,
							'global',
						);
					} else {
						await removeAuth(JUDGE_PROVIDER_ID, projectRoot, 'global');
					}
				}

				if (Object.keys(settings).length > 0) {
					await writeJudgeSettings({
						...settings,
						...(settings.baseURL !== undefined
							? { baseURL: settings.baseURL.trim().replace(/\/+$/, '') }
							: {}),
						...(settings.model !== undefined
							? { model: settings.model.trim() }
							: {}),
					});
				}

				// Classification depends on judge availability; drop the memoized
				// tool-set so the next discovery re-evaluates with the new settings.
				clearMCPToolClassifications(projectRoot);
				await getProjectManager().refreshProjectConfig(projectRoot);
				return c.json({
					success: true,
					...(await buildJudgeResponse(projectRoot)),
				});
			} catch (error) {
				logger.error('Failed to update judge config', error);
				const response = serializeError(error);
				return c.json(response, response.error.status || 500);
			}
		},
	);
}
