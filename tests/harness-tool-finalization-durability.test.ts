import { afterAll, describe, expect, test } from 'bun:test';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { loadConfig } from '@ottocode/sdk';
import { getDbByPath } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { adaptTools } from '../packages/server/src/tools/adapter.ts';
import {
	recoverInterruptedRuns,
	recoverJournaledToolResults,
} from '../packages/server/src/runtime/projects/recovery.ts';
import { ProjectManager } from '../packages/server/src/runtime/projects/manager.ts';
import { getServerInfo, setDaemonId } from '../packages/server/src/state.ts';
import {
	currentToolJournalOwner,
	isToolJournalOwnerAlive,
	TOOL_JOURNAL_DIRNAME,
	toolJournalFileName,
	writeToolJournalRecord,
} from '../packages/server/src/runtime/persistence/tool-finalization-journal.ts';
import {
	recoverToolFinalizations,
	TOOL_JOURNAL_QUARANTINE_RETENTION_MS,
} from '../packages/server/src/runtime/persistence/tool-finalization-recovery.ts';

const WORKER = join(import.meta.dir, 'fixtures', 'tool-finalization-worker.ts');
const SECRET = 'sk-live-durability-secret';
// ~2 MB of base64: proves complete (not truncated/bounded) image recovery.
const IMAGE = randomBytes(1_500_000).toString('base64');
const canChmodBlock = process.platform !== 'win32' && process.getuid?.() !== 0;
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeRoot() {
	const root = mkdtempSync(join(tmpdir(), 'otto-tool-journal-'));
	roots.push(root);
	const stateDir = join(root, 'state');
	mkdirSync(stateDir, { recursive: true });
	const imagePath = join(root, 'image.b64');
	writeFileSync(imagePath, IMAGE);
	return {
		root,
		dbPath: join(stateDir, 'otto.sqlite'),
		journalDir: join(stateDir, TOOL_JOURNAL_DIRNAME),
		counterPath: join(root, 'executions'),
		imagePath,
	};
}

/** Paths whose DB is the real project DB resolved by loadConfig. */
async function makeProject() {
	const paths = makeRoot();
	const project = join(paths.root, 'project');
	mkdirSync(project);
	const cfg = await loadConfig(realpathSync(project));
	const dbPath = cfg.paths.dbPath;
	return {
		...paths,
		project: cfg.projectRoot,
		dbPath,
		journalDir: join(dirname(dbPath), TOOL_JOURNAL_DIRNAME),
	};
}

function executions(counterPath: string): number {
	return existsSync(counterPath) ? readFileSync(counterPath, 'utf8').length : 0;
}

function journalFiles(dir: string, suffix = '.json'): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((name) => name.endsWith(suffix));
}

type WorkerOptions = {
	killAt?: string;
	failDb?: boolean;
	breakJournal?: boolean;
	callId?: string;
	messageId?: string;
	subagent?: boolean;
	counterPath?: string;
};

function spawnWorker(
	paths: ReturnType<typeof makeRoot>,
	options: WorkerOptions,
) {
	return Bun.spawn([process.execPath, WORKER], {
		cwd: join(import.meta.dir, '..'),
		env: {
			...process.env,
			TF_DB_PATH: paths.dbPath,
			TF_COUNTER_PATH: options.counterPath ?? paths.counterPath,
			TF_KILL_AT: options.killAt ?? 'none',
			TF_FAIL_DB: options.failDb ? '1' : '0',
			TF_BREAK_JOURNAL: options.breakJournal ? '1' : '0',
			TF_CALL_ID: options.callId ?? 'call-1',
			TF_MESSAGE_ID: options.messageId ?? 'tf-message',
			TF_SUBAGENT: options.subagent ? '1' : '0',
			TF_SECRET: SECRET,
			TF_IMAGE_PATH: paths.imagePath,
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});
}

async function runWorker(
	paths: ReturnType<typeof makeRoot>,
	options: WorkerOptions,
) {
	const child = spawnWorker(paths, options);
	const [exitCode, stdout] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	return { exitCode, signal: child.signalCode, stdout: stdout.trim() };
}

async function toolResults(dbPath: string) {
	const db = await getDbByPath(dbPath);
	const parts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, 'tf-message'));
	return { db, parts: parts.filter((part) => part.type === 'tool_result') };
}

