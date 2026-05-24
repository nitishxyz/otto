import type { DB } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { getAuth, type OttoConfig, type ProviderId } from '@ottocode/sdk';
import { streamText } from 'ai';
import { desc, eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import {
	buildCompactionContext,
	getModelLimits,
} from '../message/compaction.ts';
import { detectOAuth, adaptSimpleCall } from '../provider/oauth-adapter.ts';
import { resolveModel } from '../provider/index.ts';
import { createSession } from './manager.ts';

type SessionRow = typeof sessions.$inferSelect;

const HANDOFF_INPUT_TOKEN_LIMIT = 50_000;
const HANDOFF_OUTPUT_TOKEN_LIMIT = 4_000;
const HANDOFF_MAX_CONTEXT_CHARS = 24_000;

export type HandoffResult = {
	session: SessionRow;
	sourceSessionId: string;
	context: string;
	message: string;
};

export function isHandoffCommand(content: string): boolean {
	return content.trim().toLowerCase() === '/handoff';
}

export function buildHandoffContext(args: {
	sourceSession: SessionRow;
	context: string;
	createdAt?: Date;
}): string {
	const { sourceSession, context, createdAt = new Date() } = args;
	return [
		'# Session Handoff',
		'',
		'You are continuing work from a previous otto session. Treat this as inherited context, not as a new user request.',
		'',
		`Source session: ${sourceSession.id}`,
		`Created: ${createdAt.toISOString()}`,
		`Project: ${sourceSession.projectPath}`,
		`Inherited agent/model: ${sourceSession.agent} / ${sourceSession.provider}:${sourceSession.model}`,
		'',
		'Continue from the current state. Do not redo completed work unless the user asks or verification requires it.',
		'',
		'## Carried context',
		'',
		context.trim() || 'No prior message context was available.',
	].join('\n');
}

export function getHandoffSystemPrompt(): string {
	return [
		'You are preparing a concise handoff for a new coding-agent session.',
		'',
		'Your job is to summarize only the information needed to continue the work in a fresh session.',
		'Do not copy raw logs or long tool outputs unless a specific detail is critical.',
		'',
		'Include these sections:',
		'1. Current goal',
		'2. Current state',
		'3. Important decisions and constraints',
		'4. Files or areas touched',
		'5. Commands/checks run and their outcome',
		'6. Open tasks, blockers, and next best action',
		'',
		'Rules:',
		'- Be specific and practical for a coding agent.',
		'- Preserve exact file paths, commands, IDs, and user constraints when relevant.',
		'- Say when verification was not run or the state is uncertain.',
		'- Keep the final handoff under roughly 4000 tokens.',
		'- Output markdown only. Start with "# Handoff".',
	].join('\n');
}

export function buildHandoffUserPrompt(args: {
	sourceSession: SessionRow;
	rawContext: string;
}): string {
	const { sourceSession, rawContext } = args;
	return [
		'Prepare a handoff summary for this otto session.',
		'',
		`Source session: ${sourceSession.id}`,
		`Project: ${sourceSession.projectPath}`,
		`Agent/model: ${sourceSession.agent} / ${sourceSession.provider}:${sourceSession.model}`,
		'',
		'<session-context-to-summarize>',
		rawContext.trim() || 'No prior message context was available.',
		'</session-context-to-summarize>',
	].join('\n');
}

function clampHandoffSummary(summary: string): string {
	const trimmed = summary.trim();
	if (trimmed.length <= HANDOFF_MAX_CONTEXT_CHARS) return trimmed;
	return [
		trimmed.slice(0, HANDOFF_MAX_CONTEXT_CHARS).trimEnd(),
		'',
		'_Handoff summary truncated to fit context budget._',
	].join('\n');
}

function normalizeHandoffSummary(summary: string): string {
	const trimmed = clampHandoffSummary(summary);
	if (trimmed.startsWith('# Handoff')) return trimmed;
	return ['# Handoff', '', trimmed].join('\n');
}

function buildHandoffVisibleMessage(sourceSessionId: string): string {
	return [
		'🔁 **Handoff ready**',
		'',
		`This session was created from ${sourceSessionId}.`,
		'I have the previous session context loaded and can continue from here.',
	].join('\n');
}

async function insertTextMessage(args: {
	db: DB;
	sessionId: string;
	role: 'system' | 'user' | 'assistant';
	status?: 'complete' | 'pending' | 'error';
	agent: string;
	provider: string;
	model: string;
	text: string;
	createdAt?: number;
}): Promise<string> {
	const {
		db,
		sessionId,
		role,
		status = 'complete',
		agent,
		provider,
		model,
		text,
		createdAt = Date.now(),
	} = args;
	const messageId = crypto.randomUUID();
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role,
		status,
		agent,
		provider,
		model,
		createdAt,
		completedAt: status === 'pending' ? null : createdAt,
	});
	await db.insert(messageParts).values({
		id: crypto.randomUUID(),
		messageId,
		index: 0,
		type: 'text',
		content: JSON.stringify({ text }),
		agent,
		provider,
		model,
		startedAt: createdAt,
		completedAt: status === 'pending' ? null : createdAt,
	});
	publish({
		type: 'message.created',
		sessionId,
		payload: { id: messageId, role, agent, provider, model, content: text },
	});
	if (status !== 'pending') {
		publish({
			type: 'message.completed',
			sessionId,
			payload: { id: messageId, status },
		});
	}
	return messageId;
}

