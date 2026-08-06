import { z } from '@hono/zod-openapi';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import {
	ensureProviderEnv,
	getProviderDefinition,
	hasConfiguredProvider,
	isProviderAuthorized,
	logger,
	type ReasoningLevel,
	validateProviderModel,
} from '@ottocode/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import { resolveAgentConfig } from '../runtime/agent/registry.ts';
import { tryExecutePluginSlashMessage } from '../runtime/commands/plugin-slash.ts';
import { dispatchAssistantMessage } from '../runtime/message/service.ts';
import {
	extractBrowserScreenshot,
	referenceBrowserScreenshot,
	sanitizeInlineImageDataJson,
} from '../tools/adapter/browser-artifact.ts';
import { pluginCommandRunResponseSchema } from './plugins/schemas.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from './project-context.ts';

type MessagePartRow = typeof messageParts.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

const MAX_MESSAGE_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_REQUEST_BYTES = 64 * 1024 * 1024;

function attachmentPayloadBytes(attachment: unknown): number {
	if (!attachment || typeof attachment !== 'object') return 0;
	const payload = attachment as Record<string, unknown>;
	const dataBytes =
		typeof payload.data === 'string'
			? Math.ceil(payload.data.length * 0.75)
			: 0;
	const textBytes =
		typeof payload.textContent === 'string'
			? Buffer.byteLength(payload.textContent, 'utf8')
			: 0;
	return dataBytes + textBytes;
}

function attachmentName(attachment: unknown, index: number): string {
	if (attachment && typeof attachment === 'object') {
		const name = (attachment as Record<string, unknown>).name;
		if (typeof name === 'string' && name.trim()) return name;
	}
	return `attachment ${index + 1}`;
}

function validateMessageAttachments(body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;
	const payload = body as Record<string, unknown>;
	const attachments = [
		...(Array.isArray(payload.images) ? payload.images : []),
		...(Array.isArray(payload.files) ? payload.files : []),
	];
	if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
		return `A message can include at most ${MAX_MESSAGE_ATTACHMENTS} attachments.`;
	}

	let totalBytes = 0;
	for (const [index, attachment] of attachments.entries()) {
		const bytes = attachmentPayloadBytes(attachment);
		if (bytes > MAX_ATTACHMENT_BYTES) {
			return `${attachmentName(attachment, index)} exceeds the 5 MB attachment limit.`;
		}
		totalBytes += bytes;
		if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
			return 'Attachments exceed the 20 MB total limit.';
		}
	}

	return null;
}

function stripHeavyAttachmentFields(
	partType: string,
	content: Record<string, unknown> | string,
): Record<string, unknown> | string {
	if (
		typeof content === 'string' ||
		(partType !== 'image' && partType !== 'file') ||
		typeof content.attachmentId !== 'string' ||
		!content.attachmentId
	) {
		return content;
	}

	const hasInlinePayload =
		typeof content.data === 'string' ||
		(partType === 'file' && typeof content.textContent === 'string');
	if (!hasInlinePayload) return content;

	const stripped: Record<string, unknown> = {
		...content,
		dataOmitted: true,
	};
	delete stripped.data;
	delete stripped.textContent;
	return stripped;
}

const messagePartSchema = z
	.object({
		id: z.string(),
		messageId: z.string(),
		index: z.number(),
		stepIndex: z.number().nullable().optional(),
		type: z.string(),
		content: z.union([z.string(), z.record(z.string(), z.unknown())]),
		contentJson: z.unknown().optional(),
		agent: z.string(),
		provider: z.string(),
		model: z.string(),
		startedAt: z.number().nullable().optional(),
		completedAt: z.number().nullable().optional(),
		compactedAt: z.number().nullable().optional(),
		toolName: z.string().nullable().optional(),
		toolCallId: z.string().nullable().optional(),
		toolDurationMs: z.number().nullable().optional(),
	})
	.passthrough();

