import { generateText, streamText } from 'ai';
import { asc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import {
	getConfiguredFastModelForAuth,
	type OttoConfig,
	type ProviderId,
} from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { adaptSimpleCall, detectOAuth } from '../provider/oauth-adapter.ts';
import { resolveModel } from '../provider/index.ts';

const TITLE_CONCURRENCY_LIMIT = 1;
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
		try {
			await generateSessionTitle({ cfg, db, sessionId, content });
		} catch {
		} finally {
			titleInFlight.delete(sessionId);
			titleActiveCount--;
			processNext();
		}
	};

	titlePending.add(sessionId);
	titleQueue.push(task);
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

async function generateSessionTitle(args: {
	cfg: OttoConfig;
	db: DB;
	sessionId: string;
	content: unknown;
}): Promise<void> {
	const { cfg, db, sessionId, content } = args;

	try {
		const existingSession = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId));

		if (!existingSession.length) {
			return;
		}

		const sess = existingSession[0];
		if (sess.title && sess.title !== 'New Session') {
			return;
		}

		const provider = (sess.provider ?? cfg.defaults.provider) as ProviderId;
		const modelName = sess.model ?? cfg.defaults.model;

		const { getAuth } = await import('@ottocode/sdk');
		const auth = await getAuth(provider, cfg.projectRoot);
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
				});
				modelTitle = (out?.text || '').trim();
			}
		} catch {}

		if (!modelTitle) {
			return;
		}

		const sanitized = sanitizeTitle(modelTitle);

		if (!sanitized || sanitized === 'New Session') {
			return;
		}

		await db
			.update(sessions)
			.set({ title: sanitized, lastActiveAt: Date.now() })
			.where(eq(sessions.id, sessionId));

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
			.orderBy(asc(messages.createdAt))
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
