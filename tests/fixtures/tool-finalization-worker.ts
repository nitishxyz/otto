/**
 * Subprocess for tests/harness-tool-finalization-durability.test.ts. Runs one
 * adapted tool call against a file-backed DB and optionally SIGKILLs itself
 * at a finalization boundary. Configured via TF_* environment variables.
 */
import {
	appendFileSync,
	chmodSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { setToolMetadata } from '@ottocode/sdk';
import { getDbByPath } from '@ottocode/database';
import { messages, sessions, subagents } from '@ottocode/database/schema';
import { adaptTools } from '../../packages/server/src/tools/adapter.ts';
import { setToolFinalizationBoundaryHook } from '../../packages/server/src/runtime/persistence/tool-finalization-journal.ts';

const env = process.env;
const dbPath = String(env.TF_DB_PATH);
const counterPath = String(env.TF_COUNTER_PATH);
const killAt = env.TF_KILL_AT ?? 'none';
const callId = String(env.TF_CALL_ID);
const imageData = readFileSync(String(env.TF_IMAGE_PATH), 'utf8');
const sessionId = 'tf-session';
const messageId = env.TF_MESSAGE_ID || 'tf-message';

function die(): never {
	process.kill(process.pid, 'SIGKILL');
	throw new Error('unreachable');
}

const db = await getDbByPath(dbPath);
await db
	.insert(sessions)
	.values({
		id: sessionId,
		title: 't',
		agent: 'build',
		provider: 'test',
		model: 'test',
		projectPath: '/tmp/tf-project',
		createdAt: 1,
		lastActiveAt: 1,
		sessionType: 'main',
	})
	.onConflictDoNothing();
await db
	.insert(messages)
	.values({
		id: messageId,
		sessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'test',
		model: 'test',
		createdAt: Date.now(),
	})
	.onConflictDoNothing();
if (env.TF_SUBAGENT === '1') {
	const now = Date.now();
	await db.insert(sessions).values({
		id: `${messageId}-child`,
		title: 'child',
		agent: 'build',
		provider: 'test',
		model: 'test',
		projectPath: '/tmp/tf-project',
		createdAt: now,
		lastActiveAt: now,
		sessionType: 'subagent',
	});
	await db.insert(subagents).values({
		id: `${messageId}-subagent`,
		parentSessionId: sessionId,
		childSessionId: `${messageId}-child`,
		agent: 'build',
		task: 'work',
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});
}

if (env.TF_FAIL_DB === '1') {
	// Every later write fails as if the primary DB were unwritable.
	(db as unknown as { $client: { exec(sql: string): void } }).$client.exec(
		'PRAGMA query_only = ON',
	);
}

setToolFinalizationBoundaryHook((boundary) => {
	if (boundary === killAt) die();
});

const mutate = tool({
	description: 'external mutation',
	inputSchema: z.object({ apiKey: z.string() }),
	execute: async ({ apiKey }: { apiKey: string }) => {
		appendFileSync(counterPath, 'x');
		if (killAt === 'execute') die();
		if (killAt === 'hang') {
			writeFileSync(`${counterPath}.ready`, String(process.pid));
			await new Promise(() => undefined);
		}
		if (env.TF_BREAK_JOURNAL === '1') {
			// The outcome record (and later cleanup) can no longer be written.
			chmodSync(join(dirname(dbPath), 'tool-journal'), 0o500);
		}
		return {
			ok: true,
			echoed: `used ${apiKey}`,
			artifact: {
				kind: 'browser_screenshot',
				data: imageData,
				mediaType: 'image/png',
			},
		};
	},
} as never) as Tool;
setToolMetadata(mutate, {
	source: 'builtin',
	sensitiveInputs: [{ path: 'apiKey' }],
});

let index = 0;
const tools = adaptTools([{ name: 'mutate', tool: mutate }], {
	sessionId,
	messageId,
	assistantPartId: 'tf-assistant',
	db,
	agent: 'build',
	provider: 'test',
	model: 'test',
	projectRoot: '/tmp/tf-project',
	nextIndex: () => index++,
	stepIndex: 0,
});

try {
	const result = await tools.mutate?.execute?.(
		{ apiKey: env.TF_SECRET } as never,
		{
			toolCallId: callId,
			messages: [],
		} as never,
	);
	console.log(JSON.stringify({ status: 'ok', result }));
} catch (error) {
	console.log(
		JSON.stringify({
			status: 'error',
			name: (error as Error).name,
			code: (error as { code?: string }).code,
		}),
	);
}
