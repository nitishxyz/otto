/**
 * Restart-durable journal for tool-call finalization.
 *
 * Lifecycle of one tool call (keyed by messageId + toolCallId):
 *   1. intent   - written (fsync + atomic rename) BEFORE the tool executes.
 *                 If it cannot be written the tool is not executed.
 *   2. outcome  - the completed, redacted result (including inline image
 *                 bytes) replaces the intent BEFORE ordinary DB finalization.
 *   3. commit   - after the `tool_result` row commits, the record is deleted.
 *
 * Restart recovery (see tool-finalization-recovery.ts) replays records whose
 * owner process is gone: an `outcome` is inserted idempotently by result part
 * id; a bare `intent` becomes an explicit "outcome unknown" error result. A
 * tool is never re-executed and no model continuation is started.
 *
 * Ownership: every record carries this process's random `owner` id and pid.
 * A record is recoverable only when its owner is provably not running (see
 * `isToolJournalOwnerAlive`), so a second live process opening the same DB
 * never converts another process's in-flight intent to "unknown".
 *
 * Crash window: if the process dies after the tool's external effect but
 * before the outcome record is durable, the effect may or may not have
 * happened; recovery reports it as unknown rather than fabricating success.
 *
 * The journal deliberately lives in plain files next to (not inside) the
 * project SQLite database, so a result that could not be written to SQLite
 * (disk/lock/IO failure on the DB) is still recoverable. Only databases
 * backed by an absolute file path are journaled; in-memory DBs are not.
 */
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { getDbFilePath } from '@ottocode/database';
import {
	removePrivateFile,
	writePrivateFileAtomic,
} from './tool-finalization-fs.ts';

export const TOOL_JOURNAL_DIRNAME = 'tool-journal';
/** Upper bound for one record (results with inline images included). */
export const MAX_TOOL_JOURNAL_RECORD_BYTES = 64 * 1024 * 1024;

const idSchema = z.string().min(1).max(512);
const nameSchema = z.string().min(1).max(256);

const baseRecord = {
	v: z.literal(1),
	sessionId: idSchema,
	messageId: idSchema,
	callId: idSchema,
	name: nameSchema,
	partId: idSchema,
	agent: z.string().max(512),
	provider: z.string().max(512),
	model: z.string().max(512),
	stepIndex: z.number().int().min(0).optional(),
	startTs: z.number().finite(),
	createdAt: z.number().finite(),
	pid: z.number().int(),
	owner: z.string().uuid(),
};

const intentRecordSchema = z
	.object({ ...baseRecord, state: z.literal('intent') })
	.strict();

const outcomeRecordSchema = z
	.object({
		...baseRecord,
		state: z.literal('outcome'),
		status: z.enum(['success', 'error', 'blocked', 'rejected', 'aborted']),
		index: z.number().int().min(0).optional(),
		endTs: z.number().finite(),
		durationMs: z.number().finite().min(0).nullable(),
		content: z
			.object({
				name: nameSchema,
				callId: idSchema.optional(),
				result: z.unknown(),
				artifact: z.unknown().optional(),
				args: z.unknown().optional(),
			})
			.strict(),
	})
	.strict();

export const toolJournalRecordSchema = z.discriminatedUnion('state', [
	intentRecordSchema,
	outcomeRecordSchema,
]);

export type ToolJournalIntentRecord = z.infer<typeof intentRecordSchema>;
export type ToolJournalOutcomeRecord = z.infer<typeof outcomeRecordSchema>;
export type ToolJournalRecord = z.infer<typeof toolJournalRecordSchema>;

export type ToolFinalizationBoundary = 'intent' | 'outcome' | 'commit';
type BoundaryHook = (
	boundary: ToolFinalizationBoundary,
	info: { callId: string },
) => void;

let boundaryHook: BoundaryHook | undefined;

/** Test-only hook invoked right after each durable boundary is crossed. */
export function setToolFinalizationBoundaryHook(hook?: BoundaryHook): void {
	boundaryHook = hook;
}

export function reachToolFinalizationBoundary(
	boundary: ToolFinalizationBoundary,
	callId: string,
): void {
	boundaryHook?.(boundary, { callId });
}

/** Journal directory for a DB, or undefined when the DB has no file path. */
export function resolveToolJournalDir(db: unknown): string | undefined {
	const dbPath = getDbFilePath(db);
	if (!dbPath || !isAbsolute(dbPath)) return undefined;
	return join(dirname(dbPath), TOOL_JOURNAL_DIRNAME);
}

export function toolJournalKey(messageId: string, callId: string): string {
	return createHash('sha256')
		.update(`${messageId}\u0000${callId}`)
		.digest('hex');
}

export function toolJournalFileName(messageId: string, callId: string) {
	return `${toolJournalKey(messageId, callId)}.json`;
}

/** Random identity of this process as a journal owner. */
export const TOOL_JOURNAL_OWNER_ID = randomUUID();

export type ToolJournalOwner = { owner: string; pid: number };

export function currentToolJournalOwner(): ToolJournalOwner {
	return { owner: TOOL_JOURNAL_OWNER_ID, pid: process.pid };
}

/**
 * Conservative liveness: true unless the owner is provably gone. Errs toward
 * "alive" (EPERM, unknown errors, pid reuse), which only delays recovery.
 */
export function isToolJournalOwnerAlive(owner: ToolJournalOwner): boolean {
	if (owner.owner === TOOL_JOURNAL_OWNER_ID) return true;
	// Same pid but a different owner id: an earlier process whose pid was
	// recycled to us (e.g. container restarts), so it is gone.
	if (owner.pid === process.pid) return false;
	if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false;
	try {
		process.kill(owner.pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code !== 'ESRCH';
	}
}

const TMP_PATTERN =
	/^[0-9a-f]{64}\.(\d+)\.([0-9a-f-]{36})\.[0-9a-f-]{36}\.tmp$/;

/** Owner encoded in a temp file name, or undefined when unparseable. */
export function parseToolJournalTempOwner(
	fileName: string,
): ToolJournalOwner | undefined {
	const match = TMP_PATTERN.exec(fileName);
	if (!match) return undefined;
	return { pid: Number(match[1]), owner: String(match[2]) };
}

/**
 * Atomically replaces the record for (messageId, callId) inside the
 * verified private journal directory (see tool-finalization-fs.ts).
 */
export async function writeToolJournalRecord(
	dir: string,
	record: ToolJournalRecord,
): Promise<void> {
	const parsed = toolJournalRecordSchema.parse(record);
	const data = JSON.stringify(parsed);
	if (Buffer.byteLength(data, 'utf8') > MAX_TOOL_JOURNAL_RECORD_BYTES) {
		throw new Error('Tool journal record exceeds size limit');
	}
	const key = toolJournalKey(record.messageId, record.callId);
	await writePrivateFileAtomic(
		dir,
		`${key}.json`,
		data,
		`${key}.${process.pid}.${TOOL_JOURNAL_OWNER_ID}`,
	);
}

/** Deletes the record once its result is committed. Missing is success. */
export async function removeToolJournalRecord(
	dir: string,
	messageId: string,
	callId: string,
): Promise<void> {
	await removePrivateFile(dir, toolJournalFileName(messageId, callId));
}