const messageSchema = z
	.object({
		id: z.string(),
		sessionId: z.string(),
		role: z.string(),
		status: z.string(),
		agent: z.string(),
		provider: z.string(),
		model: z.string(),
		createdAt: z.number(),
		completedAt: z.number().nullable().optional(),
		latencyMs: z.number().nullable().optional(),
		inputTokens: z.number().nullable().optional(),
		outputTokens: z.number().nullable().optional(),
		totalTokens: z.number().nullable().optional(),
		cachedInputTokens: z.number().nullable().optional(),
		cacheCreationInputTokens: z.number().nullable().optional(),
		reasoningTokens: z.number().nullable().optional(),
		finishReason: z.string().nullable().optional(),
		rawFinishReason: z.string().nullable().optional(),
		finishDetails: z.string().nullable().optional(),
		error: z.string().nullable().optional(),
		errorType: z.string().nullable().optional(),
		errorDetails: z.string().nullable().optional(),
		isAborted: z.boolean().nullable().optional(),
		parts: z.array(messagePartSchema).optional(),
	})
	.passthrough();

const messageParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const toolResultArtifactParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
	callId: z.string().openapi({
		param: { name: 'callId', in: 'path' },
	}),
});

const binaryToolResultArtifactSchema = z.unknown().openapi({
	type: 'string',
	format: 'binary',
	description: 'Raw browser screenshot bytes',
});

