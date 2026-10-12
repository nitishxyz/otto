import { generateText, streamText } from 'ai';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import {
	getConfiguredFastModelForAuth,
	type OttoConfig,
	type ProviderId,
} from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { adaptSimpleCall, detectOAuth } from '../provider/oauth-adapter.ts';
import {
	captureQueuedCredentials,
	getRunProviderAuth,
	withQueuedCredentials,
} from '../provider/credentials.ts';
import { resolveModel } from '../provider/index.ts';

const TITLE_CONCURRENCY_LIMIT = 1;
/** Upper bound for one title request so a hung provider cannot block the queue. */
export const TITLE_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TITLE = 'New Session';
const titleQueue: Array<() => void> = [];
let titleActiveCount = 0;
const titleInFlight = new Set<string>();
const titlePending = new Set<string>();

function scheduleSessionTitle(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
	content: unknown;
}) {
	const { cfg, db, sessionId, content } = args;

	if (titleInFlight.has(sessionId) || titlePending.has(sessionId)) {
		return;
	}

	const processNext = () => {
		if (titleQueue.length === 0) {
			return;
		}
		if (titleActiveCount >= TITLE_CONCURRENCY_LIMIT) {
			return;
		}
		const next = titleQueue.shift();
		if (!next) return;
		titleActiveCount++;
		next();
	};

	const task = async () => {
		titleInFlight.add(sessionId);
		titlePending.delete(sessionId);
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				generateSessionTitle({
					cfg,
					db,
					sessionId,
					content,
					abortSignal: controller.signal,
				}),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						controller.abort();
						resolve();
					}, TITLE_REQUEST_TIMEOUT_MS);
				}),
			]);
		} catch {
		} finally {
			if (timer) clearTimeout(timer);
			titleInFlight.delete(sessionId);
			titleActiveCount--;
			processNext();
		}
	};

	// Each title runs under the credentials of the request that scheduled it,
	// not the context of whichever task happens to dequeue it.
	const job = {};
	captureQueuedCredentials(job);
	titlePending.add(sessionId);
	titleQueue.push(() => {
		void withQueuedCredentials(job, task);
	});
	processNext();
}

function enqueueSessionTitle(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
	content: unknown;
}) {
	scheduleSessionTitle(args);
}

/**
 * Generates and stores a session title. The write is conditional: a title set
 * by the user while generation was running is never overwritten.
 */
export async function generateSessionTitle(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
	content: unknown;
	abortSignal?: AbortSignal;
}): Promise<void> {
	const { cfg, db, sessionId, content, abortSignal } = args;

	try {
		const existingSession = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId));

		if (!existingSession.length) {
			return;
		}

		const sess = existingSession[0];
		if (sess.title && sess.title !== DEFAULT_TITLE) {
			return;
		}

		const provider = (sess.provider ?? cfg.defaults.provider) as ProviderId;
		const modelName = sess.model ?? cfg.defaults.model;

		const auth = await getRunProviderAuth(provider, cfg.projectRoot);
		const oauth = detectOAuth(provider, auth);

		const titleModel =
			getConfiguredFastModelForAuth(cfg, provider, auth?.type) ?? modelName;
		const model = await resolveModel(provider, titleModel, cfg);

		const promptText = String(content ?? '').slice(0, 2000);

		const titleInstructions = `Generate a brief title (6-8 words) summarizing what the user wants to do.
Rules: Plain text only. No markdown, no quotes, no punctuation, no emojis.
Focus on the core task or topic. Be specific but concise.
Examples: "Fix TypeScript build errors", "Add dark mode toggle", "Refactor auth middleware"

Output ONLY the title, nothing else.`;

		const adapted = adaptSimpleCall(oauth, {
			instructions: titleInstructions,
			userContent: promptText,
		});

		let modelTitle = '';
		try {
			if (adapted.forceStream || oauth.needsSpoof) {
				const result = streamText({
					model,
					system: adapted.system,
					messages: adapted.messages,
					providerOptions: adapted.providerOptions,
					abortSignal,
				});
				for await (const chunk of result.textStream) {
					modelTitle += chunk;
				}
				modelTitle = modelTitle.trim();
			} else {
				const out = await generateText({
					model,
					system: adapted.system,
					messages: adapted.messages,
					providerOptions: adapted.providerOptions,
					abortSignal,
				});
				modelTitle = (out?.text || '').trim();
			}
		} catch {}

		if (!modelTitle || abortSignal?.aborted) {
			return;
		}

		const sanitized = sanitizeTitle(modelTitle);

		if (!sanitized || sanitized === DEFAULT_TITLE) {
			return;
		}

		const updated = await db
			.update(sessions)
			.set({ title: sanitized, lastActiveAt: Date.now() })
			.where(
				and(
					eq(sessions.id, sessionId),
					or(isNull(sessions.title), eq(sessions.title, DEFAULT_TITLE)),
				),
			)
			.returning({ id: sessions.id });
		if (updated.length === 0) return;

		publish({
			type: 'session.updated',
			sessionId,
			payload: { id: sessionId, title: sanitized },
		});
	} catch {}
}

function sanitizeTitle(raw: string): string {
	let s = raw.trim();
	s = s.replace(/^#+\s*/, '');
	s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
	s = s.replace(/\*([^*]+)\*/g, '$1');
	s = s.replace(/__([^_]+)__/g, '$1');
	s = s.replace(/_([^_]+)_/g, '$1');
	s = s.replace(/`([^`]+)`/g, '$1');
	s = s.replace(/~~([^~]+)~~/g, '$1');
	s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
	s = s.replace(/^["']|["']$/g, '');
	s = s.replace(/^[-–—•*]\s*/, '');
	s = s.replace(/[.!?:;,]+$/, '');
	s = s.replace(/\s+/g, ' ');
	if (s.length > 80) s = s.slice(0, 80).trim();
	return s;
}

export async function triggerDeferredTitleGeneration(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
}): Promise<void> {
	const { cfg, db, sessionId } = args;

	try {
		const userMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, sessionId))
			.orderBy(asc(messages.sequence), asc(messages.createdAt))
			.limit(1);

		if (!userMessages.length || userMessages[0].role !== 'user') {
			return;
		}

		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, userMessages[0].id))
			.orderBy(asc(messageParts.index))
			.limit(1);

		if (!parts.length) {
			return;
		}

		let content = '';
		try {
			const parsed = JSON.parse(parts[0].content ?? '{}');
			content = String(parsed.text ?? '');
		} catch {
			return;
		}

		if (!content) {
			return;
		}
		enqueueSessionTitle({ cfg, db, sessionId, content });
	} catch {}
}