/** Daemon-mode restart: full interrupted-run recovery. */
async function reopenAndRecover(dbPath: string) {
	const db = await getDbByPath(dbPath);
	recoverInterruptedRuns(db, Date.now() + 1);
	return toolResults(dbPath);
}

/** Standalone/embedded restart: open the project with no daemon id. */
async function reopenProject(project: string, dbPath: string) {
	const manager = new ProjectManager();
	const daemonId = getServerInfo().daemonId;
	setDaemonId(null);
	try {
		await manager.openProject({ path: project });
	} finally {
		setDaemonId(daemonId);
		await manager.closeAllProjects();
	}
	return toolResults(dbPath);
}

async function waitFor(path: string, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() > deadline) throw new Error(`timed out waiting: ${path}`);
		await Bun.sleep(20);
	}
}

describe('tool finalization journal (subprocess crash/reopen)', () => {
	test('completes normally and leaves no journal record', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, {});
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toMatchObject({ status: 'ok' });
		expect(executions(paths.counterPath)).toBe(1);
		expect(journalFiles(paths.journalDir)).toEqual([]);
		const { parts } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
	});

	test('kill after intent, before execution: unknown outcome, no run', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, { killAt: 'intent' });
		expect(run.signal).toBe('SIGKILL');
		expect(executions(paths.counterPath)).toBe(0);
		const [file] = journalFiles(paths.journalDir);
		expect(file).toBe(toolJournalFileName('tf-message', 'call-1'));
		const intent = JSON.parse(
			readFileSync(join(paths.journalDir, file), 'utf8'),
		);
		expect(intent.state).toBe('intent');
		if (process.platform !== 'win32') {
			expect(statSync(join(paths.journalDir, file)).mode & 0o777).toBe(0o600);
			expect(statSync(paths.journalDir).mode & 0o777).toBe(0o700);
		}

		const { parts, db } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
		const content = JSON.parse(parts[0]?.content ?? '{}');
		expect(content.result).toMatchObject({
			ok: false,
			details: { reason: 'outcome_unknown' },
		});
		expect(executions(paths.counterPath)).toBe(0);
		expect(journalFiles(paths.journalDir)).toEqual([]);
		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, 'tf-message'));
		expect(message?.status).toBe('error');
	});

	test('kill after external mutation: unknown, never re-run', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, { killAt: 'execute' });
		expect(run.signal).toBe('SIGKILL');
		expect(executions(paths.counterPath)).toBe(1);
		const { parts } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
		const content = JSON.parse(parts[0]?.content ?? '{}');
		expect(content.result.details.reason).toBe('outcome_unknown');
		expect(content.result.ok).toBe(false);
		expect(executions(paths.counterPath)).toBe(1);
	});

	test('kill after outcome journaled: replays redacted result with image bytes', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, { killAt: 'outcome' });
		expect(run.signal).toBe('SIGKILL');
		expect(executions(paths.counterPath)).toBe(1);
		const [file] = journalFiles(paths.journalDir);
		const raw = readFileSync(join(paths.journalDir, file ?? ''), 'utf8');
		expect(raw).not.toContain(SECRET);
		expect(raw).toContain(IMAGE);
		expect(JSON.parse(raw).state).toBe('outcome');

		const { parts } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
		const part = parts[0];
		expect(part?.content).not.toContain(SECRET);
		const content = JSON.parse(part?.content ?? '{}');
		expect(content.result).toMatchObject({
			ok: true,
			echoed: 'used [redacted]',
		});
		expect(content.result.artifact.data).toBe(IMAGE);
		expect(content.args).toEqual({ apiKey: '[redacted]' });
		expect(part?.toolCallId).toBe('call-1');
		expect(executions(paths.counterPath)).toBe(1);
		expect(journalFiles(paths.journalDir)).toEqual([]);
	});

	test('kill after DB commit, before journal cleanup: no duplicate row', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, { killAt: 'commit' });
		expect(run.signal).toBe('SIGKILL');
		expect(journalFiles(paths.journalDir)).toHaveLength(1);
		const { parts, db } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
		expect(JSON.parse(parts[0]?.content ?? '{}').result.ok).toBe(true);
		expect(journalFiles(paths.journalDir)).toEqual([]);
		expect(executions(paths.counterPath)).toBe(1);
		const again = recoverToolFinalizations(db);
		expect(again.recovered + again.unknown + again.alreadyCommitted).toBe(0);
	});

	test('persistent primary DB failure is recovered from the journal on reopen', async () => {
		const paths = makeRoot();
		const run = await runWorker(paths, { failDb: true });
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toMatchObject({
			status: 'error',
			name: 'ToolResultDurabilityError',
			code: 'TOOL_RESULT_DURABILITY_FAILED',
		});
		expect(executions(paths.counterPath)).toBe(1);
		expect(journalFiles(paths.journalDir)).toHaveLength(1);

		const { parts } = await reopenAndRecover(paths.dbPath);
		expect(parts).toHaveLength(1);
		const content = JSON.parse(parts[0]?.content ?? '{}');
		expect(content.result.ok).toBe(true);
		expect(content.result.artifact.data).toBe(IMAGE);
		expect(executions(paths.counterPath)).toBe(1);
		expect(journalFiles(paths.journalDir)).toEqual([]);
	});

	test('standalone (non-daemon) reopen recovers journaled results', async () => {
		const paths = await makeProject();
		const run = await runWorker(paths, { failDb: true });
		expect(JSON.parse(run.stdout)).toMatchObject({
			name: 'ToolResultDurabilityError',
		});
		expect(journalFiles(paths.journalDir)).toHaveLength(1);

		const { parts, db } = await reopenProject(paths.project, paths.dbPath);
		expect(parts).toHaveLength(1);
		const content = JSON.parse(parts[0]?.content ?? '{}');
		expect(content.result.ok).toBe(true);
		expect(content.result.artifact.data).toHaveLength(IMAGE.length);
		expect(content.result.artifact.data).toBe(IMAGE);
		expect(executions(paths.counterPath)).toBe(1);
		expect(journalFiles(paths.journalDir)).toEqual([]);
		// Non-daemon open never applies daemon run interruption.
		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, 'tf-message'));
		expect(message?.status).toBe('pending');
	});

	test('a live owner on the same DB is never converted to unknown', async () => {
		const paths = await makeProject();
		const child = spawnWorker(paths, { killAt: 'hang' });
		try {
			await waitFor(`${paths.counterPath}.ready`);
			const [file] = journalFiles(paths.journalDir);
			const intentPath = join(paths.journalDir, file ?? '');
			const before = readFileSync(intentPath, 'utf8');
			expect(JSON.parse(before)).toMatchObject({
				state: 'intent',
				pid: child.pid,
			});

			const { parts, db } = await reopenProject(paths.project, paths.dbPath);
			expect(parts).toHaveLength(0);
			expect(recoverJournaledToolResults(db)).toMatchObject({
				skipped: 1,
				unknown: 0,
			});
			expect(readFileSync(intentPath, 'utf8')).toBe(before);
		} finally {
			child.kill('SIGKILL');
			await child.exited;
		}

		const { parts } = await reopenProject(paths.project, paths.dbPath);
		expect(parts).toHaveLength(1);
		expect(JSON.parse(parts[0]?.content ?? '{}').result.details.reason).toBe(
			'outcome_unknown',
		);
		expect(executions(paths.counterPath)).toBe(1);
	});

	test.if(canChmodBlock)(
		'outcome journal failure + DB failure: only unknown survives, never success',
		async () => {
			const paths = makeRoot();
			const run = await runWorker(paths, { failDb: true, breakJournal: true });
			expect(JSON.parse(run.stdout)).toMatchObject({
				name: 'ToolResultDurabilityError',
			});
			chmodSync(paths.journalDir, 0o700);
			const [file] = journalFiles(paths.journalDir);
			expect(
				JSON.parse(readFileSync(join(paths.journalDir, file ?? ''), 'utf8'))
					.state,
			).toBe('intent');

			const { parts } = await reopenAndRecover(paths.dbPath);
			expect(parts).toHaveLength(1);
			const content = JSON.parse(parts[0]?.content ?? '{}');
			expect(content.result).toMatchObject({
				ok: false,
				details: { reason: 'outcome_unknown' },
			});
			expect(executions(paths.counterPath)).toBe(1);
		},
	);

	test.if(canChmodBlock)(
		'outcome journal failure with healthy DB still commits once',
		async () => {
			const paths = makeRoot();
			const run = await runWorker(paths, { breakJournal: true });
			expect(JSON.parse(run.stdout)).toMatchObject({ status: 'ok' });
			chmodSync(paths.journalDir, 0o700);
			// Cleanup could not unlink the intent; recovery sees the committed row.
			expect(journalFiles(paths.journalDir)).toHaveLength(1);
			const { parts, db } = await toolResults(paths.dbPath);
			expect(parts).toHaveLength(1);
			expect(recoverToolFinalizations(db)).toMatchObject({
				alreadyCommitted: 1,
				unknown: 0,
			});
			expect((await toolResults(paths.dbPath)).parts).toHaveLength(1);
			expect(executions(paths.counterPath)).toBe(1);
		},
	);
});