async function getLatestMessageId(
	db: DB,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt))
		.limit(1);
	return rows[0]?.id ?? null;
}

export async function prepareHandoffSummary(args: {
	cfg: OttoConfig;
	db: DB;
	sourceSession: SessionRow;
}): Promise<string> {
	const { cfg, db, sourceSession } = args;
	const provider = sourceSession.provider as ProviderId;
	const modelId = sourceSession.model;
	const limits = getModelLimits(provider, modelId);
	const contextTokenLimit = limits
		? Math.min(
				Math.max(Math.floor(limits.context * 0.5), 15000),
				HANDOFF_INPUT_TOKEN_LIMIT,
			)
		: HANDOFF_INPUT_TOKEN_LIMIT;
	const rawContext = await buildCompactionContext(
		db,
		sourceSession.id,
		contextTokenLimit,
	);

	const auth = await getAuth(provider, cfg.projectRoot);
	const oauth = detectOAuth(provider, auth);
	const model = await resolveModel(provider, modelId, cfg);
	const adapted = adaptSimpleCall(oauth, {
		instructions: getHandoffSystemPrompt(),
		userContent: buildHandoffUserPrompt({ sourceSession, rawContext }),
		maxOutputTokens: HANDOFF_OUTPUT_TOKEN_LIMIT,
	});

	const result = streamText({
		model,
		system: adapted.system,
		messages: adapted.messages,
		maxOutputTokens: adapted.maxOutputTokens,
		providerOptions: adapted.providerOptions,
	});

	let summary = '';
	for await (const chunk of result.textStream) {
		summary += chunk;
	}

	const normalized = normalizeHandoffSummary(summary);
	if (normalized.length < 50) {
		throw new Error('Failed to generate handoff summary');
	}
	return normalized;
}

export async function createHandoffSession(args: {
	cfg: OttoConfig;
	db: DB;
	sourceSession: SessionRow;
}): Promise<HandoffResult> {
	const { cfg, db, sourceSession } = args;
	const provider = sourceSession.provider as ProviderId;
	const model = sourceSession.model;
	const preparedSummary = await prepareHandoffSummary({
		cfg,
		db,
		sourceSession,
	});
	const handoffContext = buildHandoffContext({
		sourceSession,
		context: preparedSummary,
	});
	const branchPointMessageId = await getLatestMessageId(db, sourceSession.id);

	const now = Date.now();
	await insertTextMessage({
		db,
		sessionId: sourceSession.id,
		role: 'user',
		agent: sourceSession.agent,
		provider: sourceSession.provider,
		model: sourceSession.model,
		text: '/handoff',
		createdAt: now,
	});
	await insertTextMessage({
		db,
		sessionId: sourceSession.id,
		role: 'assistant',
		agent: sourceSession.agent,
		provider: sourceSession.provider,
		model: sourceSession.model,
		text: 'Handoff created. Opening the new session…',
		createdAt: now + 1,
	});

	const created = await createSession({
		db,
		cfg,
		agent: sourceSession.agent,
		provider,
		model,
		title: `Handoff: ${sourceSession.title || 'Untitled'}`,
	});

	await db
		.update(sessions)
		.set({
			contextSummary: handoffContext,
			parentSessionId: sourceSession.id,
			branchPointMessageId,
			sessionType: 'handoff',
			lastActiveAt: Date.now(),
		})
		.where(eq(sessions.id, created.id));

	const session: SessionRow = {
		...created,
		contextSummary: handoffContext,
		parentSessionId: sourceSession.id,
		branchPointMessageId,
		sessionType: 'handoff',
	};

	const visibleMessage = buildHandoffVisibleMessage(sourceSession.id);
	await insertTextMessage({
		db,
		sessionId: session.id,
		role: 'system',
		agent: session.agent,
		provider: session.provider,
		model: session.model,
		text: visibleMessage,
	});

	publish({
		type: 'session.updated',
		sessionId: session.id,
		payload: session,
	});

	return {
		session,
		sourceSessionId: sourceSession.id,
		context: handoffContext,
		message: visibleMessage,
	};
}
