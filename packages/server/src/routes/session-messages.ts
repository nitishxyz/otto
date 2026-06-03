import { z } from '@hono/zod-openapi';
import { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import {
	ensureProviderEnv,
	getProviderDefinition,
	isProviderAuthorized,
	loadConfig,
	logger,
	type ReasoningLevel,
	validateProviderModel,
} from '@ottocode/sdk';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import { dispatchAssistantMessage } from '../runtime/message/service.ts';

type MessagePartRow = typeof messageParts.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

const messageSchema = z.any();

const messageParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const listMessagesQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
	without: z
		.enum(['parts'])
		.optional()
		.openapi({
			param: { name: 'without', in: 'query' },
			description:
				'Exclude parts from the response. By default, parts are included.',
		}),
	parsed: z
		.string()
		.optional()
		.openapi({
			param: { name: 'parsed', in: 'query' },
		}),
});

const createMessageQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const createMessageBodySchema = z.object({
	content: z.string(),
	agent: z.string().optional().openapi({
		description: 'Agent name. Defaults to config if omitted.',
	}),
	provider: z.string().optional(),
	model: z.string().optional(),
	userContext: z.string().optional().openapi({
		description:
			'Optional user-provided context to include in the system prompt.',
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
				'Reasoning intensity level for providers/models that support it.',
		}),
	images: z.array(z.unknown()).optional(),
	files: z.array(z.unknown()).optional(),
	oneShot: z.boolean().optional(),
});

const createMessageResponseSchema = z.object({
	messageId: z.string(),
});

const messageErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionMessagesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{id}/messages',
			tags: ['messages'],
			operationId: 'listMessages',
			summary: 'List messages for a session',
			request: {
				params: messageParamsSchema,
				query: listMessagesQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: z.array(messageSchema) },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const id = c.req.param('id');
				const rows = await db
					.select()
					.from(messages)
					.where(eq(messages.sessionId, id))
					.orderBy(messages.createdAt);
				const without = c.req.query('without');
				if (without !== 'parts') {
					const ids = rows.map((m) => m.id);
					const parts = ids.length
						? await db
								.select()
								.from(messageParts)
								.where(inArray(messageParts.messageId, ids))
						: [];
					const partsByMsg = new Map<string, MessagePartRow[]>();
					for (const p of parts) {
						const existing = partsByMsg.get(p.messageId);
						if (existing) existing.push(p);
						else partsByMsg.set(p.messageId, [p]);
					}
					const wantParsed = (() => {
						const q = (c.req.query('parsed') || '').toLowerCase();
						return q === '1' || q === 'true' || q === 'yes';
					})();
					function parseContent(raw: string): Record<string, unknown> | string {
						try {
							const v = JSON.parse(String(raw ?? ''));
							if (v && typeof v === 'object' && !Array.isArray(v))
								return v as Record<string, unknown>;
						} catch {}
						return raw;
					}
					const enriched = rows.map((m) => {
						const parts = (partsByMsg.get(m.id) ?? []).sort(
							(a, b) => a.index - b.index,
						);
						const mapped = parts.map((p) => {
							const parsed = parseContent(p.content);
							return wantParsed
								? { ...p, content: parsed }
								: { ...p, contentJson: parsed };
						});
						return { ...m, parts: mapped };
					});
					return c.json(enriched);
				}
				return c.json(rows);
			} catch (error) {
				logger.error('Failed to list session messages', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{id}/messages',
			tags: ['messages'],
			operationId: 'createMessage',
			summary: 'Send a user message and enqueue assistant run',
			request: {
				params: messageParamsSchema,
				query: createMessageQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: createMessageBodySchema },
					},
				},
			},
			responses: {
				'202': {
					description: 'Accepted',
					content: {
						'application/json': { schema: createMessageResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: messageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);
				const sessionId = c.req.param('id');
				const body = await c.req.json().catch(() => ({}));

				logger.info('[API] Received message request', {
					sessionId,
					hasContent: !!body?.content,
					hasUserContext: !!body?.userContext,
					userContext: body?.userContext
						? `${String(body.userContext).substring(0, 50)}...`
						: 'NONE',
				});

				const sessionRows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, sessionId));
				if (!sessionRows.length) {
					logger.warn('Session not found', { sessionId });
					return c.json({ error: 'Session not found' }, 404);
				}
				const sess: SessionRow = sessionRows[0];
				const provider =
					body?.provider ?? sess.provider ?? cfg.defaults.provider;
				const modelName = body?.model ?? sess.model ?? cfg.defaults.model;
				const agent = body?.agent ?? sess.agent ?? cfg.defaults.agent;
				const content = body?.content ?? '';
				const userContext = body?.userContext;
				const images = Array.isArray(body?.images) ? body.images : undefined;
				const files = Array.isArray(body?.files) ? body.files : undefined;

				logger.info('[API] Extracted userContext', {
					userContext: userContext
						? `${String(userContext).substring(0, 50)}...`
						: 'NONE',
					typeOf: typeof userContext,
				});

				const reasoning =
					body?.reasoningText ?? cfg.defaults.reasoningText ?? false;
				const reasoningLevel =
					(body?.reasoningLevel as ReasoningLevel | undefined) ??
					cfg.defaults.reasoningLevel ??
					'high';

				const wantsToolCalls = true;
				try {
					validateProviderModel(provider, modelName, cfg, { wantsToolCalls });
				} catch (err) {
					logger.error('Model validation failed', err, { provider, modelName });
					const message = err instanceof Error ? err.message : String(err);
					return c.json({ error: message }, 400);
				}
				const authorized = await isProviderAuthorized(cfg, provider);
				if (!authorized) {
					logger.warn('Provider not authorized', { provider });
					return c.json(
						{
							error: `Provider ${provider} is not configured. Run \`otto auth login\` to add credentials.`,
						},
						400,
					);
				}
				await ensureProviderEnv(cfg, provider);
				const providerDefinition = getProviderDefinition(cfg, provider);

				const { assistantMessageId } = await dispatchAssistantMessage({
					cfg,
					db,
					session: sess,
					agent,
					provider,
					model: modelName,
					content,
					oneShot: Boolean(body?.oneShot),
					userContext,
					reasoningText:
						providerDefinition?.compatibility === 'ollama'
							? (body?.reasoningText ?? false)
							: reasoning,
					reasoningLevel,
					images,
					files,
				});
				return c.json({ messageId: assistantMessageId }, 202);
			} catch (error) {
				logger.error('Failed to create session message', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