describe('tool finalization journal (in-process)', () => {
	async function seed(dbPath: string) {
		const db = await getDbByPath(dbPath);
		await db.insert(sessions).values({
			id: 'tf-session',
			title: 't',
			agent: 'build',
			provider: 'test',
			model: 'test',
			projectPath: '/tmp/tf-project',
			createdAt: 1,
			lastActiveAt: 1,
			sessionType: 'main',
		});
		await db.insert(messages).values({
			id: 'tf-message',
			sessionId: 'tf-session',
			role: 'assistant',
			status: 'complete',
			agent: 'build',
			provider: 'test',
			model: 'test',
			createdAt: 1,
		});
		return db;
	}

	function intent(callId: string, overrides: Record<string, unknown> = {}) {
		return {
			v: 1 as const,
			state: 'intent' as const,
			sessionId: 'tf-session',
			messageId: 'tf-message',
			callId,
			name: 'mutate',
			partId: `part-${callId}`,
			agent: 'build',
			provider: 'test',
			model: 'test',
			startTs: 1,
			createdAt: 1,
			pid: 999_999,
			owner: DEAD_OWNER,
			...overrides,
		};
	}

	const DEAD_OWNER = randomUUID();
	const LIVE_OWNER = randomUUID();
	const ownerAlive = (owner: { owner: string }) => owner.owner === LIVE_OWNER;

	test('owner liveness is conservative', async () => {
		expect(isToolJournalOwnerAlive(currentToolJournalOwner())).toBe(true);
		expect(
			isToolJournalOwnerAlive({ owner: randomUUID(), pid: process.pid }),
		).toBe(false);
		const exited = Bun.spawn([process.execPath, '-e', '']);
		await exited.exited;
		expect(
			isToolJournalOwnerAlive({ owner: randomUUID(), pid: exited.pid }),
		).toBe(false);
		expect(
			isToolJournalOwnerAlive({ owner: randomUUID(), pid: process.ppid }),
		).toBe(true);
	});

	test('corrupted journal records fail safe and are quarantined', async () => {
		const paths = makeRoot();
		const db = await seed(paths.dbPath);
		await writeToolJournalRecord(paths.journalDir, intent('good'));
		writeFileSync(join(paths.journalDir, 'garbage.json'), '{not json');
		writeFileSync(
			join(paths.journalDir, toolJournalFileName('tf-message', 'bad-schema')),
			JSON.stringify({ ...intent('bad-schema'), state: 'done', extra: 1 }),
		);
		writeFileSync(
			join(paths.journalDir, toolJournalFileName('tf-message', 'renamed')),
			JSON.stringify(intent('other-call')),
		);
		const deadTemp = `${'a'.repeat(64)}.999999.${DEAD_OWNER}.${randomUUID()}.tmp`;
		const liveTemp = `${'b'.repeat(64)}.1.${LIVE_OWNER}.${randomUUID()}.tmp`;
		writeFileSync(join(paths.journalDir, deadTemp), 'partial');
		writeFileSync(join(paths.journalDir, liveTemp), 'in flight');
		writeFileSync(join(paths.journalDir, 'unparseable.tmp'), 'partial');
		await writeToolJournalRecord(
			paths.journalDir,
			intent('orphan', { messageId: 'deleted-message' }),
		);
		await writeToolJournalRecord(
			paths.journalDir,
			intent('current', { owner: LIVE_OWNER }),
		);

		const result = recoverToolFinalizations(db, {
			isOwnerAlive: ownerAlive,
		});
		expect(result).toMatchObject({
			unknown: 1,
			quarantined: 3,
			discarded: 1,
			skipped: 1,
		});
		expect(journalFiles(paths.journalDir, '.corrupt')).toHaveLength(3);
		expect(journalFiles(paths.journalDir, '.tmp').sort()).toEqual(
			[liveTemp, 'unparseable.tmp'].sort(),
		);
		expect(journalFiles(paths.journalDir)).toEqual([
			toolJournalFileName('tf-message', 'current'),
		]);
		const rows = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, 'tf-message'));
		expect(rows.map((row) => row.toolCallId)).toEqual(['good']);

		const pruned = recoverToolFinalizations(db, {
			isOwnerAlive: ownerAlive,
			now: Date.now() + TOOL_JOURNAL_QUARANTINE_RETENTION_MS + 1,
		});
		expect(pruned.unknown).toBe(0);
		expect(journalFiles(paths.journalDir, '.corrupt')).toEqual([]);
		expect(journalFiles(paths.journalDir, '.tmp')).toEqual([liveTemp]);
		expect(pruned.skipped).toBe(1);
	});

	test('unwritable journal blocks execution instead of risking a lost outcome', async () => {
		const paths = makeRoot();
		const db = await seed(paths.dbPath);
		writeFileSync(paths.journalDir, 'not a directory');
		let ran = 0;
		const mutate = tool({
			description: 'external mutation',
			inputSchema: z.object({}),
			execute: async () => {
				ran++;
				return { ok: true };
			},
		} as never) as Tool;
		let index = 0;
		const tools = adaptTools([{ name: 'mutate', tool: mutate }], {
			sessionId: 'tf-session',
			messageId: 'tf-message',
			assistantPartId: 'a',
			db,
			agent: 'build',
			provider: 'test',
			model: 'test',
			projectRoot: '/tmp/tf-project',
			nextIndex: () => index++,
			stepIndex: 0,
		});
		const result = await tools.mutate?.execute?.(
			{} as never,
			{
				toolCallId: 'blocked-call',
				messages: [],
			} as never,
		);
		expect(result).toMatchObject({
			ok: false,
			details: { reason: 'durability_unavailable' },
		});
		expect(ran).toBe(0);
	});

	function adaptMutate(
		db: Awaited<ReturnType<typeof seed>>,
		execute: () => Promise<unknown>,
	) {
		const mutate = tool({
			description: 'external mutation',
			inputSchema: z.object({}),
			execute,
		} as never) as Tool;
		let index = 0;
		const tools = adaptTools([{ name: 'mutate', tool: mutate }], {
			sessionId: 'tf-session',
			messageId: 'tf-message',
			assistantPartId: 'a',
			db,
			agent: 'build',
			provider: 'test',
			model: 'test',
			projectRoot: '/tmp/tf-project',
			nextIndex: () => index++,
			stepIndex: 0,
		});
		return (callId: string) =>
			tools.mutate?.execute?.(
				{} as never,
				{
					toolCallId: callId,
					messages: [],
				} as never,
			);
	}

	/** Moves the verified journal dir away and plants a symlink to `target`. */
	function swapForSymlink(journalDir: string, target: string) {
		renameSync(journalDir, `${journalDir}-moved`);
		mkdirSync(target, { recursive: true, mode: 0o700 });
		symlinkSync(target, journalDir);
	}

	test.if(process.platform !== 'win32')(
		'journal dir replaced by a symlink before intent: no write, no execution',
		async () => {
			const paths = makeRoot();
			const db = await seed(paths.dbPath);
			let ran = 0;
			const run = adaptMutate(db, async () => {
				ran++;
				return { ok: true };
			});
			expect(await run('first')).toEqual({ ok: true });
			expect(existsSync(paths.journalDir)).toBe(true);

			const attacker = join(paths.root, 'attacker');
			swapForSymlink(paths.journalDir, attacker);
			expect(await run('second')).toMatchObject({
				ok: false,
				details: { reason: 'durability_unavailable' },
			});
			expect(ran).toBe(1);
			expect(readdirSync(attacker)).toEqual([]);
		},
	);

	test.if(process.platform !== 'win32')(
		'journal dir replaced during execution: outcome is not written through the symlink',
		async () => {
			const paths = makeRoot();
			const db = await seed(paths.dbPath);
			const attacker = join(paths.root, 'attacker');
			let ran = 0;
			const run = adaptMutate(db, async () => {
				ran++;
				swapForSymlink(paths.journalDir, attacker);
				return { ok: true, value: 7 };
			});
			expect(await run('swap-outcome')).toEqual({ ok: true, value: 7 });
			expect(ran).toBe(1);
			expect(readdirSync(attacker)).toEqual([]);
			// The verified (moved) directory still holds the intent only.
			const moved = `${paths.journalDir}-moved`;
			const [file] = journalFiles(moved);
			expect(
				JSON.parse(readFileSync(join(moved, file ?? ''), 'utf8')).state,
			).toBe('intent');
			const rows = await db
				.select()
				.from(messageParts)
				.where(eq(messageParts.toolCallId, 'swap-outcome'));
			expect(rows).toHaveLength(1);
		},
	);

	test.if(process.platform !== 'win32')(
		'recovery refuses a symlinked or non-private journal directory',
		async () => {
			const paths = makeRoot();
			const db = await seed(paths.dbPath);
			const attacker = join(paths.root, 'attacker');
			await writeToolJournalRecord(attacker, intent('planted'));
			symlinkSync(attacker, paths.journalDir);
			expect(recoverToolFinalizations(db)).toMatchObject({
				unsafe: true,
				unknown: 0,
			});
			expect(journalFiles(attacker)).toHaveLength(1);

			rmSync(paths.journalDir);
			renameSync(attacker, paths.journalDir);
			chmodSync(paths.journalDir, 0o777);
			expect(recoverToolFinalizations(db)).toMatchObject({
				unsafe: true,
				unknown: 0,
			});
			chmodSync(paths.journalDir, 0o700);
			expect(recoverToolFinalizations(db)).toMatchObject({
				unsafe: false,
				unknown: 1,
			});
		},
	);

	test.if(process.platform !== 'win32')(
		'an untrusted run-owner directory disables interrupted-run marking',
		async () => {
			const paths = makeRoot();
			const db = await seed(paths.dbPath);
			await db
				.update(messages)
				.set({ status: 'pending' })
				.where(eq(messages.id, 'tf-message'));
			const owners = join(dirname(paths.dbPath), 'run-owners');
			rmSync(owners, { recursive: true, force: true });
			mkdirSync(join(paths.root, 'elsewhere'));
			symlinkSync(join(paths.root, 'elsewhere'), owners);
			expect(recoverInterruptedRuns(db, Date.now() + 1)).toEqual({
				messages: 0,
				subagents: 0,
			});
			const [message] = await db
				.select()
				.from(messages)
				.where(eq(messages.id, 'tf-message'));
			expect(message?.status).toBe('pending');
		},
	);
});

