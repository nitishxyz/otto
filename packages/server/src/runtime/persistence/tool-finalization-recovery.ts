/**
 * Restart recovery for the tool finalization journal. Replays only
 * persistence-safe state into SQLite: never re-executes a tool, never
 * publishes live events, never continues the model.
 */
import { renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';
import {
	isToolJournalOwnerAlive,
	MAX_TOOL_JOURNAL_RECORD_BYTES,
	parseToolJournalTempOwner,
	resolveToolJournalDir,
	toolJournalFileName,
	toolJournalRecordSchema,
	type ToolJournalOwner,
	type ToolJournalRecord,
} from './tool-finalization-journal.ts';
import { PrivateDirReader } from './tool-finalization-fs.ts';

/** Quarantined (corrupt) records are kept this long for diagnosis. */
export const TOOL_JOURNAL_QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Bound on directory entries inspected per recovery pass. */
export const MAX_TOOL_JOURNAL_ENTRIES = 10_000;
/** Unparseable temp files older than this are removed. */
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

export const UNKNOWN_OUTCOME_ERROR =
	'Tool outcome unknown: the Otto process stopped after this tool started and before its result was recorded. It may or may not have taken effect and was NOT re-run. Verify the current state before retrying.';

export interface ToolFinalizationRecoveryResult {
	/** Journaled outcomes inserted as tool results. */
	recovered: number;
	/** Interrupted intents recorded as unknown-outcome errors. */
	unknown: number;
	/** Records whose result row already existed. */
	alreadyCommitted: number;
	/** Valid records whose message no longer exists. */
	discarded: number;
	/** Corrupt or invalid records moved aside. */
	quarantined: number;
	/** Records owned by a live process (this or another), left untouched. */
	skipped: number;
	/** The journal directory failed identity/permission checks; nothing read. */
	unsafe: boolean;
}

function emptyResult(): ToolFinalizationRecoveryResult {
	return {
		recovered: 0,
		unknown: 0,
		alreadyCommitted: 0,
		discarded: 0,
		quarantined: 0,
		skipped: 0,
		unsafe: false,
	};
}

function readRecord(
	reader: PrivateDirReader,
	fileName: string,
): ToolJournalRecord {
	const record = toolJournalRecordSchema.parse(
		JSON.parse(reader.readFile(fileName, MAX_TOOL_JOURNAL_RECORD_BYTES)),
	);
	if (toolJournalFileName(record.messageId, record.callId) !== fileName) {
		throw new Error('record key does not match file name');
	}
	return record;
}

/** Unlinks/renames only after re-verifying the directory identity. */
function removeVerified(reader: PrivateDirReader, entry: string): void {
	reader.verify();
	try {
		unlinkSync(join(reader.dir, entry));
	} catch {}
}

function resultContent(record: ToolJournalRecord): string {
	if (record.state === 'outcome') return JSON.stringify(record.content);
	return JSON.stringify({
		name: record.name,
		callId: record.callId,
		result: {
			ok: false,
			error: UNKNOWN_OUTCOME_ERROR,
			details: { reason: 'outcome_unknown' },
		},
	});
}

/** Inserts the record's result row unless one already exists. */
function applyRecord(
	db: DB,
	record: ToolJournalRecord,
	now: number,
): 'inserted' | 'exists' | 'missing-message' {
	return db.transaction((tx) => {
		const message = tx
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.id, record.messageId))
			.get();
		if (!message) return 'missing-message';
		const existing = tx
			.select({ id: messageParts.id })
			.from(messageParts)
			.where(eq(messageParts.id, record.partId))
			.get();
		const existingForCall = tx
			.select({ id: messageParts.id })
			.from(messageParts)
			.where(
				and(
					eq(messageParts.messageId, record.messageId),
					eq(messageParts.type, 'tool_result'),
					eq(messageParts.toolCallId, record.callId),
				),
			)
			.get();
		if (existing || existingForCall) return 'exists';

		let index = record.state === 'outcome' ? record.index : undefined;
		if (index !== undefined) {
			const taken = tx
				.select({ id: messageParts.id })
				.from(messageParts)
				.where(
					and(
						eq(messageParts.messageId, record.messageId),
						eq(messageParts.index, index),
					),
				)
				.get();
			if (taken) index = undefined;
		}
		if (index === undefined) {
			const row = tx
				.select({ max: sql<number | null>`max(${messageParts.index})` })
				.from(messageParts)
				.where(eq(messageParts.messageId, record.messageId))
				.get();
			index = (row?.max ?? -1) + 1;
		}
		const endTs = record.state === 'outcome' ? record.endTs : now;
		tx.insert(messageParts)
			.values({
				id: record.partId,
				messageId: record.messageId,
				index,
				stepIndex: record.stepIndex,
				type: 'tool_result',
				content: resultContent(record),
				agent: record.agent,
				provider: record.provider,
				model: record.model,
				startedAt: record.startTs,
				completedAt: endTs,
				toolName: record.name,
				toolCallId: record.callId,
				toolDurationMs:
					record.state === 'outcome'
						? (record.durationMs ?? undefined)
						: undefined,
			})
			.run();
		return 'inserted';
	});
}

