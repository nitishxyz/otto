import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { NoOutputGeneratedError } from 'ai';
import { eq } from 'drizzle-orm';
import { stringifyWithoutInlineImageData } from '../../../tools/adapter/browser-artifact.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { AbortEvent, FinishEvent } from '../../stream/types.ts';
import { PartContentPersistenceError } from '../../persistence/part-content-writer.ts';
import { claimPendingMessage } from './continuation.ts';
import type { TurnFacts, TurnOutcomeKind } from './types.ts';
import { findToolResultDurabilityError } from './durability.ts';

type Db = Awaited<ReturnType<typeof getDb>>;

function unwrapErrorEvent(error: unknown): unknown {
	if (
		error &&
		typeof error === 'object' &&
		!(error instanceof Error) &&
		'error' in error &&
		Object.keys(error).length === 1
	) {
		return (error as { error: unknown }).error;
	}
	return error;
}

function isNoOutputError(error: unknown): boolean {
	return NoOutputGeneratedError.isInstance(error);
}

/**
 * Picks the error that explains the turn. Wrapper errors such as
 * `NoOutputGeneratedError` never mask an earlier original error; when only a
 * wrapper exists its cause is preferred.
 */
export function selectPrimaryError(errors: unknown[]): unknown | undefined {
	const original = errors.find((error) => !isNoOutputError(error));
	if (original !== undefined) return original;
	const wrapper = errors[0];
	if (wrapper === undefined) return undefined;
	const cause = (wrapper as { cause?: unknown }).cause;
	return cause !== undefined ? cause : wrapper;
}

export type TurnTerminal = {
	readonly facts: TurnFacts;
	recordFinish: (fin: FinishEvent) => void;
	recordError: (error: unknown) => void;
	recordPersistenceError: (error: unknown) => void;
	recordAbort: (event: AbortEvent) => void;
	primaryError: () => unknown | undefined;
	/** Claims the single terminal transition; returns false once claimed. */
	claim: (kind: TurnOutcomeKind) => boolean;
	outcome: () => TurnOutcomeKind | null;
};

/**
 * Collects terminal facts from AI SDK callbacks and stream parts. Callbacks
 * never persist; the turn executor finalizes exactly once from these facts.
 */
export function createTurnTerminal(): TurnTerminal {
	const facts: TurnFacts = { errors: [] };
	let outcome: TurnOutcomeKind | null = null;
	return {
		facts,
		recordFinish(fin) {
			if (!facts.finish) facts.finish = fin;
		},
		recordError(error) {
			const unwrapped = unwrapErrorEvent(error);
			if (unwrapped === undefined || unwrapped === null) return;
			if (unwrapped instanceof PartContentPersistenceError)
				facts.persistenceError ??= unwrapped;
			const durabilityError = findToolResultDurabilityError(unwrapped);
			if (durabilityError !== undefined)
				facts.persistenceError = durabilityError;
			if (facts.errors.includes(unwrapped)) return;
			facts.errors.push(unwrapped);
		},
		recordAbort(event) {
			if (!facts.abort) facts.abort = event;
		},
		recordPersistenceError(error) {
			facts.persistenceError ??= error;
		},
		primaryError: () =>
			facts.persistenceError ?? selectPrimaryError(facts.errors),
		claim(kind) {
			if (outcome) return false;
			outcome = kind;
			return true;
		},
		outcome: () => outcome,
	};
}

function parseFinishDetails(raw: string | null | undefined) {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Completes a pending assistant message. Guarded: an error, abort, or other
 * terminal state written by another owner is never overwritten. Returns
 * whether this call performed the transition.
 */
export async function completePendingAssistantMessage(args: {
	db: Db;
	opts: RunOpts;
	fin: FinishEvent;
}): Promise<boolean> {
	const { db, opts, fin } = args;
	const existing = await db
		.select({ finishDetails: messages.finishDetails })
		.from(messages)
		.where(eq(messages.id, opts.assistantMessageId))
		.limit(1);
	const details: Record<string, unknown> = parseFinishDetails(
		existing[0]?.finishDetails,
	);
	if (fin.providerMetadata) details.providerMetadata = fin.providerMetadata;
	if (fin.response) details.response = fin.response;
	let finishDetails: string | undefined;
	if (Object.keys(details).length > 0) {
		try {
			finishDetails = stringifyWithoutInlineImageData(details);
		} catch {
			finishDetails = JSON.stringify({ serializationError: true });
		}
	}
	return claimPendingMessage(db, opts.assistantMessageId, {
		status: 'complete',
		completedAt: Date.now(),
		finishReason: fin.finishReason,
		rawFinishReason: fin.rawFinishReason,
		...(finishDetails ? { finishDetails } : {}),
	});
}