describe('run-owner leases protect live runs across full recovery', () => {
	// Root bypasses directory permission bits, so EACCES cannot be produced.
	const canDenyWrites =
		process.platform !== 'win32' && process.getuid?.() !== 0;

	test.if(canDenyWrites)(
		'unwritable lease dir refuses project open; retry succeeds after restore',
		async () => {
			const paths = await makeProject();
			const ownersDir = join(dirname(paths.dbPath), 'run-owners');
			mkdirSync(ownersDir, { recursive: true, mode: 0o700 });
			chmodSync(ownersDir, 0o500);
			const manager = new ProjectManager();
			const daemonId = getServerInfo().daemonId;
			setDaemonId(null);
			try {
				const failed = await Promise.allSettled(
					Array.from({ length: 4 }, () =>
						manager.openProject({ path: paths.project }),
					),
				);
				for (const outcome of failed) {
					expect(outcome.status).toBe('rejected');
					if (outcome.status === 'rejected') {
						expect(String(outcome.reason)).toContain('run owner lease');
					}
				}
				expect(manager.listOpenProjects()).toEqual([]);
				expect(readdirSync(ownersDir)).toEqual([]);

				chmodSync(ownersDir, 0o700);
				const runtimes = await Promise.all(
					Array.from({ length: 4 }, () =>
						manager.openProject({ path: paths.project }),
					),
				);
				for (const runtime of runtimes) expect(runtime).toBe(runtimes[0]);
				expect(manager.listOpenProjects()).toHaveLength(1);
				expect(readdirSync(ownersDir)).toEqual([
					`${currentToolJournalOwner().owner}.json`,
				]);

				// Our pending run is now protected from another process's
				// interrupted-run recovery on the same DB.
				const db = runtimes[0]?.db;
				if (!db) throw new Error('missing runtime db');
				await db.insert(sessions).values({
					id: 'lease-s',
					title: 't',
					agent: 'build',
					provider: 'test',
					model: 'test',
					projectPath: paths.project,
					createdAt: Date.now(),
					lastActiveAt: Date.now(),
					sessionType: 'main',
				});
				await db.insert(messages).values({
					id: 'lease-m',
					sessionId: 'lease-s',
					role: 'assistant',
					status: 'pending',
					agent: 'build',
					provider: 'test',
					model: 'test',
					createdAt: Date.now(),
				});
				const recovery = join(
					import.meta.dir,
					'..',
					'packages/server/src/runtime/projects/recovery.ts',
				);
				const foreign = Bun.spawn(
					[
						process.execPath,
						'--eval',
						`import { getDbByPath } from '@ottocode/database';
import { recoverInterruptedRuns } from ${JSON.stringify(recovery)};
const db = await getDbByPath(${JSON.stringify(paths.dbPath)});
console.log(JSON.stringify(recoverInterruptedRuns(db, Date.now() + 1)));`,
					],
					{
						cwd: join(import.meta.dir, '..'),
						stdout: 'pipe',
						stderr: 'pipe',
					},
				);
				const [out, code] = await Promise.all([
					new Response(foreign.stdout).text(),
					foreign.exited,
				]);
				expect(code).toBe(0);
				expect(JSON.parse(out.trim())).toEqual({ messages: 0, subagents: 0 });
				const [message] = await db
					.select()
					.from(messages)
					.where(eq(messages.id, 'lease-m'));
				expect(message?.status).toBe('pending');
			} finally {
				chmodSync(ownersDir, 0o700);
				setDaemonId(daemonId);
				await manager.closeAllProjects();
			}
		},
	);

	test('live message/sub-agent untouched while dead ones are recovered', async () => {
		const paths = makeRoot();
		const dead = await runWorker(paths, {
			killAt: 'intent',
			messageId: 'm-dead',
			subagent: true,
			callId: 'dead-call',
			counterPath: join(paths.root, 'dead-count'),
		});
		expect(dead.signal).toBe('SIGKILL');

		const liveCounter = join(paths.root, 'live-count');
		const live = spawnWorker(paths, {
			killAt: 'hang',
			messageId: 'm-live',
			subagent: true,
			callId: 'live-call',
			counterPath: liveCounter,
		});
		const db = await getDbByPath(paths.dbPath);
		const statusOf = async () => {
			const rows = await db.select().from(messages);
			const subs = await db.select().from(subagents);
			return {
				dead: rows.find((row) => row.id === 'm-dead')?.status,
				live: rows.find((row) => row.id === 'm-live')?.status,
				deadSub: subs.find((row) => row.id === 'm-dead-subagent')?.status,
				liveSub: subs.find((row) => row.id === 'm-live-subagent')?.status,
			};
		};
		try {
			await waitFor(`${liveCounter}.ready`);
			const result = recoverInterruptedRuns(db, Date.now() + 1);
			expect(result).toEqual({ messages: 1, subagents: 1 });
			expect(await statusOf()).toEqual({
				dead: 'error',
				live: 'pending',
				deadSub: 'failed',
				liveSub: 'running',
			});
			const results = (await db.select().from(messageParts)).filter(
				(part) => part.type === 'tool_result',
			);
			expect(results.map((part) => part.toolCallId)).toEqual(['dead-call']);
			expect(
				journalFiles(paths.journalDir).includes(
					toolJournalFileName('m-live', 'live-call'),
				),
			).toBe(true);
		} finally {
			live.kill('SIGKILL');
			await live.exited;
		}

		expect(recoverInterruptedRuns(db, Date.now() + 1)).toEqual({
			messages: 1,
			subagents: 1,
		});
		expect(await statusOf()).toEqual({
			dead: 'error',
			live: 'error',
			deadSub: 'failed',
			liveSub: 'failed',
		});
		expect(executions(liveCounter)).toBe(1);
		expect(executions(join(paths.root, 'dead-count'))).toBe(0);
	});

	test('a malformed live lease fails closed: live rows unchanged', async () => {
		const paths = makeRoot();
		const counter = join(paths.root, 'live-count');
		const live = spawnWorker(paths, {
			killAt: 'hang',
			messageId: 'm-live',
			subagent: true,
			callId: 'live-call',
			counterPath: counter,
		});
		const db = await getDbByPath(paths.dbPath);
		const ownersDir = join(dirname(paths.dbPath), 'run-owners');
		const statusOf = async () => ({
			message: (await db.select().from(messages)).find(
				(row) => row.id === 'm-live',
			)?.status,
			subagent: (await db.select().from(subagents)).find(
				(row) => row.id === 'm-live-subagent',
			)?.status,
		});
		let lease = '';
		try {
			await waitFor(`${counter}.ready`);
			const leases = readdirSync(ownersDir).filter((f) => f.endsWith('.json'));
			expect(leases).toHaveLength(1);
			lease = join(ownersDir, leases[0] ?? '');
			// Corrupt the live owner's lease: its identity is now unknowable.
			writeFileSync(lease, '{"v":1,"owner":');
			// Even an old mtime must not make it look dead.
			utimesSync(lease, new Date(0), new Date(0));

			expect(recoverInterruptedRuns(db, Date.now() + 1)).toEqual({
				messages: 0,
				subagents: 0,
			});
			expect(await statusOf()).toEqual({
				message: 'pending',
				subagent: 'running',
			});
			expect(existsSync(lease)).toBe(true);
		} finally {
			live.kill('SIGKILL');
			await live.exited;
		}
		// Still fail-closed after the owner died: nothing infers death from a
		// lease whose owner cannot be read.
		expect(recoverInterruptedRuns(db, Date.now() + 1)).toEqual({
			messages: 0,
			subagents: 0,
		});
		expect(await statusOf()).toEqual({
			message: 'pending',
			subagent: 'running',
		});
		// Operator removes the unverifiable entry; recovery then proceeds.
		rmSync(lease);
		expect(recoverInterruptedRuns(db, Date.now() + 1)).toEqual({
			messages: 1,
			subagents: 1,
		});
		expect(executions(counter)).toBe(1);
	});
});
