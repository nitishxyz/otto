import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import type { EmbeddedAppConfig } from '../index.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import type {
	AskServerRequest,
	InjectableConfig,
	InjectableCredentials,
} from '../runtime/ask/service.ts';
import { handleAskRequest } from '../runtime/ask/service.ts';
import { serializeError } from '../runtime/errors/api-error.ts';

const askQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const askBodySchema = z.object({
	prompt: z.string().openapi({
		description: 'User prompt to send to the assistant.',
	}),
	agent: z.string().optional().openapi({
		description: 'Optional agent name to use for this request.',
	}),
	provider: z.string().optional().openapi({
		description:
			'Optional provider override. When omitted the agent and config defaults apply.',
	}),
	model: z.string().optional().openapi({
		description: 'Optional model override for the selected provider.',
	}),
	reasoningText: z.boolean().optional().openapi({
		description:
			'Enable extended thinking / reasoning for models that support it.',
	}),
	reasoningLevel: z
		.enum(['minimal', 'low', 'medium', 'high', 'max', 'xhigh'])
		.optional()
		.openapi({
			description:
				'Optional reasoning intensity override for supported providers/models.',
		}),
	sessionId: z.string().optional().openapi({
		description: 'Send the prompt to a specific session.',
	}),
	last: z.boolean().optional().openapi({
		description: 'If true, reuse the most recent session for the project.',
	}),
	jsonMode: z.boolean().optional().openapi({
		description: 'Request structured JSON output when supported by the agent.',
	}),
});

const askResponseSchema = z.object({
	sessionId: z.string(),
	header: z.object({
		sessionId: z.string(),
		agent: z.string().nullable().optional(),
		provider: z.string().nullable().optional(),
		model: z.string().nullable().optional(),
	}),
	provider: z.string(),
	model: z.string(),
	agent: z.string(),
	assistantMessageId: z.string(),
	message: z
		.object({
			kind: z.enum(['created', 'last']),
			sessionId: z.string(),
		})
		.nullable()
		.optional(),
});

const askErrorSchema = z.object({
	error: z.string(),
});

export function registerAskRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ask',
			tags: ['ask'],
			operationId: 'ask',
			summary: 'Send a prompt using the ask service',
			description:
				'Streamlined endpoint used by the CLI to send prompts and receive assistant responses. Creates sessions as needed and reuses the last session when requested.',
			request: {
				query: askQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: askBodySchema },
					},
				},
			},
			responses: {
				'202': {
					description: 'Accepted',
					content: {
						'application/json': {
							schema: askResponseSchema,
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: askErrorSchema,
						},
					},
				},
			},
		},
		async (c) => {
			const projectRoot = c.req.query('project') || process.cwd();
			const body = (await c.req.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			const prompt = typeof body.prompt === 'string' ? body.prompt : '';
			if (!prompt.trim().length) {
				return c.json({ error: 'Prompt is required.' }, 400);
			}

			const embeddedConfig = (
				c as unknown as {
					get: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
				}
			).get('embeddedConfig');

			// Hybrid fallback: Use embedded config if provided, otherwise fall back to files/env
			let injectableConfig: InjectableConfig | undefined;
			let injectableCredentials: InjectableCredentials | undefined;
			let skipFileConfig = false;

			if (embeddedConfig && Object.keys(embeddedConfig).length > 0) {
				// Has embedded config - build injectable config from it
				const defaults = embeddedConfig.defaults;
				const hasDefaults =
					defaults ||
					embeddedConfig.provider ||
					embeddedConfig.model ||
					embeddedConfig.agent;

				if (hasDefaults) {
					injectableConfig = {
						provider: defaults?.provider ?? embeddedConfig.provider,
						model: defaults?.model ?? embeddedConfig.model,
						agent: defaults?.agent ?? embeddedConfig.agent,
					};
				}

				// Convert embedded auth to injectable credentials
				const hasAuth = embeddedConfig.auth || embeddedConfig.apiKey;
				if (hasAuth) {
					if (embeddedConfig.auth) {
						injectableCredentials = {} as InjectableCredentials;
						for (const [provider, auth] of Object.entries(
							embeddedConfig.auth,
						)) {
							if ('apiKey' in auth) {
								(injectableCredentials as Record<string, { apiKey: string }>)[
									provider
								] = { apiKey: auth.apiKey };
							}
						}
					} else if (embeddedConfig.apiKey && embeddedConfig.provider) {
						injectableCredentials = {
							[embeddedConfig.provider]: { apiKey: embeddedConfig.apiKey },
						};
					}

					// Only skip file config if we have credentials injected
					skipFileConfig = true;
				}
				// If no auth provided, skipFileConfig stays false -> will use ensureProviderEnv -> auth.json fallback
			}

			const request: AskServerRequest = {
				projectRoot,
				prompt,
				agent: typeof body.agent === 'string' ? body.agent : undefined,
				provider: typeof body.provider === 'string' ? body.provider : undefined,
				model: typeof body.model === 'string' ? body.model : undefined,
				reasoningText:
					typeof body.reasoningText === 'boolean'
						? body.reasoningText
						: undefined,
				reasoningLevel:
					typeof body.reasoningLevel === 'string'
						? (body.reasoningLevel as AskServerRequest['reasoningLevel'])
						: undefined,
				sessionId:
					typeof body.sessionId === 'string' ? body.sessionId : undefined,
				last: Boolean(body.last),
				jsonMode: Boolean(body.jsonMode),
				skipFileConfig:
					skipFileConfig ||
					(typeof body.skipFileConfig === 'boolean'
						? body.skipFileConfig
						: false),
				config:
					injectableConfig ||
					(body.config && typeof body.config === 'object'
						? (body.config as InjectableConfig)
						: undefined),
				credentials:
					injectableCredentials ||
					(body.credentials && typeof body.credentials === 'object'
						? (body.credentials as InjectableCredentials)
						: undefined),
				agentPrompt:
					typeof body.agentPrompt === 'string' ? body.agentPrompt : undefined,
				tools: Array.isArray(body.tools) ? body.tools : undefined,
			};

			try {
				const response = await handleAskRequest(request);
				return c.json(response, 202);
			} catch (err) {
				logger.error('Ask request failed', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
		},
	);
}
