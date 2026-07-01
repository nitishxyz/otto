import { hasConfiguredProvider, logger, type ProviderId } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { resolveAgentConfig } from '../../../runtime/agent/registry.ts';
import { serializeError } from '../../../runtime/errors/api-error.ts';
import { createSession as createSessionRow } from '../../../runtime/session/manager.ts';
import { resolveRequestProject } from '../../project-context.ts';
import { attachSessionCostSummary, normalizeSessionRow } from '../service.ts';
import {
	createSessionBodySchema,
	errorResponseSchema,
	projectQuerySchema,
	sessionSchema,
} from './schemas.ts';

export function registerCreateSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'createSession',
			summary: 'Create a new session',
			request: {
				query: projectQuerySchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: createSessionBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: { 'application/json': { schema: sessionSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const { cfg, db } = await resolveRequestProject(c);
			const body = (await c.req.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			const agent = (body.agent as string | undefined) ?? cfg.defaults.agent;
			const agentCfg = await resolveAgentConfig(cfg.projectRoot, agent);
			const providerCandidate =
				typeof body.provider === 'string' ? body.provider.trim() : undefined;
			if (providerCandidate && !hasConfiguredProvider(cfg, providerCandidate)) {
				const errorResponse = serializeError(
					new Error(`Provider not supported: ${providerCandidate}`),
				);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
			const provider: ProviderId = (() => {
				if (providerCandidate) return providerCandidate;
				if (hasConfiguredProvider(cfg, agentCfg.provider))
					return agentCfg.provider;
				return cfg.defaults.provider;
			})();
			const modelCandidate =
				typeof body.model === 'string' ? body.model.trim() : undefined;
			const model = modelCandidate?.length
				? modelCandidate
				: (agentCfg.model ?? cfg.defaults.model);
			try {
				const row = await createSessionRow({
					db,
					cfg,
					agent,
					provider,
					model,
					allowUnknownModel: body.allowUnknownModel === true,
					title: (body.title as string | null | undefined) ?? null,
					parentSessionId:
						(body.parentSessionId as string | null | undefined) ?? null,
					sessionType:
						body.sessionType === 'btw'
							? 'btw'
							: body.sessionType === 'otto'
								? 'otto'
								: 'main',
				});
				return c.json(
					attachSessionCostSummary(normalizeSessionRow(row), undefined),
					201,
				);
			} catch (err) {
				logger.error('Failed to create session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
		},
	);
}
