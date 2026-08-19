import { z } from '@hono/zod-openapi';
import type { DB } from '@ottocode/database';
import {
	messages,
	messageParts,
	type sessions,
} from '@ottocode/database/schema';
import {
	ensureProviderEnv,
	getProviderDefinition,
	hasConfiguredProvider,
	isProviderAuthorized,
	logger,
	type ReasoningLevel,
	validateProviderModel,
} from '@ottocode/sdk';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { boundToolEventValue } from '../events/tool-payload.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import { resolveAgentConfig } from '../runtime/agent/registry.ts';
import { tryExecutePluginSlashMessage } from '../runtime/commands/plugin-slash.ts';
import { dispatchAssistantMessage } from '../runtime/message/service.ts';
import type { DispatchOptions } from '../runtime/message/types.ts';
import { sessionRepository } from '../runtime/session/repository.ts';
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
const DEFAULT_MESSAGE_PART_TARGET = 120;
const MAX_MESSAGE_PART_TARGET = 250;
const MIN_COMPLETE_TURNS_PER_PAGE = 2;
const MESSAGE_SUMMARY_BATCH_SIZE = 128;
const MAX_INLINE_PART_BYTES = 256 * 1024;
const LARGE_PART_PREVIEW_CHARS = 16 * 1024;

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

const partContentParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
	partId: z.string().openapi({
		param: { name: 'partId', in: 'path' },
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

const listMessagePageQuerySchema = listMessagesQuerySchema.extend({
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_MESSAGE_PART_TARGET)
		.default(DEFAULT_MESSAGE_PART_TARGET)
		.openapi({
			param: { name: 'limit', in: 'query' },
			description:
				'Soft message-part target. Pages always contain complete turns and include at least two turns when available.',
		}),
	cursor: z
		.string()
		.optional()
		.openapi({
			param: { name: 'cursor', in: 'query' },
			description: 'Opaque cursor returned by the previous page.',
		}),
});

const messagePageSchema = z.object({
	items: z.array(messageSchema),
	partCount: z.number().int(),
	hasMore: z.boolean(),
	nextCursor: z.string().nullable(),
});

interface MessageCursor {
	createdAt: number;
	sequence?: number;
	messageId?: string;
}

const messageSequence = sql<number>`${messages}.rowid`;

function encodeMessageCursor(cursor: MessageCursor) {
	return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function parseMessageCursor(value: string | undefined): MessageCursor | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8'),
		) as Partial<MessageCursor>;
		const hasSequence =
			typeof parsed.sequence === 'number' &&
			Number.isSafeInteger(parsed.sequence);
		const hasMessageId =
			typeof parsed.messageId === 'string' && Boolean(parsed.messageId);
		return typeof parsed.createdAt === 'number' &&
			Number.isSafeInteger(parsed.createdAt) &&
			(hasSequence || hasMessageId)
			? (parsed as MessageCursor)
			: null;
	} catch {
		return null;
	}
}

interface MessageSummary {
	message: typeof messages.$inferSelect;
	partCount: number;
	sequence: number;
}

function selectCompleteTurnPage(
	summaries: MessageSummary[],
	partTarget: number,
): MessageSummary[] {
	const turns: MessageSummary[][] = [];
	let currentTurn: MessageSummary[] = [];
	for (const summary of summaries) {
		currentTurn.push(summary);
		if (summary.message.role === 'user') {
			turns.push(currentTurn);
			currentTurn = [];
		}
	}
	if (currentTurn.length > 0) turns.push(currentTurn);

	const selected: MessageSummary[] = [];
	let selectedParts = 0;
	let selectedTurns = 0;
	for (const turn of turns) {
		const turnParts = turn.reduce(
			(total, summary) => total + summary.partCount,
			0,
		);
		if (
			selectedTurns >= MIN_COMPLETE_TURNS_PER_PAGE &&
			selectedParts + turnParts > partTarget
		) {
			break;
		}
		selected.push(...turn);
		selectedParts += turnParts;
		selectedTurns++;
	}
	return selected;
}