function isStaleTemp(
	entry: string,
	mtimeMs: number,
	now: number,
	isOwnerAlive: (owner: ToolJournalOwner) => boolean,
): boolean {
	const owner = parseToolJournalTempOwner(entry);
	if (owner) return !isOwnerAlive(owner);
	return now - mtimeMs > STALE_TEMP_MS;
}

/**
 * Replays tool finalization records whose owning process is no longer
 * running; records of live owners (this process or a concurrent one on the
 * same DB) are skipped. Corrupt records are quarantined (`*.corrupt`) and
 * pruned after the retention window. Never throws for journal content; a
 * record whose DB write fails stays in place for the next pass.
 */
export function recoverToolFinalizations(
	db: DB,
	options: {
		journalDir?: string;
		now?: number;
		/** Liveness probe override (tests). */
		isOwnerAlive?: (owner: ToolJournalOwner) => boolean;
	} = {},
): ToolFinalizationRecoveryResult {
	const result = emptyResult();
	const dir = options.journalDir ?? resolveToolJournalDir(db);
	if (!dir) return result;
	const now = options.now ?? Date.now();
	const isOwnerAlive = options.isOwnerAlive ?? isToolJournalOwnerAlive;
	let reader: PrivateDirReader | undefined;
	try {
		reader = PrivateDirReader.open(dir);
	} catch (error) {
		result.unsafe = true;
		logger.warn('[tool-journal] refusing to recover from unsafe directory', {
			error: error instanceof Error ? error.message : String(error),
		});
		return result;
	}
	if (!reader) return result;
	try {
		replayEntries(db, reader, result, now, isOwnerAlive);
	} catch (error) {
		// Directory identity changed mid-pass: stop; remaining records stay.
		result.unsafe = true;
		logger.warn('[tool-journal] recovery aborted: directory changed', {
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		reader.close();
	}

	if (
		result.recovered ||
		result.unknown ||
		result.alreadyCommitted ||
		result.discarded ||
		result.quarantined
	) {
		logger.warn('[tool-journal] recovered tool finalizations', { ...result });
	}
	return result;
}

function replayEntries(
	db: DB,
	reader: PrivateDirReader,
	result: ToolFinalizationRecoveryResult,
	now: number,
	isOwnerAlive: (owner: ToolJournalOwner) => boolean,
): void {
	for (const entry of reader.list(MAX_TOOL_JOURNAL_ENTRIES)) {
		if (entry.endsWith('.tmp') || entry.endsWith('.corrupt')) {
			let expired = false;
			try {
				const stats = reader.entryStats(entry);
				expired = entry.endsWith('.tmp')
					? isStaleTemp(entry, stats.mtimeMs, now, isOwnerAlive)
					: now - stats.mtimeMs > TOOL_JOURNAL_QUARANTINE_RETENTION_MS;
			} catch {}
			if (expired) removeVerified(reader, entry);
			continue;
		}
		if (!entry.endsWith('.json')) continue;

		let record: ToolJournalRecord;
		try {
			record = readRecord(reader, entry);
		} catch (error) {
			reader.verify();
			result.quarantined++;
			logger.warn('[tool-journal] quarantined unreadable record', {
				file: entry,
				error: error instanceof Error ? error.message : String(error),
			});
			const path = join(reader.dir, entry);
			try {
				renameSync(path, `${path}.corrupt`);
			} catch {
				removeVerified(reader, entry);
			}
			continue;
		}
		if (isOwnerAlive(record)) {
			result.skipped++;
			continue;
		}

		let applied: ReturnType<typeof applyRecord>;
		try {
			applied = applyRecord(db, record, now);
		} catch (error) {
			logger.warn('[tool-journal] failed to replay record', {
				messageId: record.messageId,
				callId: record.callId,
				error: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		if (applied === 'missing-message') result.discarded++;
		else if (applied === 'exists') result.alreadyCommitted++;
		else if (record.state === 'outcome') result.recovered++;
		else result.unknown++;
		removeVerified(reader, entry);
	}
}
