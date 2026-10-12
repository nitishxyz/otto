import { logger } from '@ottocode/sdk';
import type { ToolOutcome } from '@ottocode/sdk/tools/error';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import {
	currentToolJournalOwner,
	reachToolFinalizationBoundary,
	removeToolJournalRecord,
	resolveToolJournalDir,
	writeToolJournalRecord,
} from '../../runtime/persistence/tool-finalization-journal.ts';
import { registerRunOwner } from '../../runtime/persistence/tool-finalization-owners.ts';
import type { ToolCallRecord } from './pending.ts';

type Finalization = NonNullable<ToolCallRecord['finalization']>;

/** What restart recovery will produce for a call whose DB write failed. */
export type ToolRestartRecovery = 'result' | 'unknown-outcome' | 'none';

export function toolRestartRecovery(
	record: ToolCallRecord,
): ToolRestartRecovery {
	if (record.journalState === 'outcome') return 'result';
	if (record.journalState === 'intent') return 'unknown-outcome';
	return 'none';
}

function baseRecord(ctx: ToolAdapterContext, record: ToolCallRecord) {
	record.resultPartId ??= crypto.randomUUID();
	return {
		v: 1 as const,
		sessionId: ctx.sessionId,
		messageId: ctx.messageId,
		callId: record.callId,
		name: record.name,
		partId: record.resultPartId,
		agent: ctx.agent,
		provider: ctx.provider,
		model: ctx.model,
		stepIndex: record.stepIndex,
		startTs: record.startTs,
		createdAt: Date.now(),
		...currentToolJournalOwner(),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Durably records that the call is about to execute. Returns false when the
 * DB is journaled but the intent could not be written; the caller must then
 * not execute the tool.
 */
export async function journalToolIntent(
	ctx: ToolAdapterContext,
	record: ToolCallRecord,
): Promise<boolean> {
	const dir = resolveToolJournalDir(ctx.db);
	if (!dir) return true;
	try {
		// The lease protects this run's message/sub-agent rows from another
		// process's interrupted-run recovery while the tool executes.
		await registerRunOwner(ctx.db);
		await writeToolJournalRecord(dir, {
			...baseRecord(ctx, record),
			state: 'intent',
		});
	} catch (error) {
		logger.warn('[tool] failed to journal tool intent; not executing', {
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			tool: record.name,
			callId: record.callId,
			error: errorMessage(error),
		});
		return false;
	}
	record.journalState = 'intent';
	reachToolFinalizationBoundary('intent', record.callId);
	return true;
}

/**
 * Durably records the completed, redacted outcome before DB finalization.
 * Failure (I/O, size limit, unserializable result) is not fatal: the DB
 * write is still attempted. The earlier intent record stays in place, so a
 * later DB failure is only recoverable as "outcome unknown", never as the
 * actual result.
 */
export async function journalToolOutcome(
	ctx: ToolAdapterContext,
	record: ToolCallRecord,
	outcome: ToolOutcome,
	finalization: Finalization,
): Promise<void> {
	const dir = resolveToolJournalDir(ctx.db);
	if (!dir) return;
	try {
		await writeToolJournalRecord(dir, {
			...baseRecord(ctx, record),
			partId: finalization.partId,
			state: 'outcome',
			status: outcome.status,
			index: finalization.index,
			endTs: finalization.endTs,
			durationMs: finalization.durationMs,
			content: JSON.parse(JSON.stringify(finalization.content)),
		});
	} catch (error) {
		logger.warn(
			'[tool] failed to journal tool outcome; result will not survive a DB failure or restart',
			{
				sessionId: ctx.sessionId,
				messageId: ctx.messageId,
				tool: record.name,
				callId: record.callId,
				restartRecovery: toolRestartRecovery(record),
				error: errorMessage(error),
			},
		);
		return;
	}
	record.journalState = 'outcome';
	reachToolFinalizationBoundary('outcome', record.callId);
}

/** Drops the journal record after the result row committed. */
export async function clearToolJournal(
	ctx: ToolAdapterContext,
	record: ToolCallRecord,
): Promise<void> {
	if (!record.journalState) return;
	reachToolFinalizationBoundary('commit', record.callId);
	const dir = resolveToolJournalDir(ctx.db);
	if (!dir) return;
	try {
		await removeToolJournalRecord(dir, ctx.messageId, record.callId);
		record.journalState = undefined;
	} catch (error) {
		logger.warn('[tool] failed to clear tool journal record', {
			callId: record.callId,
			error: errorMessage(error),
		});
	}
}