const listMessagesQuerySchema = projectQuerySchema.extend({
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

const createMessageQuerySchema = projectQuerySchema;

const createMessageBodySchema = z.object({
	content: z.string(),
	agent: z.string().optional().openapi({
		description:
			'Agent name. Defaults to the session agent, then config default. When explicitly changed and provider/model are omitted, the selected agent provider/model overrides are used before the session/default provider/model.',
	}),
	provider: z.string().optional().openapi({
		description:
			'Provider override for this message. If omitted, explicit agent provider override, session provider, then config default are used.',
	}),
	model: z.string().optional().openapi({
		description:
			'Model override for this message. If omitted, explicit agent model override, session model, then config default are used.',
	}),
	allowUnknownModel: z.boolean().optional().openapi({
		description:
			'Allow a model id that is not present in the configured model catalog.',
	}),
	userContext: z.string().nullable().optional().openapi({
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

const createMessageResponseSchema = z
	.object({
		messageId: z.string().optional(),
		pluginCommand: pluginCommandRunResponseSchema.optional(),
	})
	.refine((value) => Boolean(value.messageId || value.pluginCommand), {
		message: 'Response must include messageId or pluginCommand',
	});

const messageErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionMessagesRoutes(app: Hono) {
	app.use('/v1/sessions/:id/messages', async (c, next) => {
		const contentLength = Number.parseInt(
			c.req.header('content-length') || '',
			10,
		);
		if (
			c.req.method === 'POST' &&
			Number.isFinite(contentLength) &&
			contentLength > MAX_MESSAGE_REQUEST_BYTES
		) {
			return c.json({ error: 'Message request exceeds the 64 MB limit.' }, 413);
		}
		await next();
	});

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
				const { db } = await resolveRequestProject(c);
				const id = c.req.param('id');
				const rows = await db
					.select()
					.from(messages)
					.where(eq(messages.sessionId, id))
					.orderBy(messages.createdAt);
				const responseRows = rows.map((message) => ({
					...message,
					finishDetails: sanitizeInlineImageDataJson(message.finishDetails),
				}));
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
					const enriched = responseRows.map((m) => {
						const parts = (partsByMsg.get(m.id) ?? []).sort(
							(a, b) => a.index - b.index,
						);
						const mapped = parts.map((p) => {
							const parsed = parseContent(p.content);
							const referenced =
								p.type === 'tool_result' &&
								p.toolName === 'browser' &&
								p.toolCallId &&
								typeof parsed === 'object'
									? referenceBrowserScreenshot(parsed, id, p.toolCallId)
									: parsed;
							const stripped = stripHeavyAttachmentFields(p.type, referenced);
							const content =
								stripped === parsed ? p.content : JSON.stringify(stripped);
							return wantParsed
								? { ...p, content: stripped }
								: { ...p, content, contentJson: stripped };
						});
						return { ...m, parts: mapped };
					});
					return c.json(enriched);
				}
				return c.json(responseRows);
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
			method: 'get',
			path: '/v1/sessions/{id}/tool-results/{callId}/artifact',
			tags: ['messages'],
			operationId: 'getToolResultArtifact',
			summary: 'Get raw browser screenshot bytes for a tool result',
			request: {
				params: toolResultArtifactParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'Raw browser screenshot bytes',
					content: {
						'application/octet-stream': {
							schema: binaryToolResultArtifactSchema,
						},
					},
				},
				'404': {
					description: 'Browser screenshot not found',
					content: {
						'application/json': { schema: messageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const { db } = await resolveRequestProject(c);
			const sessionId = c.req.param('id');
			const callId = c.req.param('callId');
			const [part] = await db
				.select({ content: messageParts.content })
				.from(messageParts)
				.innerJoin(messages, eq(messageParts.messageId, messages.id))
				.where(
					and(
						eq(messages.sessionId, sessionId),
						eq(messageParts.type, 'tool_result'),
						eq(messageParts.toolName, 'browser'),
						eq(messageParts.toolCallId, callId),
					),
				)
				.limit(1);
			if (!part) return c.json({ error: 'Browser screenshot not found' }, 404);

			let screenshot = null;
			try {
				screenshot = extractBrowserScreenshot(JSON.parse(part.content));
			} catch {}
			if (!screenshot) {
				return c.json({ error: 'Browser screenshot not found' }, 404);
			}

			const bytes = Buffer.from(screenshot.data, 'base64');
			return new Response(bytes, {
				headers: {
					'Content-Type': screenshot.mediaType,
					'Content-Length': String(bytes.byteLength),
					'Cache-Control': 'private, max-age=31536000, immutable',
				},
			});
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
				'200': {
					description: 'Plugin command started in a visible terminal',
					content: {
						'application/json': { schema: createMessageResponseSchema },
					},
				},
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
				'413': {
					description: 'Message or attachments exceed size limits',
					content: {
						'application/json': { schema: messageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const { cfg, db, runtime } = await resolveRequestProject(c);
				const sessionId = c.req.param('id');
				const body = await c.req.json().catch(() => ({}));
				const attachmentError = validateMessageAttachments(body);
				if (attachmentError) {
					return c.json({ error: attachmentError }, 413);
				}

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
				const requestedAgent =
					typeof body?.agent === 'string' ? body.agent : undefined;
				const agent = requestedAgent ?? sess.agent ?? cfg.defaults.agent;
				const agentCfg = requestedAgent
					? await resolveAgentConfig(cfg.projectRoot, requestedAgent)
					: undefined;
				const agentProvider = hasConfiguredProvider(cfg, agentCfg?.provider)
					? agentCfg?.provider
					: undefined;
				const provider =
					body?.provider ??
					agentProvider ??
					sess.provider ??
					cfg.defaults.provider;
				const modelName =
					body?.model ?? agentCfg?.model ?? sess.model ?? cfg.defaults.model;
				const content = body?.content ?? '';
				const userContext = body?.userContext ?? undefined;
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
				const allowUnknownModel =
					body?.allowUnknownModel === true || modelName === sess.model;
				try {
					validateProviderModel(provider, modelName, cfg, {
						wantsToolCalls,
						allowUnknownModel,
					});
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

				const pluginCommand = await tryExecutePluginSlashMessage({
					projectRoot: cfg.projectRoot,
					content,
					terminalManager: runtime.terminalManager,
				});
				if (pluginCommand) {
					return c.json({ pluginCommand }, 200);
				}

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