function wantsParsedParts(value: string | undefined): boolean {
	const normalized = (value || '').toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function serializeMessages(
	db: DB,
	rows: Array<typeof messages.$inferSelect>,
	options: {
		includeParts: boolean;
		parsed: boolean;
		maxInlinePartBytes?: number;
		parts?: MessagePartRow[];
	},
) {
	const responseRows = rows.map((message) => ({
		...message,
		finishDetails: sanitizeInlineImageDataJson(message.finishDetails),
	}));
	if (!options.includeParts) return responseRows;

	const ids = rows.map((message) => message.id);
	const parts =
		options.parts ??
		(ids.length
			? await db
					.select()
					.from(messageParts)
					.where(inArray(messageParts.messageId, ids))
			: []);
	const partsByMessage = new Map<string, MessagePartRow[]>();
	for (const part of parts) {
		const existing = partsByMessage.get(part.messageId);
		if (existing) existing.push(part);
		else partsByMessage.set(part.messageId, [part]);
	}

	function parseContent(raw: string): Record<string, unknown> | string {
		try {
			const value = JSON.parse(String(raw ?? ''));
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				return value as Record<string, unknown>;
			}
		} catch {}
		return raw;
	}

	return responseRows.map((message) => {
		const messagePartRows = (partsByMessage.get(message.id) ?? []).sort(
			(left, right) => left.index - right.index,
		);
		const mapped = messagePartRows.map((part) => {
			const parsed = parseContent(part.content);
			const referenced =
				part.type === 'tool_result' &&
				part.toolName === 'browser' &&
				part.toolCallId &&
				typeof parsed === 'object'
					? referenceBrowserScreenshot(
							parsed,
							message.sessionId,
							part.toolCallId,
						)
					: parsed;
			const stripped = stripHeavyAttachmentFields(part.type, referenced);
			const contentBytes = Buffer.byteLength(part.content, 'utf8');
			const shouldTruncate =
				options.maxInlinePartBytes !== undefined &&
				contentBytes > options.maxInlinePartBytes &&
				(part.type === 'tool_call' ||
					part.type === 'tool_result' ||
					part.type === 'error');
			const artifactPath = `/v1/sessions/${encodeURIComponent(
				message.sessionId,
			)}/parts/${encodeURIComponent(part.id)}/content`;
			const responseContent = shouldTruncate
				? part.type === 'tool_call'
					? {
							...(boundToolEventValue(stripped).value as Record<
								string,
								unknown
							>),
							argsTruncated: true,
							argsOriginalBytes: contentBytes,
							artifactPath,
						}
					: {
							...(typeof stripped === 'object' &&
							typeof stripped.name === 'string'
								? { name: stripped.name }
								: {}),
							result: {
								truncated: true,
								preview: part.content.slice(0, LARGE_PART_PREVIEW_CHARS),
								originalBytes: contentBytes,
								artifactPath,
							},
						}
				: stripped;
			const content =
				responseContent === parsed
					? part.content
					: JSON.stringify(responseContent);
			return options.parsed
				? {
						...part,
						content: responseContent,
						...(shouldTruncate
							? { contentTruncated: true, contentBytes, artifactPath }
							: {}),
					}
				: {
						...part,
						content,
						contentJson: responseContent,
						...(shouldTruncate
							? { contentTruncated: true, contentBytes, artifactPath }
							: {}),
					};
		});
		return { ...message, parts: mapped };
	});
}

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
				const { id } = c.req.valid('param');
				const query = c.req.valid('query');
				const rows = await db
					.select()
					.from(messages)
					.where(eq(messages.sessionId, id))
					.orderBy(messages.createdAt, messageSequence);
				return c.json(
					await serializeMessages(db, rows, {
						includeParts: query.without !== 'parts',
						parsed: wantsParsedParts(query.parsed),
					}),
				);
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
			path: '/v1/sessions/{id}/messages/page',
			tags: ['messages'],
			operationId: 'listMessagePage',
			summary: 'List an adaptive newest-first page of message turns and parts',
			request: {
				params: messageParamsSchema,
				query: listMessagePageQuerySchema,
			},
			responses: {
				'200': {
					description:
						'A chronological page sized by a soft part target and complete turn boundaries',
					content: { 'application/json': { schema: messagePageSchema } },
				},
				'400': {
					description: 'Invalid cursor',
					content: { 'application/json': { schema: messageErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db } = await resolveRequestProject(c);
				const query = c.req.valid('query');
				const cursor = parseMessageCursor(query.cursor);
				if (query.cursor && !cursor) {
					return c.json({ error: 'Invalid message cursor' }, 400);
				}
				const { id: sessionId } = c.req.valid('param');
				const legacyCursorSequence =
					cursor && cursor.sequence === undefined && cursor.messageId
						? await db
								.select({ sequence: messageSequence })
								.from(messages)
								.where(
									and(
										eq(messages.sessionId, sessionId),
										eq(messages.id, cursor.messageId),
									),
								)
								.then((rows) => rows[0]?.sequence)
						: undefined;
				const cursorSequence = cursor?.sequence ?? legacyCursorSequence;
				const cursorFilter = cursor
					? or(
							lt(messages.createdAt, cursor.createdAt),
							and(
								eq(messages.createdAt, cursor.createdAt),
								lt(messageSequence, cursorSequence ?? -1),
							),
						)
					: undefined;
				const summaries: MessageSummary[] = [];
				let selected: MessageSummary[] = [];
				let exhausted = false;
				let batchFilter = cursorFilter;
				while (!exhausted) {
					const messageRows = await db
						.select({
							message: messages,
							sequence: messageSequence,
						})
						.from(messages)
						.where(
							batchFilter
								? and(eq(messages.sessionId, sessionId), batchFilter)
								: eq(messages.sessionId, sessionId),
						)
						.orderBy(desc(messages.createdAt), desc(messageSequence))
						.limit(MESSAGE_SUMMARY_BATCH_SIZE);
					const messageIds = messageRows.map((row) => row.message.id);
					const partCountRows = messageIds.length
						? await db
								.select({
									messageId: messageParts.messageId,
									partCount: count(messageParts.id),
								})
								.from(messageParts)
								.where(inArray(messageParts.messageId, messageIds))
								.groupBy(messageParts.messageId)
						: [];
					const partCounts = new Map(
						partCountRows.map((row) => [row.messageId, Number(row.partCount)]),
					);
					summaries.push(
						...messageRows.map((row) => ({
							message: row.message,
							partCount: partCounts.get(row.message.id) ?? 0,
							sequence: Number(row.sequence),
						})),
					);
					selected = selectCompleteTurnPage(summaries, query.limit);
					exhausted = messageRows.length < MESSAGE_SUMMARY_BATCH_SIZE;
					if (selected.length < summaries.length) break;
					const oldestBatchMessage = messageRows.at(-1);
					if (oldestBatchMessage) {
						batchFilter = or(
							lt(messages.createdAt, oldestBatchMessage.message.createdAt),
							and(
								eq(messages.createdAt, oldestBatchMessage.message.createdAt),
								lt(messageSequence, Number(oldestBatchMessage.sequence)),
							),
						);
					}
				}
				const hasMore = selected.length < summaries.length || !exhausted;
				const oldest = selected.at(-1);
				const rows = selected.map((summary) => summary.message).reverse();
				const selectedPartCount = selected.reduce(
					(total, summary) => total + summary.partCount,
					0,
				);
				const items = await serializeMessages(db, rows, {
					includeParts: query.without !== 'parts',
					parsed: wantsParsedParts(query.parsed),
					maxInlinePartBytes: MAX_INLINE_PART_BYTES,
				});
				return c.json({
					items,
					partCount: selectedPartCount,
					hasMore,
					nextCursor:
						hasMore && oldest
							? encodeMessageCursor({
									createdAt: oldest.message.createdAt,
									sequence: oldest.sequence,
									messageId: oldest.message.id,
								})
							: null,
				});
			} catch (error) {
				logger.error('Failed to list session message page', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{id}/parts/{partId}/content',
			tags: ['messages'],
			operationId: 'getMessagePartContent',
			summary: 'Get the complete stored content for a truncated message part',
			request: {
				params: partContentParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'Complete persisted part content',
					content: { 'text/plain': { schema: z.string() } },
				},
				'404': {
					description: 'Message part not found',
					content: { 'application/json': { schema: messageErrorSchema } },
				},
			},
		},
		async (c) => {
			const { db } = await resolveRequestProject(c);
			const [part] = await db
				.select({ content: messageParts.content })
				.from(messageParts)
				.innerJoin(messages, eq(messageParts.messageId, messages.id))
				.where(
					and(
						eq(messages.sessionId, c.req.param('id')),
						eq(messageParts.id, c.req.param('partId')),
					),
				)
				.limit(1);
			if (!part) return c.json({ error: 'Message part not found' }, 404);
			return c.text(part.content);
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
				const { cfg, db, runtime, projectRoot } =
					await resolveRequestProject(c);
				const { id: sessionId } = c.req.valid('param');
				c.req.valid('query');
				const body = c.req.valid('json');
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

				const sess: SessionRow = await sessionRepository(
					db,
					projectRoot,
				).require(sessionId);
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
				const images = Array.isArray(body.images)
					? (body.images as NonNullable<DispatchOptions['images']>)
					: undefined;
				const files = Array.isArray(body.files)
					? (body.files as NonNullable<DispatchOptions['files']>)
					: undefined;

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
